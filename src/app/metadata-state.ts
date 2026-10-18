import { signal } from "@angular/core";
import type {
  CeeDataQualityReport,
  CeeJsonObject,
  CeeValidationProblem,
} from "cedar-embeddable-editor";
import { OperationCoordinator } from "./operation-coordinator";
import {
  ValidationPolicy,
  type ValidationCategory,
  type VerificationStatus,
} from "cedar-model-typescript-library/policy";

/** Accept older component reports at the boundary, then classify every emitted problem. */
export type MetadataProblem = Omit<CeeValidationProblem, "severity"> & {
  severity?: "error" | "warning";
  origin?: "server";
  displayMessage?: string;
  blocksSave?: boolean;
  category?: ValidationCategory;
  verificationStatus?: VerificationStatus;
};
type ClassifiedProblem = MetadataProblem & { severity: "error" | "warning" };
type MetadataReport = Omit<CeeDataQualityReport, "problems"> & {
  pendingValidation?: boolean;
  canSave?: boolean;
  structurallyValid?: boolean;
  problems: ClassifiedProblem[];
};
export const problemSeverity = (problem: MetadataProblem) =>
  typeof problem.blocksSave === "boolean"
    ? problem.blocksSave
      ? "error"
      : "warning"
    : problem.severity === undefined
      ? ValidationPolicy.severity(problem.code)
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
export class MetadataState extends OperationCoordinator<
  "load" | "save" | "recovery"
> {
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
              (p["displayMessage"] === undefined ||
                typeof p["displayMessage"] === "string") &&
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
          ...(object(value) && value["pendingValidation"] === true
            ? { pendingValidation: true }
            : {}),
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
    const findings = value["findings"];
    if (Array.isArray(findings)) {
      for (const fact of findings) {
        if (
          !object(fact) ||
          typeof fact["code"] !== "string" ||
          typeof fact["message"] !== "string" ||
          typeof fact["path"] !== "string" ||
          fact["verificationStatus"] === "passed"
        )
          continue;
        const category = ValidationPolicy.category(fact["code"]);
        const blocksSave = ValidationPolicy.blocksSave(fact["code"]);
        const location = metadataLocation(template, fact["path"]);
        problems.push({
          code: fact["code"],
          category,
          blocksSave,
          severity: blocksSave ? "error" : "warning",
          origin: "server",
          path: location?.path ?? [],
          occurrences: location?.occurrences ?? [],
          field: fact["path"],
          inputType: null,
          message: fact["message"],
        });
      }
    }
    // Older servers expose only errors/warnings. New reports include the same legacy rows,
    // so prefer categorized facts instead of presenting each finding twice.
    if (!Array.isArray(findings) || problems.length === 0) {
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
            field:
              typeof entry["location"] === "string" ? entry["location"] : "",
            inputType: null,
            message: entry["message"],
          });
        }
      }
    }
    this.server = { key, problems };
    this.publish();
  }
  clearServer() {
    this.server = undefined;
    this.publish();
  }
  captureServer() {
    if (!this.server) return undefined;
    const rows = (severity: "error" | "warning") =>
      this.server!.problems.filter(
        (problem) => problem.severity === severity,
      ).map((problem) => ({
        location: problem.field,
        message: problem.message,
      }));
    return {
      key: this.server.key,
      errors: rows("error"),
      warnings: rows("warning"),
    };
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
      canSave:
        this.local.canSave !== false &&
        !problems.some((p) => problemSeverity(p) === "error"),
      structurallyValid:
        this.local.structurallyValid !== false &&
        !problems.some((p) => problemSeverity(p) === "error"),
      isValid: this.local.isValid && problems.length === 0,
    });
  }
}
