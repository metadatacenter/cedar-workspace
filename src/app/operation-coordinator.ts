export interface Operation {
  current(): boolean;
  finish(): void;
  fail(error: unknown): void;
}

/** Owns asynchronous results by scope. Replaced or disposed operations cannot change current state. */
export class OperationCoordinator<Scope extends string> {
  private readonly operations = new Map<
    Scope,
    { status: "pending" | "ready" | "error"; message: string }
  >();
  private disposed = false;

  begin(scope: Scope, invalidate: Scope[] = []): Operation {
    this.cancel(...invalidate);
    const state = {
      status: "pending" as "pending" | "ready" | "error",
      message: "",
    };
    if (!this.disposed) this.operations.set(scope, state);
    const current = () =>
      !this.disposed && this.operations.get(scope) === state;
    return {
      current,
      finish: () => {
        if (current()) state.status = "ready";
      },
      fail: (error) => {
        if (!current()) return;
        state.status = "error";
        state.message = error instanceof Error ? error.message : String(error);
      },
    };
  }

  cancel(...scopes: Scope[]) {
    scopes.forEach((scope) => this.operations.delete(scope));
  }
  dispose() {
    this.disposed = true;
    this.operations.clear();
  }
  get active() {
    return !this.disposed;
  }
  get report() {
    return [...this.operations].map(([scope, state]) => ({ scope, ...state }));
  }
}
