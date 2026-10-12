import { expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";
import { ActivatedRoute, Router, convertToParamMap } from "@angular/router";
import { provideWorkspaceTranslations } from "./i18n";
import { HttpError } from "./backend.service";
import { metadataRig } from "./testing/metadata-fixture";
import { deferred } from "./testing/workspace-fixture";
import {
  Command,
  commands,
  checkAsyncHistory,
  historySeeds,
} from "../testing/seeded-history";

type Draft = { name: string; value: string | null };
type Reply = {
  data: import("cedar-embeddable-editor").CeeJsonObject;
  etag: string | null;
};
const same = (a: Draft, b: Draft) => a.name === b.name && a.value === b.value;
const body = (draft: Draft) => ({
  "@id": "instance",
  "schema:isBasedOn": "template",
  "schema:name": draft.name,
  Value: { "@value": draft.value },
});

/** The reference records user intent and server acknowledgements, never host state-machine helpers.
 * Only CEE's public boundary and HTTP/confirmation transport are simulated. */
async function replay(mode: "create" | "edit", history: Command[]) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: provideWorkspaceTranslations("en"),
  });
  vi.useFakeTimers();
  const started = metadataRig(mode);
  await vi.runAllTimersAsync();
  const rig = await started;
  let host = rig.host;
  let server: Draft = { name: "Original", value: "original" };
  let version = 1,
    serverWritable = true,
    epoch = 0,
    generation = 0;
  let routeMode = mode;
  let draft!: Draft, baseline!: Draft;
  let revision!: string | null, saved!: boolean, writable!: boolean;
  let recovery!: boolean,
    uncertain!: boolean,
    saving!: boolean,
    rejected: Draft | undefined;
  const writes: Array<{
    reply: ReturnType<typeof deferred<Reply>>;
    task: Promise<void>;
    epoch: number;
    draft: Draft;
    create: boolean;
  }> = [];
  const decisions: Array<{
    reply: ReturnType<typeof deferred<boolean>>;
    task: Promise<unknown>;
    epoch: number;
    generation: number;
    draft: Draft;
    action: "leave" | "reload";
  }> = [];
  const resetReference = () => {
    draft =
      routeMode === "edit"
        ? { ...server }
        : { name: "Study metadata", value: null };
    baseline = { ...draft };
    saved = routeMode === "edit";
    revision = saved ? `"v${version}"` : null;
    writable = serverWritable;
    recovery = uncertain = saving = false;
    rejected = undefined;
  };
  resetReference();
  rig.revision('"v1"');
  // The initial edit fixture was read before its revision was changed above.
  if (mode === "edit") revision = '"revision"';
  const originalRequest = rig.request.getMockImplementation()!;
  rig.request.mockImplementation((path, method = "GET", payload, etag) => {
    if (method === "GET") return originalRequest(path, method, payload, etag);
    const reply = deferred<Reply>();
    expect(method, "write method follows acknowledged identity").toBe(
      saved ? "PUT" : "POST",
    );
    expect(etag, "write uses last acknowledged/read revision").toBe(revision);
    expect(
      (payload as Record<string, unknown>)?.["schema:name"],
      "write snapshots the current name",
    ).toBe(draft.name.trim());
    expect(
      (payload as Record<string, unknown>)?.["Value"],
      "write snapshots the current field value",
    ).toEqual({ "@value": draft.value });
    writes.push({
      reply,
      task: Promise.resolve(),
      epoch,
      draft: { ...draft },
      create: !saved,
    });
    return reply.promise;
  });
  vi.mocked(TestBed.inject(Router).navigateByUrl).mockImplementation(
    async () => {
      routeMode = "edit";
      Object.assign(TestBed.inject(ActivatedRoute).snapshot, {
        paramMap: convertToParamMap({ mode: "edit", id: "instance" }),
      });
      return true;
    },
  );
  rig.confirm.mockImplementation(() => {
    const reply = deferred<boolean>();
    decisions.push({
      reply,
      task: Promise.resolve(),
      epoch,
      generation,
      draft: { ...draft },
      action: "leave",
    });
    return reply.promise;
  });
  const updateServer = () => {
    rig.server(body(server));
    rig.revision(`"v${version}"`);
    rig.access(serverWritable);
  };
  updateServer();
  const verify = () => {
    expect(host.name, "current name preserves user intent").toBe(draft.name);
    expect(
      host.editor.nativeElement.currentMetadata["Value"],
      "current field preserves user intent",
    ).toEqual({ "@value": draft.value });
    expect(host.dirty(), "dirty compares against the acknowledged draft").toBe(
      draft.name.trim() !== baseline.name.trim() ||
        draft.value !== baseline.value,
    );
    expect(host.saving(), "only the current write owns saving").toBe(saving);
    expect(host.writable(), "permissions come from the most recent load").toBe(
      writable,
    );
    expect(
      host.state.reloadRequired(),
      "uncertain/conflicting writes require recovery",
    ).toBe(recovery);
    expect(
      host.state.uncertainCreation(),
      "uncertain creation cannot be repeated",
    ).toBe(uncertain);
    expect(
      host.validationErrors.length,
      "server findings belong to the submitted draft",
    ).toBe(rejected ? 1 : 0);
  };
  const finishWrite = async (index: number, outcome: number) => {
    const entry = writes.splice(index, 1)[0];
    const current = entry.epoch === epoch;
    const success = outcome === 0 || outcome === 5;
    if (success) {
      server = { ...entry.draft, name: entry.draft.name.trim() };
      version++;
      updateServer();
      entry.reply.resolve({
        data: body(server),
        etag: outcome === 5 ? null : `"v${version}"`,
      });
      if (current) {
        baseline = { ...entry.draft };
        saved = true;
        revision = outcome === 5 ? null : `"v${version}"`;
        recovery = outcome === 5;
        rejected = undefined;
      }
    } else if (outcome === 4) {
      entry.reply.resolve({ data: {}, etag: null });
      if (current) {
        recovery = true;
        uncertain = entry.create;
      }
    } else {
      const status = outcome === 6 ? 0 : [0, 400, 412, 500][outcome];
      entry.reply.reject(
        new HttpError(status, "Rejected", "invalidData", {
          errors: [
            { location: "/Value/@value", message: "Rejected submitted draft" },
          ],
        }),
      );
      if (current) {
        recovery = status !== 400;
        uncertain = entry.create && (status === 500 || status === 0);
        if (same(draft, entry.draft)) rejected = { ...draft };
      }
    }
    if (current) saving = false;
    await entry.task;
  };
  try {
    for (const command of history) {
      if (command.op === 0 || command.op === 1) {
        const next =
          command.b % 4 === 0
            ? { ...baseline }
            : {
                name: `Draft ${command.b % 9}`,
                value: command.c % 3 ? `value:${command.c % 7}` : null,
              };
        if (command.op === 0) {
          draft.name = next.name;
          host.name = next.name;
        } else {
          draft.value = next.value;
          rig.setValue(host.editor.nativeElement, next.value);
        }
        if (rejected && !same(rejected, draft)) rejected = undefined;
        host.changed();
      } else if (command.op === 2) {
        const accepted = !saving && writable && !recovery && !rejected;
        const count = writes.length;
        const task = host.save();
        expect(
          writes.length - count,
          "save gating is independent of response order",
        ).toBe(Number(accepted));
        if (accepted) {
          saving = true;
          generation++;
          writes.at(-1)!.task = task;
        } else await task;
      } else if (command.op === 3 && writes.length) {
        await finishWrite(command.a % writes.length, command.b % 7);
      } else if (command.op === 4) {
        server = {
          name: `Remote ${command.b % 5}`,
          value: `remote:${command.c % 7}`,
        };
        version++;
        serverWritable = command.c % 3 !== 0;
        updateServer();
      } else if (command.op === 5 || command.op === 6) {
        const action = command.op === 5 ? "reload" : "leave";
        const dirty =
          draft.name.trim() !== baseline.name.trim() ||
          draft.value !== baseline.value;
        const eligible = !saving && (action === "leave" || !uncertain);
        const before = decisions.length;
        const task = action === "reload" ? host.reload() : host.mayLeave();
        expect(
          decisions.length - before,
          "only a discardable dirty draft asks confirmation",
        ).toBe(Number(eligible && dirty));
        if (decisions.length > before)
          Object.assign(decisions.at(-1)!, { action, task });
        else {
          await vi.runAllTimersAsync();
          const result = await task;
          if (action === "leave")
            expect(result, "clean leave and pending-save guard").toBe(eligible);
          else if (eligible) {
            generation++;
            resetReference();
          }
        }
      } else if (command.op === 7 && decisions.length) {
        const entry = decisions.splice(command.a % decisions.length, 1)[0];
        const answer = command.b % 3 !== 0;
        const valid =
          answer &&
          entry.epoch === epoch &&
          entry.generation === generation &&
          same(entry.draft, draft) &&
          !saving;
        entry.reply.resolve(answer);
        await vi.runAllTimersAsync();
        const result = await entry.task;
        if (entry.action === "leave")
          expect(
            result,
            "old confirmation cannot approve a different draft",
          ).toBe(valid);
        else if (valid && !uncertain) {
          generation++;
          resetReference();
        }
      } else if (command.op === 8) {
        host.ngOnDestroy();
        epoch++;
        generation++;
        const replacing = rig.recreate();
        await vi.runAllTimersAsync();
        host = await replacing;
        resetReference();
      }
      verify();
    }
    // Resolve every old owner after disposal as well: ignored rejections must still settle safely.
    host.ngOnDestroy();
    epoch++;
    while (writes.length) await finishWrite(writes.length - 1, 3);
    for (const entry of decisions) {
      entry.reply.resolve(true);
      await entry.task;
    }
  } finally {
    host.ngOnDestroy();
    for (const entry of writes) entry.reply.resolve({ data: {}, etag: null });
    for (const entry of decisions) entry.reply.resolve(false);
    await Promise.all([...writes, ...decisions].map((entry) => entry.task));
    TestBed.resetTestingModule();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
}

