import { HttpError } from "./backend.service";
import { expect, it, vi } from "vitest";
import { deferred, resource, workspaceRig } from "./testing/workspace-fixture";

it("pagehide cancels enrichment, and a persisted pageshow restarts it without losing selection", async () => {
  const m = await workspaceRig();
  const rows = Array.from({ length: 8 }, (_, index) => resource(`item-${index}`, "template"));
  m.api.request.mockImplementation(async (path: string) => ({ data: path.includes("/contents") ? { resources: rows, totalCount: rows.length, pathInfo: [] } : resource("home", "folder") }) as never);
  const pending = deferred<never>();
  m.api.report.mockReset().mockReturnValue(pending.promise);
  await m.host.load();
  await vi.waitFor(() => expect(m.api.report).toHaveBeenCalledTimes(4));
  const signals = m.api.report.mock.calls.map((args) => args[1] as AbortSignal);
  m.host.selectionIds.set([rows[0]["@id"]]);
  m.host.selected.set(rows[0]);
  window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  pending.reject(new DOMException("Page left", "AbortError"));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(m.api.report).toHaveBeenCalledTimes(4);
  m.api.report.mockImplementation(async (row) => ({ data: row }));
  window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  await vi.waitFor(() => expect(m.api.report).toHaveBeenCalledTimes(12));
  expect(m.host.selectionIds()).toEqual([rows[0]["@id"]]);
  expect(m.host.selected()?.["@id"]).toBe(rows[0]["@id"]);
  expect(m.host.error()).toBe("");
  m.fixture.destroy();
  const count = m.api.report.mock.calls.length;
  window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  expect(m.api.report).toHaveBeenCalledTimes(count);
});


for (const status of [0, 404]) {
  it(`a ${status === 0 ? 'transport interruption stops the next batch' : 'single HTTP refusal leaves other reports running'}`, async () => {
    const m = await workspaceRig();
    const rows = Array.from({ length: 8 }, (_, index) => resource(`item-${index}`, "template"));
    m.api.request.mockImplementation(async (path: string) => ({ data: path.includes("/contents") ? { resources: rows, totalCount: rows.length, pathInfo: [] } : resource("home", "folder") }) as never);
    m.api.report.mockReset().mockImplementation(async (row) => {
      if (row["@id"] === "item-0") throw new HttpError(status, "Unavailable");
      return { data: row };
    });
    await m.host.load();
    await vi.waitFor(() => expect(m.host.state.report.find(op => op.scope === "enrichment")?.status).toBe(status === 0 ? "error" : "ready"));
    expect(m.api.report).toHaveBeenCalledTimes(status === 0 ? 4 : 8);
    m.api.report.mockClear().mockImplementation(async row => ({ data: row }));
    await m.host.load(true);
    await vi.waitFor(() => expect(m.api.report).toHaveBeenCalledTimes(8));
    expect(m.host.error()).toBe("");
    m.fixture.destroy();
  });
}
