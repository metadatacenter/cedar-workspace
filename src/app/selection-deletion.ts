import { validDeletionPlan, validDeletionOutcome } from "./deletion-validation";
import { validAccessReport } from "./access-validation";
import { I18n } from "./i18n";
import { Injectable, inject } from "@angular/core";
import { Backend } from "./backend.service";
import { Resource, ResourceType, can, title } from "./resource";
import type {
  DeletionItem,
  DeletionPlan,
  DeletionOutcome,
} from "./folder-deletion-dialog";

export const emptyCounts = (): Record<ResourceType, number> => ({
  folder: 0,
  template: 0,
  element: 0,
  field: 0,
  instance: 0,
});
export interface DeletionRoot {
  resource: Resource;
  plan?: DeletionPlan;
  etag?: string;
}
export interface SelectionPlan {
  inventory: DeletionPlan;
  roots: DeletionRoot[];
}

export class SelectionInventoryError extends Error {
  constructor(
    readonly resource: Resource,
    readonly failure: unknown,
  ) {
    super();
  }
}

/** Keep the server's per-folder safety boundary and content ETags; never invent a bulk token. */
@Injectable({ providedIn: "root" })
export class SelectionDeletion {
  private readonly api = inject(Backend);
  private readonly i18n = inject(I18n);
  async prepare(selection: Resource[]): Promise<SelectionPlan> {
    const resources = [
      ...new Map(selection.map((r) => [r["@id"], r])).values(),
    ];
    if (!resources.length)
      throw new Error(this.i18n.t("SelectionDeletion.InventoryUnavailable"));
    const folders = resources.filter((r) => r.resourceType === "folder");
    const replies = await Promise.allSettled(
      folders.map(async (resource) => {
        const response = await this.api.request<DeletionPlan>(
          this.api.path(resource) + "/deletion",
        );
        if (!validDeletionPlan(response.data, resource["@id"]))
          throw new Error(
            this.i18n.t("SelectionDeletion.InventoryUnavailable"),
          );
        return { resource, plan: response.data };
      }),
    );
    const plans = replies.flatMap((reply) =>
      reply.status === "fulfilled" ? [reply.value] : [],
    );
    const coveredByOther = (id: string) =>
      plans.some(
        (p) =>
          p.resource["@id"] !== id && p.plan.items.some((i) => i.id === id),
      );
    // A selected descendant is governed by its selected ancestor's complete inventory,
    // including descendants that cannot themselves obtain a root-owner deletion token.
    replies.forEach((reply, index) => {
      if (reply.status === "rejected" && !coveredByOther(folders[index]["@id"]))
        throw new SelectionInventoryError(folders[index], reply.reason);
    });
    const roots: DeletionRoot[] = plans.filter(
      (p) => !coveredByOther(p.resource["@id"]),
    );
    if (folders.length && !roots.length)
      throw new Error(this.i18n.t("SelectionDeletion.InventoryUnavailable"));
    const items: DeletionItem[] = [];
    const seen = new Set<string>();
    let allowed = true;
    for (const root of roots) {
      const p = root.plan!;
      if (!p.token || !p.items.some((i) => i.id === root.resource["@id"]))
        throw new Error(this.i18n.t("SelectionDeletion.InventoryUnavailable"));
      const inventoryCounts = emptyCounts();
      for (const item of p.items) inventoryCounts[item.type]++;
      if (
        Object.entries(inventoryCounts).some(
          ([type, count]) => count !== p.counts[type as ResourceType],
        )
      )
        throw new Error(this.i18n.t("SelectionDeletion.InventoryUnavailable"));
      allowed &&= p.allowed;
      for (const item of p.items) {
        // Overlap between separate roots means the tree changed during planning.
        if (item.id && seen.has(item.id))
          throw new Error(
            this.i18n.t("SelectionDeletion.InventoryUnavailable"),
          );
        if (item.id) seen.add(item.id);
        items.push(item);
      }
    }
    for (const resource of resources.filter(
      (r) => r.resourceType !== "folder" && !seen.has(r["@id"]),
    )) {
      const report = (await this.api.report(resource)).data;
      const snapshot = await this.api.snapshot(resource, true);
      if (
        !validAccessReport(report, resource) ||
        snapshot.data?.["@id"] !== resource["@id"] ||
        !snapshot.etag?.trim()
      )
        throw new Error(this.i18n.t("SelectionDeletion.InventoryUnavailable"));
      const references =
        resource.resourceType === "template" ? report.numberOfInstances : 0;
      if (
        references === undefined ||
        !Number.isSafeInteger(references) ||
        references < 0
      )
        throw new Error(this.i18n.t("SelectionDeletion.InventoryUnavailable"));
      const deletable = can(report, "deleteResource");
      allowed &&= deletable && references === 0;
      roots.push({
        resource: {
          ...resource,
          ...report,
          ...snapshot.data,
          resourceType: resource.resourceType,
        },
        etag: snapshot.etag,
      });
      items.push({
        id: resource["@id"],
        name: title({ ...resource, ...snapshot.data }),
        type: resource.resourceType,
        parentId: null,
        depth: 0,
        deletable,
        protectedFolder: false,
        instancesInside: 0,
        instancesOutside: references,
      });
    }
    const counts = emptyCounts();
    items.forEach((i) => counts[i.type]++);
    return {
      roots,
      inventory: {
        token: "",
        allowed,
        counts,
        items,
        restrictedItems: items.filter((i) => !i.deletable).length,
        protectedFolders: items.filter((i) => i.protectedFolder).length,
        templatesWithInstances: items.filter(
          (i) => i.instancesInside + i.instancesOutside > 0,
        ).length,
        templatesWithOutsideInstances: items.filter(
          (i) => i.instancesOutside > 0,
        ).length,
        instancesOutside: items.reduce((n, i) => n + i.instancesOutside, 0),
      },
    };
  }
  async execute(root: DeletionRoot): Promise<DeletionOutcome> {
    if (root.plan) {
      if (
        !validDeletionPlan(root.plan, root.resource["@id"]) ||
        !root.plan.allowed
      )
        throw new Error(this.i18n.t("SelectionDeletion.InventoryUnavailable"));
      const response = await this.api.request<DeletionOutcome>(
        this.api.path(root.resource) + "/deletion",
        "POST",
        { token: root.plan.token },
      );
      if (!validDeletionOutcome(response.data, root.plan))
        throw new Error(this.i18n.t("SelectionDeletion.Uncertain"));
      return response.data;
    }
    if (!root.etag?.trim())
      throw new Error(this.i18n.t("SelectionDeletion.InventoryUnavailable"));
    await this.api.request(
      this.api.path(root.resource),
      "DELETE",
      undefined,
      root.etag,
    );
    const deleted = emptyCounts();
    deleted[root.resource.resourceType] = 1;
    return { status: "completed", deleted, remaining: 0 };
  }
}
