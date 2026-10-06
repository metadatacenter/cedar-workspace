import { signal } from "@angular/core";
import type {
  CeeDataQualityReport,
  CeeJsonObject,
  CeeValidationProblem,
} from "cedar-embeddable-editor";
import { OperationCoordinator } from "./operation-coordinator";

/** Accept older component reports at the boundary, then classify every emitted problem. */
export type MetadataProblem = Omit<CeeValidationProblem, "severity"> & {
  severity?: "error" | "warning";
  origin?: "server";
};
type ClassifiedProblem = MetadataProblem & { severity: "error" | "warning" };
type MetadataReport = Omit<CeeDataQualityReport, "problems"> & {
  problems: ClassifiedProblem[];
};
export const problemSeverity = (problem: MetadataProblem) =>
  problem.severity === undefined
    ? ["required", "minItems"].includes(problem.code)
      ? "warning"
      : "error"
    : problem.severity === "warning"
      ? "warning"
      : "error";
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Converts an instance JSON Pointer to CEE's declaration path and repeated-entry coordinates. */
export function metadataLocation(
  template: CeeJsonObject,
  location: unknown,
): { path: string[]; occurrences: number[] } | undefined {
  if (
    typeof location !== "string" ||
    !location.startsWith("/") ||
    location === "/" ||
    /~(?![01])/.test(location)
  )
    return undefined;
  const segments = location
    .slice(1)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
  const path: string[] = [],
    occurrences: number[] = [];
  let parent = template;
  for (let i = 0; i < segments.length; i++) {
    const key = segments[i];
    const properties = parent["properties"];
    const property = object(properties) ? properties[key] : undefined;
    if (!object(property)) return undefined;
    path.push(key);
    let child = property;
    if (property["type"] === "array" && object(property["items"])) {
      child = property["items"];
      if (i + 1 < segments.length && /^(0|[1-9]\d*)$/.test(segments[i + 1])) {
        const index = Number(segments[++i]);
        if (!Number.isSafeInteger(index)) return undefined;
        const input = object(child["_ui"])
          ? child["_ui"]["inputType"]
          : undefined;
        if (input !== "checkbox" && input !== "list") occurrences.push(index);
      } else if (i + 1 < segments.length) return undefined;
    }
    // Value wrappers and language/type annotations belong to this field, not another control.
    if (
      i + 1 === segments.length - 1 &&
      ["@id", "@value", "@type", "@language", "rdfs:label"].includes(
        segments[i + 1],
      )
    )
      break;
    parent = child as CeeJsonObject;
  }
  return path.length ? { path, occurrences } : undefined;
}

/** One owner for loading, writes and the component/server reports about the current draft. */
export class MetadataState extends OperationCoordinator<"load" | "save"> {
  readonly quality = signal<MetadataReport | null>(null);
  readonly reloadRequired = signal(false);
  readonly loadFailed = signal(false);
  readonly uncertainCreation = signal(false);
  private currentKey = "";
  private local: MetadataReport | null = null;
  private server: { key: string; problems: ClassifiedProblem[] } | undefined;

  observe(value: unknown, key: string) {
    this.currentKey = key;
    if (this.server?.key !== key) this.server = undefined;
    const valid =
      object(value) &&
      typeof value["isValid"] === "boolean" &&
      (value["problems"] === undefined ||
        (Array.isArray(value["problems"]) &&
          value["problems"].every(
            (p) =>
              object(p) &&
              typeof p["code"] === "string" &&
              Array.isArray(p["path"]) &&
              p["path"].every((part) => typeof part === "string") &&
              (p["occurrences"] === undefined ||
                (Array.isArray(p["occurrences"]) &&
                  p["occurrences"].every(
                    (index) => Number.isSafeInteger(index) && index >= 0,
                  ))),
          )));
    const incoming = valid
      ? (structuredClone(value) as unknown as CeeDataQualityReport)
      : null;
    this.local = incoming
      ? {
          ...incoming,
          problems: (incoming.problems ?? []).map((problem) => ({
            ...problem,
            severity: problemSeverity(problem),
          })),
        }
      : {
          isValid: false,
          requiredFieldValueCount: 0,
          nonNullRequiredFieldValueCount: 0,
          problems: [
            {
              code: "reportUnavailable",
              severity: "error",
              path: [],
              occurrences: [],
              field: "",
              inputType: null,
              message: "",
            },
          ],
        };
    this.publish();
  }
  reject(value: unknown, key: string, template: CeeJsonObject) {
    if (key !== this.currentKey || !object(value)) return;
    const problems: ClassifiedProblem[] = [];
    for (const severity of ["error", "warning"] as const) {
      const entries = value[severity === "error" ? "errors" : "warnings"];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!object(entry) || typeof entry["message"] !== "string") continue;
        const location = metadataLocation(template, entry["location"]);
        problems.push({
          code: "serverValidation",
          severity,
          origin: "server",
          path: location?.path ?? [],
          occurrences: location?.occurrences ?? [],
          field: typeof entry["location"] === "string" ? entry["location"] : "",
          inputType: null,
          message: entry["message"],
        });
      }
    }
    this.server = { key, problems };
    this.publish();
  }
  clearServer() {
    this.server = undefined;
    this.publish();
  }
  private publish() {
    if (!this.local) {
      this.quality.set(null);
      return;
    }
    const problems = [...this.local.problems, ...(this.server?.problems ?? [])];
    this.quality.set({
      ...this.local,
      problems,
      isValid:
        this.local.isValid &&
        !problems.some((p) => problemSeverity(p) === "error"),
    });
  }
}
