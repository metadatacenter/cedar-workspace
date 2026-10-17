import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Backend, HttpError } from "./backend.service";
import { ResourceDialog } from "./resource-dialog";
import { resource } from "./testing/workspace-fixture";
import { useDeploymentDomain } from "./resource-address";

// The deployment's base is module state that outlives a test.
afterEach(() => useDeploymentDomain(null));

for (const action of ["rename", "new-folder", "copy", "draft", "publish"])
  for (const status of [0, 200, 400, 401, 403, 408, 409, 412, 422, 428, 500])
    it(`${action} ${status}: preserves intent and requires the appropriate recovery`, async () => {
      useDeploymentDomain("example");
      const r = resource("item");
      const request = vi.fn().mockResolvedValue({data: {resources: [], totalCount: 0}});
      const snapshot = vi.fn().mockResolvedValue({data: r, etag: '"old"'});
      const report = vi.fn().mockResolvedValue({data: r});
      TestBed.configureTestingModule({providers: [{provide: Backend, useValue: {request, snapshot, report}}]});
      const host = TestBed.runInInjectionContext(() => new ResourceDialog());
      host.action = action; host.resource = r; host.folder = "home";
      await host.load();
      host.target = "home"; host.targetResource = {...resource("home", "folder"), currentUserPermissions: {capabilities: ["copyIntoFolder"]}};
      host.name = "My draft"; host.description = "Keep this";
      request.mockClear().mockRejectedValue(new HttpError(status, "Rejected"));
      await host.submit();
      const recovery = ![400, 422].includes(status);
      expect(host.reloadRequired()).toBe(recovery);
      await host.submit();
      expect(request).toHaveBeenCalledTimes(recovery ? 1 : 2);
      if (recovery) {
        snapshot.mockRejectedValueOnce(new Error("Offline"));
        await host.load(); await host.submit();
        expect(request).toHaveBeenCalledTimes(1);
        expect(host.description).toBe("Keep this");
        snapshot.mockResolvedValue({data: {...r, "schema:description": "Remote"}, etag: '"new"'});
        await host.load();
        if (action === "rename") {
          expect(host.reloadRequired()).toBe(false);
          request.mockResolvedValue({});
          await host.submit();
          expect(request.mock.calls.at(-1)?.[3]).toBe('"new"');
        } else {
          expect(host.inspectionRequired()).toBe(true);
          expect(host.reloadRequired()).toBe(true);
        }
      }
      host.ngOnDestroy();
    });

/**
 * New folder, Copy and Create Draft send the identity they create, minted before the first attempt.
 * Publish sends the version it publishes. The server here holds at most what one identity names, and
 * `lost` drops the reply after the server has decided.
 */
function actionRig(action: string) {
  useDeploymentDomain("example");
  const source = {
    ...resource("item", "template"),
    "pav:version": "1.0.0",
    "bibo:status": action === "draft" ? "bibo:published" : "bibo:draft",
  };
  const world = {
    stored: null as Record<string, unknown> | null,
    published: false,
    lookup: null as number | null,
    lost: true,
    commit: true,
    refuse: null as number | null,
  };
  const home = {
    ...resource("home", "folder"),
    currentUserPermissions: { capabilities: ["copyIntoFolder"] },
  };
  const write = (record: Record<string, unknown>) => {
    if (world.stored) throw new HttpError(world.refuse ?? 412, "Taken");
    if (world.commit) world.stored = record;
    if (world.lost) throw new HttpError(0, "No reply");
    return { data: record };
  };
  const request = vi.fn(async (path: string, method = "GET", body?: Record<string, unknown>) => {
    if (method === "PUT" && path.startsWith("/folders/"))
      return write({
        "@id": body!["@id"],
        pathInfo: [{ "@id": "root" }, { "@id": body!["folderId"] }, { "@id": body!["@id"] }],
      });
    if (path === "/command/copy-artifact-to-folder")
      return write({ "@id": body!["copyId"], "pav:derivedFrom": body!["@id"] });
    if (path === "/command/create-draft-artifact")
      return write({ "@id": body!["draftId"], "pav:previousVersion": body!["@id"] });
    if (path === "/command/publish-artifact") {
      if (world.published) throw new HttpError(400, "Already published");
      if (world.commit) world.published = true;
      if (world.lost) throw new HttpError(0, "No reply");
      return { data: {} };
    }
    if (path.includes("/contents"))
      return { data: { resources: [], totalCount: 0, pathInfo: [home] } };
    if (path === "/folders/home") return { data: home };
    if (world.lookup) throw new HttpError(world.lookup, "Refused");
    if (path === "/templates/item")
      return {
        data: {
          ...source,
          "bibo:status": world.published ? "bibo:published" : source["bibo:status"],
          "pav:version": world.published ? "1.0.0" : source["pav:version"],
        },
      };
    if (!world.stored || !path.endsWith(String(world.stored["@id"]).split("/").at(-1)!))
      throw new HttpError(404, "Not found");
    return { data: structuredClone(world.stored) };
  });
  TestBed.configureTestingModule({
    providers: [
      {
        provide: Backend,
        useValue: {
          request,
          snapshot: vi.fn(),
          report: vi.fn(),
          config: { resourceRestAPI: "https://resource.example" },
          userId: "owner",
        },
      },
    ],
  });
  const open = async () => {
    const host = TestBed.runInInjectionContext(() => new ResourceDialog());
    host.action = action;
    host.resource = action === "new-folder" ? undefined : source;
    host.folder = "home";
    await host.load();
    if (action === "new-folder" && !host.name) host.name = "Results";
    return host;
  };
  // The identity each create was sent under: the folder's URL, or the copy's or draft's own key.
  const sent = () =>
    request.mock.calls
      .filter(([path, method]) => method === "PUT" || String(path).startsWith("/command/"))
      .map(([, , body]) =>
        String(body?.["copyId"] ?? body?.["draftId"] ?? body?.["@id"] ?? ""),
      );
  return { request, world, open, sent };
}

