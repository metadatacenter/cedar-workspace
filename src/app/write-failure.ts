import { HttpError } from "./backend.service";

/** A missing/invalid acknowledgement cannot prove that a mutation did not commit. */
export function uncertainWrite(error: unknown): boolean {
  return (
    !(error instanceof HttpError) ||
    error.status === 0 ||
    (error.status >= 200 && error.status < 300) ||
    error.status === 408 ||
    error.status >= 500
  );
}

/**
 * Whether the server refused to publish an artifact, or to create a draft of it, because only its owner
 * may, whatever role the caller holds. Nothing was written, so the outcome is known and nothing needs
 * recovering.
 */
export function refusedToNonOwner(error: unknown): boolean {
  return (
    error instanceof HttpError &&
    error.status === 403 &&
    error.code === "versioningOnlyByOwner"
  );
}

export function writeRequiresRecovery(error: unknown): boolean {
  return (
    uncertainWrite(error) ||
    (error instanceof HttpError &&
      [401, 403, 404, 409, 412, 428].includes(error.status))
  );
}
