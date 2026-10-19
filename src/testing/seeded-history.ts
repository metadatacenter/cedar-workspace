/** Deterministic command histories with deletion shrinking; no production helpers in the oracle. */
export interface Command {
  op: number;
  a: number;
  b: number;
  c: number;
}
export function commands(
  seed: number,
  length: number,
  operations: number,
): Command[] {
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  return Array.from({ length }, () => ({
    op: (next() >>> 8) % operations,
    a: next() >>> 8,
    b: next() >>> 8,
    c: next() >>> 8,
  }));
}

/** Fixed CI seeds; larger local explorations and exact single-seed replay are opt-in. */
export function historySeeds(defaultRuns = 200): number[] {
  const env =
    (globalThis as { process?: { env: Record<string, string | undefined> } })
      .process?.env ?? {};
  const positive = (text: string, name: string) => {
    const value = Number(text);
    if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000)
      throw new Error(`Invalid ${name}: ${text}`);
    return value;
  };
  if (env["CEDAR_FUZZ_SEED"])
    return [positive(env["CEDAR_FUZZ_SEED"], "CEDAR_FUZZ_SEED")];
  const count = positive(
    env["CEDAR_FUZZ_RUNS"] ?? String(defaultRuns),
    "CEDAR_FUZZ_RUNS",
  );
  return Array.from({ length: count }, (_, index) => index + 1);
}

/** Await every replay and shrink before reporting a deterministic async failure. */
export async function checkAsyncHistory<T>(
  seed: number,
  history: T[],
  replay: (commands: T[]) => Promise<void>,
): Promise<void> {
  const failure = async (candidate: T[]) => {
    try {
      await replay(candidate);
      return null;
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  };
  const original = await failure(history);
  if (!original) return;
  // Include the assertion site: generic expect() messages alone can describe
  // different bugs. Deletion must not shrink into a different failed invariant.
  const signature = (error: Error) =>
    error.message.split(": expected")[0].split("\n")[0] +
    (error.stack?.split("\n").find((line) => /\.spec\.[jt]s:/.test(line)) ??
      "");
  let minimal = history;
  for (
    let size = Math.ceil(minimal.length / 2);
    size >= 1;
    size = Math.floor(size / 2)
  ) {
    for (let start = 0; start < minimal.length;) {
      const candidate = [
        ...minimal.slice(0, start),
        ...minimal.slice(start + size),
      ];
      const error = await failure(candidate);
      if (error && signature(error) === signature(original))
        minimal = candidate;
      else start += size;
    }
  }
  throw new Error(
    `Seed ${seed}; reduced from ${history.length} to ${minimal.length} commands:\n${JSON.stringify(minimal)}\n${original.message}`,
    { cause: original },
  );
}
