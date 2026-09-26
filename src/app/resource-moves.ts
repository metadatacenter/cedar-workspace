import { Injectable, inject } from "@angular/core";
import { Backend } from "./backend.service";
import { I18n } from "./i18n";
import { Resource, can, title } from "./resource";
export function validMoveShape(resources: Resource[], target: Resource) {
  return (
    target.resourceType === "folder" &&
    resources.length > 0 &&
    resources.every(
      (r) =>
        r["@id"] !== target["@id"] &&
        !target.pathInfo?.some((p) => p["@id"] === r["@id"]),
    )
  );
}
export function validMoveTarget(resources: Resource[], target: Resource) {
  return can(target, "moveIntoFolder") && validMoveShape(resources, target);
}
@Injectable({ providedIn: "root" })
export class ResourceMoves {
  private api = inject(Backend);
  private i18n = inject(I18n);
  async move(resources: Resource[], targetId: string) {
    const moved: string[] = [],
      failed: { resource: Resource; message: string }[] = [];
    const target = (
      await this.api.request<Resource>(
        "/folders/" + encodeURIComponent(targetId),
      )
    ).data;
    if (!validMoveTarget(resources, target))
      throw new Error(this.i18n.t("ResourceDialog.DestinationNotAllowed"));
    // Refresh capabilities and revisions before any write. Never silently retry a stale write.
    const prepared = await Promise.all(
      resources.map(async (resource) => {
        const report = (await this.api.report(resource)).data;
        if (!can(report, "moveResource"))
          throw new Error(
            title(resource) + ": " + this.i18n.t("Explorer.MoveDenied"),
          );
        const snapshot = await this.api.snapshot(resource);
        if (!snapshot.etag)
          throw new Error(this.i18n.t("ResourceDialog.NoRevision"));
        return { resource, report, etag: snapshot.etag };
      }),
    );
    const ids = new Set(resources.map((r) => r["@id"]));
    const roots = prepared.filter(
      ({ resource, report }) =>
        !report.pathInfo?.some(
          (p) => p["@id"] !== resource["@id"] && ids.has(p["@id"]),
        ),
    );
    for (const { resource, etag } of roots) {
      try {
        await this.api.request(
          "/command/move-resource-to-folder",
          "POST",
          { "@id": resource["@id"], targetFolderId: targetId },
          etag,
        );
        moved.push(
          resource["@id"],
          ...prepared
            .filter(
              (p) =>
                p.resource["@id"] !== resource["@id"] &&
                p.report.pathInfo?.some(
                  (parent) => parent["@id"] === resource["@id"],
                ),
            )
            .map((p) => p.resource["@id"]),
        );
      } catch (e) {
        failed.push({
          resource,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return { moved, failed };
  }
}