for (const mode of ["edit", "create"] as const)
  it.each(historySeeds(100))(`${mode} metadata history seed %i`, (seed) =>
    checkAsyncHistory(seed, commands(seed, 60, 9), (history) =>
      replay(mode, history),
    ),
  );

for (const mode of ["edit", "create"] as const)
  it(`${mode}: a late successful save does not acknowledge later name and field edits`, () =>
    replay(mode, [
      { op: 0, a: 0, b: 1, c: 1 },
      { op: 1, a: 0, b: 1, c: 1 },
      { op: 2, a: 0, b: 0, c: 0 },
      { op: 0, a: 0, b: 2, c: 2 },
      { op: 1, a: 0, b: 2, c: 2 },
      { op: 3, a: 0, b: 0, c: 0 },
      // Reverting the name isolates whether the unsaved field was acknowledged.
      { op: 0, a: 0, b: 0, c: 0 },
    ]));
it("an old reload confirmation cannot discard edits made after a save", () =>
  replay("edit", [
    { op: 0, a: 0, b: 1, c: 0 },
    { op: 5, a: 0, b: 0, c: 0 },
    { op: 2, a: 0, b: 0, c: 0 },
    { op: 3, a: 0, b: 0, c: 0 },
    { op: 0, a: 0, b: 2, c: 0 },
    { op: 7, a: 0, b: 1, c: 0 },
  ]));