const creating = ["new-folder", "copy", "draft"];
const minted = {
  "new-folder": /^https:\/\/repo\.example\/folders\/[0-9a-f-]{36}$/,
  copy: /^https:\/\/repo\.example\/templates\/[0-9a-f-]{36}$/,
  draft: /^https:\/\/repo\.example\/templates\/[0-9a-f-]{36}$/,
} as Record<string, RegExp>;

describe("dialog actions settled by a lookup", () => {
  afterEach(() => sessionStorage.clear());

  for (const action of [...creating, "publish"]) {
    it(`${action}: offers no Retry while nothing is unknown`, async () => {
      const m = actionRig(action);
      const host = await m.open();
      expect(host.inspectionRequired()).toBe(false);
      expect(host.settles).toBe(false);
      m.world.lost = false;
      m.request.mockRejectedValueOnce(new HttpError(422, "Invalid"));
      await host.submit();
      expect(host.reloadRequired()).toBe(false);
      expect(host.settles).toBe(false);
      host.ngOnDestroy();
    });

    it(`${action}: a committed action completes the dialog as on success`, async () => {
      const m = actionRig(action);
      const host = await m.open();
      const saved = vi.fn();
      host.saved.subscribe(saved);
      await host.submit();
      expect(host.inspectionRequired()).toBe(true);
      expect(host.settles).toBe(true);
      expect(host.reloadRequired()).toBe(true);
      await host.submit();
      expect(m.sent()).toHaveLength(1);
      if (action !== "publish") expect(m.sent()[0]).toMatch(minted[action]);
      await host.settle();
      expect(saved).toHaveBeenCalledOnce();
      expect(m.sent()).toHaveLength(1);
      expect(sessionStorage.length).toBe(0);
      host.ngOnDestroy();
    });

    it(`${action}: an action that did not happen is offered again with the same identity and values`, async () => {
      const m = actionRig(action);
      const host = await m.open();
      m.world.commit = false;
      if (action !== "publish") host.name = "Kept name";
      host.version = [2, 0, 0];
      await host.submit();
      await host.settle();
      expect(host.inspectionRequired()).toBe(false);
      expect(host.reloadRequired()).toBe(false);
      expect(host.settles).toBe(false);
      expect(host.version).toEqual([2, 0, 0]);
      if (action !== "publish") expect(host.name).toBe("Kept name");
      m.world.commit = true;
      m.world.lost = false;
      const saved = vi.fn();
      host.saved.subscribe(saved);
      await host.submit();
      expect(saved).toHaveBeenCalledOnce();
      const sent = m.sent();
      expect(sent).toHaveLength(2);
      expect(new Set(sent).size).toBe(1);
      host.ngOnDestroy();
    });

    for (const status of [401, 403, 503])
      it(`${action}: a lookup refused or unavailable (${status}) leaves Retry offered`, async () => {
        const m = actionRig(action);
        const host = await m.open();
        await host.submit();
        m.world.lookup = status;
        await host.settle();
        expect(host.inspectionRequired()).toBe(true);
        expect(host.settles).toBe(true);
        expect(host.error()).toBe("Refused");
        await host.submit();
        expect(m.sent()).toHaveLength(1);
        m.world.lookup = null;
        const saved = vi.fn();
        host.saved.subscribe(saved);
        await host.settle();
        expect(saved).toHaveBeenCalledOnce();
        host.ngOnDestroy();
      });
  }

  for (const action of creating)
    for (const status of [412, 428]) {
      it(`${action}: an occupied identity (${status}) is checked again, never taken as failure`, async () => {
        const m = actionRig(action);
        const host = await m.open();
        m.world.commit = false;
        await host.submit();
        await host.settle();
        // The first attempt commits after the lookup found nothing.
        m.world.stored = {
          "@id": m.sent()[0],
          "pav:derivedFrom": "item",
          "pav:previousVersion": "item",
          pathInfo: [{ "@id": "root" }, { "@id": "home" }, { "@id": m.sent()[0] }],
        };
        m.world.refuse = status;
        await host.submit();
        expect(host.inspectionRequired()).toBe(true);
        expect(host.settles).toBe(true);
        expect(host.error()).toBe("");
        const saved = vi.fn();
        host.saved.subscribe(saved);
        await host.settle();
        expect(saved).toHaveBeenCalledOnce();
        expect(new Set(m.sent()).size).toBe(1);
        host.ngOnDestroy();
      });
    }

  for (const action of creating)
    it(`${action}: an identity holding something else stays unresolved`, async () => {
      const m = actionRig(action);
      const host = await m.open();
      await host.submit();
      m.world.stored = { "@id": m.sent()[0], pathInfo: [], "pav:derivedFrom": "other" };
      await host.settle();
      expect(host.inspectionRequired()).toBe(true);
      expect(host.error()).toBe(
        "The server returned incomplete or mismatched resource details. Please retry.",
      );
      host.ngOnDestroy();
    });

  for (const action of [...creating, "publish"])
    it(`${action}: a reopened dialog reuses the retained identity and values after a reload`, async () => {
      const m = actionRig(action);
      const first = await m.open();
      m.world.commit = false;
      if (action !== "publish") first.name = "Kept name";
      first.version = [3, 0, 0];
      await first.submit();
      // A reload destroys the dialog without closing it.
      first.ngOnDestroy();
      const next = await m.open();
      expect(next.inspectionRequired()).toBe(true);
      expect(next.settles).toBe(true);
      expect(next.version).toEqual([3, 0, 0]);
      if (action !== "publish") expect(next.name).toBe("Kept name");
      await next.submit();
      expect(m.sent()).toHaveLength(1);
      await next.settle();
      expect(next.inspectionRequired()).toBe(false);
      m.world.commit = true;
      m.world.lost = false;
      await next.submit();
      expect(m.sent()).toHaveLength(2);
      expect(new Set(m.sent()).size).toBe(1);
      expect(sessionStorage.length).toBe(0);
      next.ngOnDestroy();
    });

  for (const action of [...creating, "publish"])
    it(`${action}: an action still unanswered when the page reloads was retained before it was sent`, async () => {
      const m = actionRig(action);
      const first = await m.open();
      m.world.commit = false;
      const server = m.request.getMockImplementation()!;
      m.request.mockImplementation((path, method, body) =>
        method === "PUT" || String(path).startsWith("/command/")
          ? new Promise(() => {})
          : server(path, method, body),
      );
      first.version = [3, 0, 0];
      void first.submit();
      // A reload destroys the dialog while its request has had no answer.
      first.ngOnDestroy();
      m.request.mockImplementation(server);
      const next = await m.open();
      expect(next.inspectionRequired()).toBe(true);
      expect(next.settles).toBe(true);
      expect(next.version).toEqual([3, 0, 0]);
      await next.settle();
      expect(next.inspectionRequired()).toBe(false);
      m.world.commit = true;
      m.world.lost = false;
      await next.submit();
      expect(m.sent()).toHaveLength(2);
      expect(new Set(m.sent()).size).toBe(1);
      next.ngOnDestroy();
    });

  // Only an artifact's owner may publish it or create a draft of it, and the server refuses anyone else
  // with a 403 under its own key. Nothing happened, so no retained entry survives and no Retry is offered.
  // Any other 403 still leaves the outcome to be checked, and a refusal for a reason in the artifact is a
  // 400 that keeps the entry with its outcome known, as before.
  const ownerOnlyText: Record<string, string> = {
    publish: "Only the owner of this artifact can publish it.",
    draft: "Only the owner of this artifact can create a draft of it.",
  };
  const retained = () =>
    Object.keys(sessionStorage).map((key) => JSON.parse(sessionStorage.getItem(key)!));
  for (const action of ["publish", "draft"]) {
    it(`${action}: a refusal to anyone but the owner keeps nothing and offers no Retry`, async () => {
      const m = actionRig(action);
      const host = await m.open();
      const saved = vi.fn();
      host.saved.subscribe(saved);
      m.request.mockRejectedValueOnce(
        new HttpError(403, "Request failed (403).", "versioningOnlyByOwner"),
      );
      await host.submit();
      expect(host.error()).toBe(ownerOnlyText[action]);
      expect(host.reloadRequired()).toBe(false);
      expect(host.inspectionRequired()).toBe(false);
      expect(host.settles).toBe(false);
      expect(host.busy()).toBe(false);
      expect(retained()).toEqual([]);
      // A dialog opened afterwards finds nothing to take up.
      const next = await m.open();
      expect(next.inspectionRequired()).toBe(false);
      expect(next.reloadRequired()).toBe(false);
      next.ngOnDestroy();
      // OK is offered as before. Once the server accepts, the action is sent as a new attempt.
      m.world.lost = false;
      await host.submit();
      expect(saved).toHaveBeenCalledOnce();
      expect(m.sent()).toHaveLength(2);
      if (action === "draft") {
        expect(m.sent()[1]).toMatch(minted.draft);
        expect(m.sent()[1]).not.toBe(m.sent()[0]);
      }
      expect(retained()).toEqual([]);
      host.ngOnDestroy();
    });

    for (const code of [undefined, "noWriteAccessToFolder"])
      it(`${action}: a 403 ${code ? `under ${code}` : "without a key"} still leaves the outcome to be checked`, async () => {
        const m = actionRig(action);
        const host = await m.open();
        m.request.mockRejectedValueOnce(new HttpError(403, "Request failed (403).", code));
        await host.submit();
        expect(host.error()).toBe("Request failed (403).");
        expect(host.reloadRequired()).toBe(true);
        expect(host.inspectionRequired()).toBe(true);
        expect(host.settles).toBe(true);
        expect(retained()).toEqual([expect.objectContaining({ uncertain: true })]);
        host.ngOnDestroy();
      });

    for (const code of ["publishOnlyDraft", "createDraftOnlyFromPublished", "versioningOnlyOnLatest", "nonVersionedArtifactType"])
      it(`${action}: a 400 under ${code} is still a plain refusal`, async () => {
        const m = actionRig(action);
        const host = await m.open();
        m.request.mockRejectedValueOnce(new HttpError(400, "Request failed (400).", code));
        await host.submit();
        expect(host.error()).toBe("Request failed (400).");
        expect(host.reloadRequired()).toBe(false);
        expect(host.inspectionRequired()).toBe(false);
        expect(host.settles).toBe(false);
        expect(retained()).toEqual([expect.objectContaining({ uncertain: false })]);
        host.ngOnDestroy();
      });
  }

  it("publish: a source published at another version than the one sent stays unresolved", async () => {
    const m = actionRig("publish");
    const host = await m.open();
    m.world.commit = false;
    host.version = [2, 0, 0];
    await host.submit();
    // The source was published at its opened version by someone else meanwhile.
    m.world.published = true;
    const saved = vi.fn();
    host.saved.subscribe(saved);
    await host.settle();
    expect(saved).not.toHaveBeenCalled();
    expect(host.inspectionRequired()).toBe(true);
    expect(host.settles).toBe(true);
    expect(host.error()).toBe(
      "The server returned incomplete or mismatched resource details. Please retry.",
    );
    host.ngOnDestroy();
  });

  it("keeps an unknown outcome when the dialog is closed, and forgets a known one", async () => {
    const m = actionRig("copy");
    const first = await m.open();
    m.world.commit = false;
    await first.submit();
    await first.close();
    expect(sessionStorage.length).toBe(1);
    const next = await m.open();
    expect(next.inspectionRequired()).toBe(true);
    await next.settle();
    await next.close();
    expect(sessionStorage.length).toBe(0);
    const fresh = await m.open();
    expect(fresh.inspectionRequired()).toBe(false);
    fresh.ngOnDestroy();
  });

  it("does not adopt a retained copy for another item, destination or account", async () => {
    const m = actionRig("copy");
    const first = await m.open();
    m.world.commit = false;
    await first.submit();
    first.ngOnDestroy();
    const [key] = Object.keys(sessionStorage);
    const entry = JSON.parse(sessionStorage.getItem(key)!);
    for (const scope of [
      ["https://resource.example", "someone-else", "copy", "item", "home"],
      ["https://resource.example", "owner", "copy", "other-item", "home"],
      ["https://resource.example", "owner", "copy", "item", "elsewhere"],
      ["https://other.example", "owner", "copy", "item", "home"],
    ]) {
      sessionStorage.clear();
      const moved = JSON.stringify(scope);
      sessionStorage.setItem("cedar.action.journal:" + moved, JSON.stringify({ ...entry, scope: moved }));
      const next = await m.open();
      expect(next.inspectionRequired()).toBe(false);
      next.ngOnDestroy();
    }
  });
});
