import { signal } from "@angular/core";
import { writeRequiresRecovery } from "./write-failure";
import { Operation, OperationCoordinator } from "./operation-coordinator";

/** Owns a revision-bearing screen's reads, writes and confirmation decisions. */
export class RevisionCoordinator {
  private readonly operations = new OperationCoordinator<"read" | "write">();
  readonly phase = signal<"idle" | "read" | "write">("idle");
  readonly reloadRequired = signal(false);
  private generation = 0;
  get active() {
    return this.operations.active;
  }
  get report() {
    return {
      phase: this.phase(),
      reloadRequired: this.reloadRequired(),
      operations: this.operations.report,
    };
  }
  checkpoint() {
    const generation = this.generation;
    return () =>
      this.active && generation === this.generation && this.phase() === "idle";
  }
  read() {
    return this.begin("read");
  }
  write(independent = false) {
    return this.begin("write", independent);
  }
  private begin(kind: "read" | "write", independent = false): Operation | null {
    if (
      !this.active ||
      this.phase() === "write" ||
      (kind === "write" &&
        (this.phase() !== "idle" || (!independent && this.reloadRequired())))
    )
      return null;
    this.generation++;
    const op = this.operations.begin(kind, ["read", "write"]);
    this.phase.set(kind);
    return {
      current: op.current,
      finish: () => {
        if (!op.current()) return;
        op.finish();
        this.phase.set("idle");
        if (kind === "read") this.reloadRequired.set(false);
      },
      fail: (error) => {
        if (!op.current()) return;
        op.fail(error);
        this.phase.set("idle");
        // Unknown write outcomes must be read back before another conditional mutation.
        if (
          kind === "write" &&
          writeRequiresRecovery(error)
        )
          this.reloadRequired.set(true);
      },
    };
  }
  dispose() {
    this.generation++;
    this.operations.dispose();
  }
}
