import { Collection, mintedResourceId } from "./resource-address";
import type { Version } from "./version-picker";

/**
 * These dialog actions carry no revision. A lost reply leaves their outcome unknown, and only a lookup
 * can settle it: New folder, Copy and Create Draft by the identity they create, Publish by the state
 * of the item it publishes.
 */
export const journaledActions: readonly string[] = [
  "new-folder",
  "copy",
  "draft",
  "publish",
];

/**
 * An entry records one dialog action that was sent. The tab keeps it so that reopening the same action
 * on the same item and destination, after a reload too, sends the same identity with the same values.
 */
export interface ActionJournal {
  format: "cedar-workspace-action";
  version: 1;
  scope: string;
  /** The identity the action creates. Publish creates none. */
  id: string | null;
  values: { name: string; description: string; version: Version };
  /** The last attempt was sent and its outcome is not known. */
  uncertain: boolean;
}

/** Other accounts, deployments, actions, items and destinations cannot adopt an entry. */
export function actionJournalScope(
  deployment: string,
  account: string,
  action: string,
  item: string,
  destination: string,
): string {
  return JSON.stringify([deployment, account, action, item, destination]);
}

const part = (value: unknown) =>
  Number.isSafeInteger(value) && (value as number) >= 0;

/** Reads an entry, refusing one of another scope or one whose identity is not in `collection`. */
export function readActionJournal(
  text: string,
  scope: string,
  collection: Collection | null,
): ActionJournal {
  const value = JSON.parse(text) as ActionJournal;
  const values = value?.values;
  if (
    value?.format !== "cedar-workspace-action" ||
    value.version !== 1 ||
    value.scope !== scope ||
    (collection === null
      ? value.id !== null
      : !mintedResourceId(value.id, collection)) ||
    typeof values?.name !== "string" ||
    typeof values.description !== "string" ||
    !Array.isArray(values.version) ||
    values.version.length !== 3 ||
    !values.version.every(part) ||
    typeof value.uncertain !== "boolean"
  )
    throw new Error();
  return value;
}

export class ActionJournalStore {
  constructor(
    readonly scope: string,
    private readonly storage: Storage,
  ) {}
  private get key() {
    return "cedar.action.journal:" + this.scope;
  }
  read(collection: Collection | null): ActionJournal | null {
    const text = this.storage.getItem(this.key);
    return text === null
      ? null
      : readActionJournal(text, this.scope, collection);
  }
  write(value: ActionJournal): void {
    this.storage.setItem(this.key, JSON.stringify(value));
  }
  clear(): void {
    this.storage.removeItem(this.key);
  }
}
