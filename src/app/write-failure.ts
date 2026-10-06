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

export function writeRequiresRecovery(error: unknown): boolean {
  return (
    uncertainWrite(error) ||
    (error instanceof HttpError &&
      [401, 403, 404, 409, 412, 428].includes(error.status))
  );
}
