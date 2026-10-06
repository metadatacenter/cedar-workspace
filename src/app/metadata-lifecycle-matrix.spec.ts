import { afterEach, expect, it, vi } from "vitest";
import { HttpError } from "./backend.service";
import { metadataRig } from "./testing/metadata-fixture";
import { deferred } from "./testing/workspace-fixture";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Recovery/leave decisions cross uncertainty, permissions, revisions, further edits,
// component recreation, and a write occurring while a confirmation is outstanding.
for (const action of ["reload", "leave"])
  for (const status of [0, 200, 400, 412, 500])
    for (const writable of [true, false])
      for (const revision of ['"revision"', '"changed"'])
        for (const transition of ["stable", "edit", "recreate", "save"]) {
          it(`${action}: HTTP ${status}, writable=${writable}, ETag=${revision}, confirmation after ${transition}`, async () => {
            const m = await metadataRig();
            let current = m.host;
            try {
              m.edit();
              m.request.mockRejectedValueOnce(
                new HttpError(status, "Write not confirmed"),
              );
              await m.host.save();
              expect(m.host.dirty()).toBe(true);
              const answer = deferred<boolean>();
              m.confirm.mockReturnValueOnce(answer.promise);
              const deciding =
                action === "reload" ? m.host.reload() : m.host.mayLeave();
              m.access(writable);
              m.revision(revision);
              m.server({
                "@id": "instance",
                "schema:isBasedOn": "template",
                "schema:name": "Server contents",
                Value: { "@value": "new contents" },
              });
              if (transition === "edit") {
                m.host.name = "Later draft";
                m.host.changed();
              }
              if (transition === "recreate") current = await m.recreate();
              if (transition === "save") await m.host.save();
              const calls = m.request.mock.calls.length;
              const element = current.editor.nativeElement;
              answer.resolve(true);
              const result = await deciding;
              const valid =
                transition === "stable" ||
                (transition === "save" && status !== 400);
              if (action === "leave") expect(result).toBe(valid);
              const recovered = action === "reload" && valid;
              if (!recovered) {
                expect(m.request).toHaveBeenCalledTimes(calls);
                expect(current.editor.nativeElement).toBe(element);
              } else {
                expect(current.editor.nativeElement).not.toBe(element);
                expect(
                  current.editor.nativeElement.currentMetadata["Value"],
                ).toEqual({ "@value": "new contents" });
                expect(current.dirty()).toBe(false);
              }
              if (transition === "edit")
                expect(current.name).toBe("Later draft");
              if (recovered || transition === "recreate") {
                expect(current.writable()).toBe(writable);
                const before = m.request.mock.calls.length;
                current.name = "Next draft";
                current.changed();
                await current.save();
                if (writable)
                  expect(m.request.mock.calls.at(-1)?.[3]).toBe(revision);
                else expect(m.request).toHaveBeenCalledTimes(before);
              }
              expect(
                m.request.mock.calls.filter(([, method]) => method === "PUT"),
              ).toHaveLength(
                1 +
                  Number(transition === "save" && status === 400) +
                  Number((recovered || transition === "recreate") && writable),
              );
            } finally {
              current.ngOnDestroy();
            }
          });
        }
