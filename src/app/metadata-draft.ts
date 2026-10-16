import { resourcePathId } from "./resource-address";
import type { CeeJsonObject, CeeRecoveryDraft } from "cedar-embeddable-editor";

export interface MetadataDraft {
  format: "cedar-workspace-draft";
  version: 1;
  scope: string;
  draft: CeeRecoveryDraft;
  name: string;
  baseline: string;
  baselineName: string;
  saved?: CeeJsonObject;
  etag: string | null;
  reloadRequired: boolean;
  uncertainCreation: boolean;
  pending?: {
    purpose: "save" | "access" | "acknowledgement";
    opened: CeeJsonObject;
    submitted: CeeJsonObject;
    etag: string;
    typedName: string;
    metadata: CeeJsonObject;
    needsElementIds: boolean;
  };
}

/** One tab's recovery copy. Sign-in/reload retain it; other accounts and deployments cannot adopt it. */
export function metadataDraftScope(
  deployment: string,
  account: string,
  mode: string,
  id: string,
  folder: string,
): string {
  return JSON.stringify([
    deployment,
    account,
    mode,
    id,
    mode === "create" ? folder : "",
  ]);
}
export function readMetadataDraft(text: string, scope: string): MetadataDraft {
  const value = JSON.parse(text) as MetadataDraft;
  if (
    value?.format !== "cedar-workspace-draft" ||
    value.version !== 1 ||
    value.scope !== scope ||
    value.draft?.format !== "cedar-cee-draft" ||
    value.draft.version !== 1 ||
    typeof value.name !== "string" ||
    typeof value.baseline !== "string" ||
    typeof value.baselineName !== "string" ||
    (value.etag !== null && typeof value.etag !== "string") ||
    typeof value.reloadRequired !== "boolean" ||
    typeof value.uncertainCreation !== "boolean" ||
    (value.pending &&
      (!["save", "access", "acknowledgement"].includes(value.pending.purpose) ||
        typeof value.pending.etag !== "string" ||
        typeof value.pending.typedName !== "string" ||
        typeof value.pending.needsElementIds !== "boolean" ||
        !value.pending.metadata ||
        !value.pending.opened ||
        !value.pending.submitted))
  )
    throw new Error();
  const [, , mode, id] = JSON.parse(scope) as string[];
  const matches = (artifact: CeeJsonObject | undefined) =>
    typeof artifact?.["@id"] === "string" &&
    resourcePathId(artifact["@id"]) === id;
  if (
    (mode === "edit" && !matches(value.saved)) ||
    (mode === "create" &&
      (value.saved !== undefined || !matches(value.draft.template))) ||
    (value.pending &&
      (!matches(value.pending.opened) || !matches(value.pending.submitted)))
  )
    throw new Error();
  return value;
}
export class MetadataDraftStore {
  constructor(
    readonly scope: string,
    private readonly storage: Storage,
  ) {}
  private get key() {
    return "cedar.metadata.draft:" + this.scope;
  }
  read(): MetadataDraft | null {
    const text = this.storage.getItem(this.key);
    return text === null ? null : readMetadataDraft(text, this.scope);
  }
  write(value: MetadataDraft): void {
    this.storage.setItem(this.key, JSON.stringify(value));
  }
  clear(): void {
    this.storage.removeItem(this.key);
  }
}
