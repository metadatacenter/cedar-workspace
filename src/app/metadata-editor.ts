import { JsonSourcePolicy, parseJson, canonicalJson } from "./json-policy";
import {
  mintResourceId,
  resourceSelector,
  resourcePathId,
} from "./resource-address";
import { Toast } from "./toast";
import { WorkspaceReturn } from "./workspace-return";
import { Confirmation } from "./confirmation";
import { Icon } from "./icon";
import { Tooltip } from "./tooltip";
import { PinBelow } from "./pin-below";
import {
  AfterViewInit,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
  inject,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { TranslatePipe } from "@ngx-translate/core";
import { ActivatedRoute, Router } from "@angular/router";
import type {
  CedarEmbeddableEditorElement,
  CeeConfig,
  CeeSaveSnapshot,
  CeeJsonObject,
  CeeValidationProblem,
} from "cedar-embeddable-editor";
import { Backend, HttpError, refusedRead } from "./backend.service";
import { uncertainWrite, writeRequiresRecovery } from "./write-failure";
import {
  MetadataState,
  MetadataProblem,
  problemSeverity,
} from "./metadata-state";
import { CeeLoader } from "./cee-loader";
import { can, Resource } from "./resource";
import { I18n, fallbackLanguage } from "./i18n";

import {
  sameStoredRevision,
  metadataCreateOutcome,
  metadataUpdateOutcome,
} from "./metadata-save-recovery";
import {
  MetadataCreateAttempt,
  MetadataDraft,
  MetadataDraftStore,
  metadataDraftScope,
} from "./metadata-draft";

import {
  reconcileMetadata,
  ReconciliationChange,
} from "./metadata-reconciliation";

export { metadataRoute, leaveMetadata } from "./metadata-route";

export function workspaceReturn(value: string | null, folder: string): string {
  const fallback =
    "/dashboard?" + new URLSearchParams({ folderId: resourceSelector(folder) });
  if (!value) return fallback;
  try {
    const url = new URL(value, location.origin);
    return url.origin === location.origin &&
      /^\/(dashboard\/?|)$/.test(url.pathname)
      ? url.pathname + url.search + url.hash
      : fallback;
  } catch {
    return fallback;
  }
}
// Compare values rather than serialization property order, including exact reverts.
export function metadataKey(value: unknown): string {
  return canonicalJson(value);
}
// CEE shows one entry at a time of a repeated element or field, but a checkbox group or a
// multiple-choice list shows all of its selections in one control.
function pagesEntries(property: CeeJsonObject): boolean {
  const items = property["items"] as CeeJsonObject | undefined;
  if (property["type"] !== "array" || !items) return false;
  const inputType = (items["_ui"] as CeeJsonObject | undefined)?.["inputType"];
  return inputType !== "checkbox" && inputType !== "list";
}
// Resolve each property in its declaring parent, including repeated elements.
// Use the same label precedence as CEE's rendered field headings. A repeated element or
// field is numbered by the entry the problem is in, so two entries holding the same bad
// value read as two places.
export function metadataFieldLabel(
  template: CeeJsonObject,
  path: string[],
  occurrences: readonly number[] = [],
): string {
  let parent = template;
  let entry = 0;
  return path
    .map((key) => {
      const properties = parent["properties"] as CeeJsonObject | undefined;
      const property = properties?.[key] as CeeJsonObject | undefined;
      if (!property) return /^\d+$/.test(key) ? `#${Number(key) + 1}` : key;
      const index =
        pagesEntries(property) && entry < occurrences.length
          ? occurrences[entry++]
          : undefined;
      const child =
        (property["items"] as CeeJsonObject | undefined) || property;
      const labels = (parent["_ui"] as CeeJsonObject | undefined)?.[
        "propertyLabels"
      ] as CeeJsonObject | undefined;
      // The parent's label for this use of the child counts only where it says something the key
      // and the child's own name do not. Templates often repeat the key there.
      const declared = labels?.[key];
      const own = child["schema:name"];
      const deployment =
        declared == null || declared === key || declared === own
          ? undefined
          : declared;
      const label = deployment ?? child["skos:prefLabel"] ?? own ?? key;
      parent = child;
      return index === undefined ? String(label) : `${label} ${index + 1}`;
    })
    .join(" · ");
}
// The minimum a repeated property declares, read where its declaring parent states it.
function declaredMinItems(
  template: CeeJsonObject,
  path: string[],
): number | undefined {
  let parent = template;
  let property: CeeJsonObject | undefined;
  for (const key of path) {
    const found = (parent["properties"] as CeeJsonObject | undefined)?.[key] as
      CeeJsonObject | undefined;
    if (!found) continue;
    property = found;
    parent = (found["items"] as CeeJsonObject | undefined) || found;
  }
  const min = property?.["minItems"];
  return typeof min === "number" ? min : undefined;
}
// Prefer CEE's localized explanation; retain the fallback for older bundles.
export function metadataWarningMessage(
  template: CeeJsonObject,
  problem: MetadataProblem,
  t: (key: string, params?: Record<string, unknown>) => string,
): string {
  if (typeof problem.displayMessage === "string" && problem.displayMessage)
    return problem.displayMessage;
  switch (problem.code) {
    case "required":
      return t("Metadata.ProblemRequired");
    case "minItems": {
      const min = declaredMinItems(template, problem.path);
      if (typeof problem.value === "number" && min !== undefined)
        return t("Metadata.ProblemMinItems", { count: problem.value, min });
    }
  }
  return problem.message || problem.code;
}
// Problems the instance may be saved with: a required value nobody has given, and a list
// shorter than its minimum. Every other problem refuses Save.

/** One line of the page's error or warning list, and the problem it leads to, if any. */
export interface MetadataIssue {
  label: string;
  message: string;
  problem?: CeeValidationProblem;
  diagnostic?: string;
}
interface PendingMetadataUpdate {
  purpose: "save" | "access" | "acknowledgement";
  opened: CeeJsonObject;
  submitted: CeeJsonObject;
  etag: string;
  snapshot: CeeSaveSnapshot;
  typedName: string;
}
/** A create page's identity and, once Save was pressed, what its last attempt sent. */
interface PendingMetadataCreation {
  id: string;
  attempt?: MetadataCreateAttempt & { snapshot: CeeSaveSnapshot };
}

@Component({
  selector: "cedar-metadata-page",
  imports: [
    Toast,
    WorkspaceReturn,
    Icon,
    Tooltip,
    PinBelow,
    FormsModule,
    TranslatePipe,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: "./metadata-editor.html",
})
export class MetadataEditor implements AfterViewInit, OnDestroy {
  readonly confirmation = inject(Confirmation);
  readonly api = inject(Backend);
  protected readonly i18n = inject(I18n);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly loader = inject(CeeLoader);
  @ViewChild("editorHost", { static: true })
  editorHost!: ElementRef<HTMLElement>;
  editor!: ElementRef<CedarEmbeddableEditorElement>;
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly checkingSave = signal(false);
  readonly canCheckSave = signal(false);
  readonly canRecheckAccess = signal(false);
  /** The last check of a create's outcome was refused because the session has ended. */
  readonly creationCheckRefused = signal(false);
  private pendingUpdate?: PendingMetadataUpdate;
  private creation?: PendingMetadataCreation;
  readonly review = signal<{
    base: CeeJsonObject;
    mine: CeeJsonObject;
    latest: CeeJsonObject;
    etag: string;
    sourceKey: string;
    choices: Map<string, "mine" | "latest">;
    metadata: CeeJsonObject;
    changes: ReconciliationChange[];
    complete: boolean;
  } | null>(null);
  readonly recoveryDraft = signal<MetadataDraft | null>(null);
  readonly draftStorageError = signal(false);
  private draftStore?: MetadataDraftStore;
  private draftScope?: string;
  private editorConfig?: CeeConfig;
  private recoveryTemplateChanged = false;
  private latestRead?: {
    saved?: CeeJsonObject;
    etag: string | null;
    template: CeeJsonObject;
    writable: boolean;
  };
  readonly dirty = signal(false);
  readonly writable = signal(false);
  readonly error = signal("");
  /**
   * Loading again cannot help: CEE refused the stored template or instance as unreadable, or the
   * user may not read the instance's template.
   */
  readonly unreadable = signal(false);
  readonly notice = signal("");
  readonly state = new MetadataState();
  readonly quality = this.state.quality;
  name = "";
  templateName = "";
  returnTo = "/dashboard";
  private folder = "";
  private template!: CeeJsonObject;
  private saved?: CeeJsonObject;
  // Until it is edited, an instance is unmodified, whether read from the server or new; only a save made here is reported as saved.
  private savedHere = false;
  private etag: string | null = null;
  private baseline = "";
  // The name, trimmed, as it was when the page last matched the server. Save trims the name, so
  // spaces around it change nothing that is stored and are not an edit.
  private baselineName = "";
  private alive = true;
  private openingAccessRefused = false;
  private updatingAddress = false;
  private get cee() {
    return this.editor.nativeElement;
  }
  private chosenName() {
    return this.name.trim() || this.defaultName();
  }
  private defaultName() {
    return this.i18n.t("Metadata.DefaultName", { template: this.templateName });
  }
  async ngAfterViewInit() {
    await this.load();
  }
  private offerStoredRecovery() {
    if (this.draftStore || !this.api.config?.resourceRestAPI) return;
    const id = this.route.snapshot.paramMap.get("id");
    const mode = this.route.snapshot.paramMap.get("mode");
    const folder =
      this.route.snapshot.queryParamMap.get("folderId") ||
      this.api.profile?.homeFolderId;
    if (!id || !mode || (mode === "create" && !folder)) return;
    let account: string;
    try {
      account = this.api.userId;
    } catch {
      return;
    }
    if (!account) return;
    this.draftScope = metadataDraftScope(
      this.api.config.resourceRestAPI,
      account,
      mode,
      resourcePathId(id),
      resourceSelector(folder || ""),
    );
    try {
      this.draftStore = new MetadataDraftStore(this.draftScope, sessionStorage);
      this.recoveryDraft.set(this.draftStore.read());
    } catch {
      this.draftStorageError.set(true);
    }
  }
  get recoveryReady() {
    return !!this.editorConfig && (!this.loading() || this.state.loadFailed());
  }
  private async load() {
    const operation = this.state.begin("load", ["save", "recovery"]);
    this.loading.set(true);
    this.checkingSave.set(false);
    this.canCheckSave.set(false);
    this.canRecheckAccess.set(false);
    this.pendingUpdate = undefined;
    this.state.loadFailed.set(false);
    this.openingAccessRefused = false;
    this.unreadable.set(false);
    this.error.set("");
    this.editor?.nativeElement.removeEventListener("change", this.changed);
    this.editor?.nativeElement.removeEventListener(
      "validationChange",
      this.validated,
    );
    try {
      if (!(await this.api.init()) || !operation.current()) return;
      this.folder =
        this.route.snapshot.queryParamMap.get("folderId") ||
        this.api.profile.homeFolderId;
      this.returnTo = workspaceReturn(
        this.route.snapshot.queryParamMap.get("returnTo"),
        this.folder,
      );
      const id = this.route.snapshot.paramMap.get("id")!;
      const mode = this.route.snapshot.paramMap.get("mode");
      this.latestRead = undefined;
      this.recoveryTemplateChanged = false;
      this.offerStoredRecovery();
      const configResponse = await fetch(
        "/config/embeddable-editor-config.json",
        { cache: "no-store" },
      );
      if (!configResponse.ok)
        throw new Error(this.i18n.t("Metadata.ConfigurationUnavailable"));
      const config: CeeConfig = await configResponse.json();
      this.editorConfig = config;
      if (!operation.current()) return;
      let saved: CeeJsonObject | undefined,
        etag: string | null = null,
        template: CeeJsonObject,
        writable: boolean;
      if (mode === "edit") {
        const path =
          "/template-instances/" + encodeURIComponent(resourcePathId(id));
        const [instance, report] = await Promise.all([
          this.api.request<CeeJsonObject>(path),
          this.api.request<Resource>(path + "/report"),
        ]);
        if (!operation.current()) return;
        saved = instance.data;
        etag = instance.etag;
        writable = can(report.data, "updateResource");
        const templateId = saved?.["schema:isBasedOn"];
        if (typeof templateId !== "string" || !templateId.trim())
          throw new Error(this.i18n.t("Metadata.NoTemplate"));
        try {
          template = (
            await this.api.request<CeeJsonObject>(
              "/templates/" + encodeURIComponent(resourcePathId(templateId)),
            )
          ).data;
        } catch (e) {
          // An instance can be shared with someone its template is not. The server's own refusal
          // speaks of "the artifact", which reads as the instance this page opened.
          if (refusedRead(e)) {
            this.openingAccessRefused = true;
            this.unreadable.set(true);
            throw new Error(this.i18n.t("Errors.TemplateUnreadable"));
          }
          throw e;
        }
      } else {
        const [result, folder] = await Promise.all([
          this.api.request<CeeJsonObject>(
            "/templates/" + encodeURIComponent(resourcePathId(id)),
          ),
          this.api.request<Resource>(
            "/folders/" + encodeURIComponent(resourcePathId(this.folder)),
          ),
        ]);
        template = result.data;
        writable = can(folder.data, "createInFolder");
      }
      if (!operation.current()) return;
      if (
        !template ||
        typeof template["@id"] !== "string" ||
        !template["@id"].trim()
      )
        throw new Error(this.i18n.t("Metadata.NoTemplate"));
      await this.loader.load();
      if (!operation.current()) return;
      this.editor = new ElementRef(
        this.loader.mountEditor(this.editorHost.nativeElement),
      );
      this.saved = saved;
      this.latestRead = { saved, etag, template, writable };
      this.etag = etag;
      this.template = template;
      this.writable.set(writable);
      this.state.reloadRequired.set(false);
      this.state.clearServer();
      this.templateName = String(
        template["schema:name"] || this.i18n.t("Common.Untitled"),
      );
      this.name = saved
        ? String(saved["schema:name"] || "")
        : this.defaultName();
      this.cee.config = {
        ...config,
        readOnlyMode: !writable,
        defaultLanguage: this.i18n.language,
        fallbackLanguage,
      };
      if (saved)
        this.cee.templateAndInstanceObject = {
          templateObject: template,
          instanceObject: saved,
        };
      else this.cee.templateObject = template;
      // CEE builds no form for an artifact it cannot read, such as a template whose child is stored
      // under a reserved key. It then holds no artifact, so its metadata is empty straight after the
      // assignment, which its public API names as the sign of a refusal.
      if (Object.keys(this.cee.currentMetadata ?? {}).length === 0) {
        this.unreadable.set(true);
        throw new Error(
          this.i18n.t(
            saved
              ? "Metadata.UnreadableInstance"
              : "Metadata.UnreadableTemplate",
          ),
        );
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (!operation.current()) return;
      this.baseline = metadataKey(this.cee.currentMetadata);
      this.baselineName = this.name.trim();
      this.dirty.set(false);
      this.savedHere = false;
      this.notice.set("");
      this.cee.addEventListener("change", this.changed);
      this.cee.addEventListener("validationChange", this.validated);
      this.refreshQuality();
      this.loading.set(false);
      operation.finish();
    } catch (e) {
      if (!operation.current()) return;
      operation.fail(e);
      this.offerStoredRecovery();
      this.state.loadFailed.set(true);
      this.openingAccessRefused ||=
        e instanceof HttpError && [401, 403].includes(e.status);
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }
  get canRecheckOpeningAccess() {
    return (
      this.alive &&
      (this.state.loadFailed()
        ? this.openingAccessRefused
        : !this.loading() && !this.writable()) &&
      !this.state.reloadRequired() &&
      !this.recoveryDraft() &&
      !this.dirty()
    );
  }
  async recheckOpeningAccess() {
    if (!this.canRecheckOpeningAccess || this.saving() || this.checkingSave())
      return;
    await this.load();
  }
  async reload() {
    if (
      !this.alive ||
      this.saving() ||
      this.checkingSave() ||
      this.state.uncertainCreation()
    )
      return;
    const decision = this.state.checkpoint();
    const draft = this.editor ? this.draftKey() : null;
    if (
      this.dirty() &&
      !(await this.confirmation.confirm(this.i18n.t("Metadata.DiscardChanges")))
    )
      return;
    if (
      decision() &&
      !this.saving() &&
      !this.state.uncertainCreation() &&
      draft === (this.editor ? this.draftKey() : null)
    ) {
      if (!this.state.loadFailed()) this.clearRecovery();
      await this.load();
    }
  }
  private draftKey() {
    return metadataKey([
      this.cee.currentMetadata,
      this.name,
      this.cee.captureDraft?.()?.drafts ?? [],
    ]);
  }
  private refreshQuality() {
    try {
      this.state.observe(this.cee.dataQualityReport, this.draftKey());
    } catch {
      this.state.observe(null, "unavailable");
    }
  }
  readonly validated = () => {
    if (!this.loading() && this.alive) this.refreshQuality();
  };
  readonly changed = () => {
    if (this.loading() || !this.alive) return;
    this.refreshQuality();
    this.dirty.set(
      metadataKey(this.cee.currentMetadata) !== this.baseline ||
        this.name.trim() !== this.baselineName ||
        !!this.cee.captureDraft?.()?.drafts.length,
    );
    this.notice.set("");
    this.keepRecovery();
  };

  private recoveryValue(pending = this.pendingUpdate): MetadataDraft | null {
    const draft = this.editor?.nativeElement.captureDraft?.();
    if (!draft || !this.draftScope) return null;
    return {
      format: "cedar-workspace-draft",
      version: 1,
      scope: this.draftScope,
      draft,
      name: this.name,
      baseline: this.baseline,
      baselineName: this.baselineName,
      saved: this.saved,
      etag: this.etag,
      reloadRequired: this.state.reloadRequired(),
      uncertainCreation: this.state.uncertainCreation(),
      ...(this.creation
        ? {
            creation: {
              id: this.creation.id,
              ...(this.creation.attempt
                ? {
                    attempt: {
                      submitted: this.creation.attempt.submitted,
                      metadata: this.creation.attempt.metadata,
                      typedName: this.creation.attempt.typedName,
                      needsElementIds: this.creation.attempt.needsElementIds,
                    },
                  }
                : {}),
            },
          }
        : {}),
      server: this.state.captureServer(),
      ...(pending
        ? {
            pending: {
              purpose: pending.purpose,
              opened: pending.opened,
              submitted: pending.submitted,
              etag: pending.etag,
              typedName: pending.typedName,
              metadata: pending.snapshot.metadata,
              needsElementIds: pending.snapshot.needsElementIds,
            },
          }
        : {}),
    };
  }
  private keepRecovery(force = false) {
    if (
      this.loading() ||
      this.saving() ||
      !this.draftStore ||
      this.recoveryDraft()
    )
      return;
    try {
      // An identity a create was sent under stays in the journal even with nothing left to save. A
      // lookup that finds nothing cannot rule out that the request is still being carried out, so the
      // next attempt, after a reload too, must use the same identity.
      if (
        force ||
        this.dirty() ||
        this.state.reloadRequired() ||
        this.saving() ||
        !!this.creation?.attempt
      ) {
        const value = this.recoveryValue();
        if (!value) throw new Error();
        this.draftStore.write(value);
      } else this.draftStore.clear();
      this.draftStorageError.set(false);
    } catch {
      this.draftStorageError.set(true);
    }
  }
  private clearRecovery() {
    try {
      this.draftStore?.clear();
      this.recoveryDraft.set(null);
    } catch {
      this.draftStorageError.set(true);
    }
  }
  get canSignInAgain() {
    return (
      (this.state.loadFailed() && this.openingAccessRefused) ||
      this.canRecheckOpeningAccess ||
      this.canRecheckAccess() ||
      this.creationCheckRefused() ||
      (this.state.reloadRequired() &&
        !this.saved &&
        !this.state.uncertainCreation())
    );
  }
  signInAgain() {
    if (this.saving() || this.checkingSave()) return;
    if (this.canRecheckOpeningAccess) {
      this.api.signIn();
      return;
    }
    if (this.recoveryDraft()) {
      try {
        this.draftStore?.write(this.recoveryDraft()!);
        this.draftStorageError.set(false);
      } catch {
        this.draftStorageError.set(true);
      }
    } else this.keepRecovery(true);
    // Redirect only after retention succeeded; keep the author here if storage failed.
    if (!this.draftStore || this.draftStorageError()) return;
    this.api.signIn();
  }
  get canReviewLatest() {
    return (
      !!this.saved &&
      !this.loading() &&
      !this.saving() &&
      !this.checkingSave() &&
      !this.recoveryDraft() &&
      !this.state.uncertainCreation()
    );
  }
  async reviewLatest() {
    if (!this.canReviewLatest) return;
    const draft = this.cee.captureDraft();
    if (!draft || draft.drafts.length) {
      this.error.set(this.i18n.t("Metadata.ReviewFinishInput"));
      return;
    }
    const sourceKey = this.draftKey();
    const operation = this.state.begin("recovery");
    this.review.set(null);
    this.checkingSave.set(true);
    try {
      const path =
        "/template-instances/" +
        encodeURIComponent(resourcePathId(String(this.saved!["@id"])));
      const [latest, report] = await Promise.all([
        this.api.request<CeeJsonObject>(path),
        this.api.request<Resource>(path + "/report"),
      ]);
      if (!operation.current() || sourceKey !== this.draftKey()) return;
      if (!can(report.data, "updateResource"))
        throw new Error(this.i18n.t("Metadata.RecoveryReadOnly"));
      if (
        !latest.etag ||
        latest.data["@id"] !== this.saved!["@id"] ||
        latest.data["schema:isBasedOn"] !== this.template["@id"]
      )
        throw new Error(this.i18n.t("Metadata.RecoveryUnresolved"));
      const template = await this.api.request<CeeJsonObject>(
        "/templates/" +
          encodeURIComponent(resourcePathId(String(this.template["@id"]))),
      );
      if (!operation.current() || sourceKey !== this.draftKey()) return;
      if (metadataKey(template.data) !== metadataKey(this.template))
        throw new Error(this.i18n.t("Metadata.ReviewTemplateChanged"));
      const base = {
        ...parseJson<CeeJsonObject>(this.baseline),
        "schema:name": this.saved!["schema:name"],
      };
      const mine = { ...draft.metadata, "schema:name": this.chosenName() };
      const choices = new Map<string, "mine" | "latest">();
      this.review.set({
        base,
        mine,
        latest: latest.data,
        etag: latest.etag,
        sourceKey,
        choices,
        ...reconcileMetadata(base, mine, latest.data, choices),
      });
      this.error.set("");
    } catch (error) {
      if (operation.current())
        this.error.set(
          error instanceof Error
            ? error.message
            : this.i18n.t("Metadata.RecoveryUnavailable"),
        );
    } finally {
      if (operation.current()) this.checkingSave.set(false);
    }
  }
  reviewChoice(path: string[], choice: "mine" | "latest") {
    const review = this.review();
    if (!review) return;
    const choices = new Map(review.choices);
    choices.set(JSON.stringify(path), choice);
    this.review.set({
      ...review,
      choices,
      ...reconcileMetadata(review.base, review.mine, review.latest, choices),
    });
  }
  reviewValue(value: unknown) {
    return value === undefined
      ? this.i18n.t("Metadata.ReviewRemoved")
      : JsonSourcePolicy.stringify(value);
  }
  reviewLabel(path: string[]) {
    return (
      metadataFieldLabel(this.template, path) || this.i18n.t("Metadata.Label")
    );
  }
  applyReview() {
    const review = this.review();
    if (!review?.complete || !this.canReviewLatest) return;
    if (review.sourceKey !== this.draftKey()) {
      this.review.set(null);
      this.error.set(this.i18n.t("Metadata.ReviewStale"));
      return;
    }
    const holder = document.createElement("div");
    holder.hidden = true;
    this.editorHost.nativeElement.append(holder);
    try {
      const candidate = this.loader.mountEditor(holder);
      candidate.config = {
        ...this.editorConfig!,
        readOnlyMode: false,
        defaultLanguage: this.i18n.language,
        fallbackLanguage,
      };
      if (
        !candidate.restoreDraft({
          format: "cedar-cee-draft",
          version: 1,
          template: this.template,
          metadata: review.metadata,
          drafts: [],
        })
      )
        throw new Error();
      this.cee.removeEventListener("change", this.changed);
      this.cee.removeEventListener("validationChange", this.validated);
      this.editorHost.nativeElement.replaceChildren(candidate);
      this.editor = new ElementRef(candidate);
      this.saved = JsonSourcePolicy.clone(review.latest);
      this.etag = review.etag;
      this.baseline = metadataKey(review.latest);
      this.baselineName = String(review.latest["schema:name"] ?? "");
      this.name = String(review.metadata["schema:name"] ?? "");
      this.latestRead = {
        saved: this.saved,
        etag: this.etag,
        template: this.template,
        writable: true,
      };
      this.writable.set(true);
      this.recoveryTemplateChanged = false;
      this.state.reloadRequired.set(false);
      this.state.clearServer();
      this.pendingUpdate = undefined;
      this.canCheckSave.set(false);
      this.canRecheckAccess.set(false);
      this.review.set(null);
      candidate.addEventListener("change", this.changed);
      candidate.addEventListener("validationChange", this.validated);
      this.changed();
      this.notice.set(this.i18n.t("Metadata.ReviewApplied"));
    } catch {
      this.error.set(this.i18n.t("Metadata.RecoveryUnresolved"));
    } finally {
      holder.remove();
    }
  }
  async discardRecovery() {
    if (this.saving() || this.checkingSave()) return;
    const candidate = this.recoveryDraft();
    if (candidate?.uncertainCreation) {
      // A draft written before creates carried an identity offers no check of its outcome.
      this.error.set(
        this.i18n.t(
          candidate.creation
            ? "Metadata.CreateOutcomeUnknown"
            : "Metadata.LegacyCreateOutcomeUnknown",
        ),
      );
      return;
    }
    if (
      (await this.confirmation.confirm(
        this.i18n.t("Metadata.DiscardRecovery"),
      )) &&
      candidate === this.recoveryDraft()
    )
      this.clearRecovery();
  }
  // A restored form is a new CEE element. It can acknowledge identities for a save made before the
  // reload only while it still holds what that save submitted.
  private restoredSnapshot(
    metadata: CeeJsonObject,
    needsElementIds: boolean,
  ): CeeSaveSnapshot {
    const snapshot = this.cee.captureSave();
    return {
      metadata,
      needsElementIds,
      acknowledge: (stored) => {
        if (
          !snapshot ||
          metadataKey(snapshot.metadata) !== metadataKey(metadata)
        )
          throw new Error();
        return snapshot.acknowledge(stored);
      },
    };
  }
  async restoreRecovery() {
    const value = this.recoveryDraft();
    if (
      !value ||
      this.saving() ||
      this.checkingSave() ||
      !this.editorConfig ||
      (this.loading() && !this.state.loadFailed())
    )
      return;
    const before = this.editor ? this.draftKey() : null;
    if (
      this.dirty() &&
      !(await this.confirmation.confirm(this.i18n.t("Metadata.DiscardChanges")))
    )
      return;
    if (
      value !== this.recoveryDraft() ||
      (this.editor && before !== this.draftKey())
    )
      return;
    try {
      await this.loader.load();
      if (
        !this.alive ||
        this.saving() ||
        value !== this.recoveryDraft() ||
        (this.editor && before !== this.draftKey())
      )
        return;
      const latest = this.latestRead;
      this.recoveryTemplateChanged =
        !!latest &&
        metadataKey(latest.template) !== metadataKey(value.draft.template);
      const unchanged =
        latest &&
        metadataKey(latest.template) === metadataKey(value.draft.template) &&
        (value.saved
          ? !!latest.saved &&
            sameStoredRevision(value.etag ?? "", latest.etag) &&
            metadataKey(value.saved) === metadataKey(latest.saved)
          : !latest.saved);
      const holder = document.createElement("div");
      // Connect the candidate so Angular initializes its public methods, but retain the old form until restoration succeeds.
      holder.hidden = true;
      this.editorHost.nativeElement.append(holder);
      let candidate: CedarEmbeddableEditorElement;
      try {
        candidate = this.loader.mountEditor(holder);
        candidate.config = {
          ...this.editorConfig,
          readOnlyMode: !latest?.writable,
          defaultLanguage: this.i18n.language,
          fallbackLanguage,
        };
        if (!candidate.restoreDraft?.(value.draft)) throw new Error();
        this.editor?.nativeElement.removeEventListener("change", this.changed);
        this.editor?.nativeElement.removeEventListener(
          "validationChange",
          this.validated,
        );
        this.editorHost.nativeElement.replaceChildren(candidate);
      } finally {
        holder.remove();
      }
      this.editor = new ElementRef(candidate!);
      this.template = JsonSourcePolicy.clone(value.draft.template);
      this.templateName = String(
        this.template["schema:name"] || this.i18n.t("Common.Untitled"),
      );
      this.saved = JsonSourcePolicy.clone(value.saved);
      this.etag = value.etag;
      this.name = value.name;
      this.baseline = value.baseline;
      this.baselineName = value.baselineName;
      this.writable.set(!!latest?.writable);
      this.state.reloadRequired.set(
        (value.saved ? value.reloadRequired : false) ||
          !unchanged ||
          !latest?.writable ||
          !!value.pending ||
          value.uncertainCreation,
      );
      this.state.uncertainCreation.set(value.uncertainCreation);
      this.state.loadFailed.set(false);
      this.unreadable.set(false);
      this.state.clearServer();
      this.pendingUpdate = undefined;
      this.creationCheckRefused.set(false);
      if (value.pending) {
        const pending = value.pending;
        this.pendingUpdate = {
          ...pending,
          snapshot: this.restoredSnapshot(
            pending.metadata,
            pending.needsElementIds,
          ),
        };
      }
      const creation = value.creation;
      const attempt = creation?.attempt;
      this.creation = creation && {
        id: creation.id,
        ...(attempt
          ? {
              attempt: {
                ...attempt,
                snapshot: this.restoredSnapshot(
                  attempt.metadata,
                  attempt.needsElementIds,
                ),
              },
            }
          : {}),
      };
      if (
        !this.pendingUpdate &&
        this.state.reloadRequired() &&
        !value.uncertainCreation &&
        value.saved &&
        value.etag
      ) {
        const snapshot = this.cee.captureSave();
        if (snapshot)
          this.pendingUpdate = {
            purpose: "access",
            opened: value.saved,
            submitted: value.saved,
            etag: value.etag,
            typedName: value.name,
            snapshot,
          };
      }
      this.canCheckSave.set(
        value.uncertainCreation
          ? !!this.creation
          : !!this.pendingUpdate && this.pendingUpdate.purpose !== "access",
      );
      this.canRecheckAccess.set(
        this.pendingUpdate?.purpose === "access" && !value.uncertainCreation,
      );
      this.loading.set(false);
      this.recoveryDraft.set(null);
      this.cee.addEventListener("change", this.changed);
      this.cee.addEventListener("validationChange", this.validated);
      this.changed();
      if (value.server) {
        this.state.reject(value.server, value.server.key, this.template);
        this.keepRecovery();
      }
      this.error.set(
        this.state.reloadRequired()
          ? this.i18n.t(
              value.uncertainCreation && this.creation
                ? "Metadata.RestoredCreateNeedsCheck"
                : "Metadata.DraftNeedsReview",
            )
          : "",
      );
      this.notice.set(this.i18n.t("Metadata.DraftRestored"));
    } catch {
      this.error.set(this.i18n.t("Metadata.DraftInvalid"));
    }
  }
  /** The translation key for the toolbar's save status. */
  get saveStatus() {
    if (this.state.loadFailed()) return "Metadata.LoadFailed";
    if (this.loading()) return "Common.Loading";
    if (this.saving()) return "Common.Saving";
    if (this.state.reloadRequired()) return "Metadata.ReloadRequired";
    if (!this.writable()) return "Metadata.ReadOnly";
    return this.dirty()
      ? "Metadata.ModifiedStatus"
      : this.savedHere
        ? "Metadata.SavedStatus"
        : "Metadata.UnmodifiedStatus";
  }
  /** Save is refused because the page lists errors, rather than while it loads or saves. */
  get saveRefused() {
    return (
      !this.loading() &&
      !this.saving() &&
      (this.quality()?.pendingValidation === true ||
        this.quality()?.canSave === false ||
        this.validationErrors.length > 0 ||
        this.state.reloadRequired())
    );
  }
  get missingRequired() {
    const q = this.quality();
    return Math.max(
      0,
      (q?.requiredFieldValueCount || 0) -
        (q?.nonNullRequiredFieldValueCount || 0),
    );
  }
  get validationWarnings(): MetadataIssue[] {
    const q = this.quality();
    const problems = (q?.problems || []).filter(
      (p) => problemSeverity(p as MetadataProblem) === "warning",
    );
    const items: MetadataIssue[] = problems.map((p) => ({
      label: this.issueLabel(p),
      message: metadataWarningMessage(this.template, p, (key, params) =>
        this.i18n.t(key, params),
      ),
      problem: p.path.length ? p : undefined,
    }));
    if (this.missingRequired && !problems.some((p) => p.code === "required"))
      items.push({
        label: this.i18n.t("Metadata.Label"),
        message: this.i18n.counted(
          "Metadata.RequiredMissing",
          this.missingRequired,
        ),
      });
    return items;
  }
  get validationErrors(): MetadataIssue[] {
    const q = this.quality();
    const items: MetadataIssue[] = (q?.problems || [])
      .filter((p) => problemSeverity(p as MetadataProblem) === "error")
      .map((p) => ({
        label: this.issueLabel(p),
        message:
          p.code === "reportUnavailable"
            ? this.i18n.t("Metadata.ReviewInvalid")
            : p.displayMessage || p.message || p.code,
        diagnostic:
          p.displayMessage && p.displayMessage !== p.message
            ? p.message
            : undefined,
        problem: p.path.length ? p : undefined,
      }));
    if (
      q?.isValid === false &&
      !q.pendingValidation &&
      !items.length &&
      !this.validationWarnings.length
    )
      items.push({
        label: this.i18n.t("Metadata.Label"),
        message: this.i18n.t("Metadata.ReviewInvalid"),
      });
    return items;
  }
  private issueLabel(problem: CeeValidationProblem): string {
    return (
      metadataFieldLabel(this.template, problem.path, problem.occurrences) ||
      problem.field ||
      this.i18n.t("Metadata.Label")
    );
  }
  /** Take the user to the field a listed problem is about, on whichever page and entry holds it. */
  reveal(issue: MetadataIssue) {
    if (issue.problem) void this.cee.reveal(issue.problem);
  }
  async save() {
    if (
      !this.alive ||
      this.loading() ||
      this.saving() ||
      this.checkingSave() ||
      this.recoveryDraft() ||
      !this.writable() ||
      this.state.reloadRequired()
    )
      return;
    this.refreshQuality();
    if (
      this.quality()?.pendingValidation ||
      this.quality()?.canSave === false ||
      this.validationErrors.length
    )
      return;
    const operation = this.state.begin("save");
    const submittedKey = this.draftKey();
    this.saving.set(true);
    this.error.set("");
    this.notice.set("");
    let attempted = false;
    let pendingUpdate: PendingMetadataUpdate | undefined;
    let creation: PendingMetadataCreation | undefined;
    try {
      if (this.saved && !this.etag) {
        this.state.reloadRequired.set(true);
        throw new Error(this.i18n.t("Metadata.NoRevision"));
      }
      const snapshot = this.cee.captureSave();
      if (!snapshot)
        throw new Error(this.i18n.t("Metadata.UnreadableInstance"));
      const current = snapshot.metadata;
      let baseline = metadataKey(current);
      const name = this.chosenName();
      const typedName = this.name.trim();
      const metadata: CeeJsonObject = JsonSourcePolicy.clone(current);
      metadata["schema:name"] = name;
      metadata["schema:isBasedOn"] = this.template["@id"];
      let path: string;
      if (this.saved) {
        metadata["@id"] = this.saved["@id"];
        // The host owns the instance description; CEE has no control for editing it.
        // After a create, its unchanged form can still expose an empty description.
        if (Object.hasOwn(this.saved, "schema:description"))
          metadata["schema:description"] = this.saved["schema:description"];
        path =
          "/template-instances/" +
          encodeURIComponent(resourcePathId(String(this.saved["@id"])));
      } else {
        metadata["schema:description"] ||= String(
          this.template["schema:description"] || "",
        );
        // Every attempt creates under the one identity, so a repeat can never make a second
        // instance, and a lost reply is settled by reading that identity. Until the deployment's
        // base is known no identity can be minted, and the server mints one as it always has.
        const id = this.creation?.id ?? mintResourceId("template-instances");
        const folder =
          "?folder_id=" + encodeURIComponent(resourceSelector(this.folder));
        path = "/template-instances" + folder;
        if (id) {
          metadata["@id"] = id;
          creation = this.creation = {
            id,
            attempt: {
              submitted: JsonSourcePolicy.clone(metadata),
              metadata: snapshot.metadata,
              typedName,
              needsElementIds: snapshot.needsElementIds,
              snapshot,
            },
          };
          path =
            "/template-instances/" +
            encodeURIComponent(resourcePathId(id)) +
            folder;
        }
      }
      if (this.saved && this.etag)
        pendingUpdate = {
          purpose: "save",
          opened: JsonSourcePolicy.clone(this.saved),
          submitted: JsonSourcePolicy.clone(metadata),
          etag: this.etag,
          snapshot,
          typedName,
        };
      // Journal before the request: closing the page while it is in flight must not turn
      // an uncertain create into an unguarded new one, or an update into an unguarded retry.
      try {
        const value = this.recoveryValue(pendingUpdate);
        if (value)
          this.draftStore?.write({
            ...value,
            reloadRequired: true,
            uncertainCreation: !this.saved,
          });
      } catch {
        this.draftStorageError.set(true);
      }
      attempted = true;
      // A create carries no revision. Its identity is new, and the server refuses a repeat.
      const reply = await this.api.request<CeeJsonObject>(
        path,
        this.saved || creation ? "PUT" : "POST",
        metadata,
        this.saved ? this.etag : null,
      );
      if (!operation.current()) return;
      if (
        !reply.data ||
        typeof reply.data["@id"] !== "string" ||
        !reply.data["@id"].trim() ||
        ((this.saved || creation) && reply.data["@id"] !== metadata["@id"])
      ) {
        this.state.reloadRequired.set(true);
        this.state.uncertainCreation.set(!this.saved);
        throw new Error(this.i18n.t("Metadata.SaveUnconfirmed"));
      }
      if (creation) this.creation = undefined;
      const confirmedUpdate = pendingUpdate;
      pendingUpdate = undefined;
      // Write acknowledgements may be resource summaries. Retain submitted metadata
      // that the server does not repeat, while accepting its authoritative fields.
      this.saved = { ...metadata, ...reply.data };
      this.savedHere = true;
      this.etag = reply.etag;
      let identityRecovery = false;
      if (snapshot.needsElementIds) {
        try {
          if (!reply.etag)
            throw new Error(this.i18n.t("Metadata.SavedIdentityUnavailable"));
          const stored = await this.api.request<CeeJsonObject>(
            "/template-instances/" +
              encodeURIComponent(resourcePathId(String(this.saved["@id"]))),
          );
          if (!operation.current()) return;
          if (
            !sameStoredRevision(reply.etag, stored.etag) ||
            stored.data["@id"] !== this.saved["@id"]
          )
            throw new Error(this.i18n.t("Metadata.SavedIdentityUnavailable"));
          baseline = metadataKey(snapshot.acknowledge(stored.data));
          this.saved = stored.data;
        } catch {
          if (!operation.current()) return;
          identityRecovery = true;
        }
      }
      this.state.reloadRequired.set(!reply.etag || identityRecovery);
      if (this.state.reloadRequired() && confirmedUpdate) {
        this.pendingUpdate = { ...confirmedUpdate, purpose: "acknowledgement" };
        this.canCheckSave.set(true);
      }
      this.state.clearServer();
      this.baseline = baseline;
      this.baselineName = typedName;
      if (!(await this.moveToEditAddress(operation, !confirmedUpdate))) return;
      operation.finish();
      this.changed();
      if (this.canCheckSave())
        this.error.set(this.i18n.t("Metadata.SavedVerificationUnavailable"));
      else if (identityRecovery)
        this.error.set(this.i18n.t("Metadata.SavedIdentityUnavailable"));
      else if (!reply.etag) this.error.set(this.i18n.t("Metadata.NoRevision"));
      this.notice.set(
        this.i18n.t(
          this.dirty() ? "Metadata.SavedWithChanges" : "Common.Saved",
        ),
      );
    } catch (e) {
      if (!operation.current()) return;
      operation.fail(e);
      this.refreshQuality();
      const accessRefused =
        e instanceof HttpError && [401, 403].includes(e.status);
      if (pendingUpdate && (uncertainWrite(e) || accessRefused)) {
        this.pendingUpdate = {
          ...pendingUpdate,
          purpose: accessRefused ? "access" : "save",
        };
        this.canCheckSave.set(!accessRefused);
        this.canRecheckAccess.set(accessRefused);
      }
      // A create refused because its identity is already taken may have been committed by an
      // earlier attempt, so it is no more a failure than a lost reply is.
      const occupied =
        !!creation && e instanceof HttpError && [412, 428].includes(e.status);
      const unknown = attempted && (uncertainWrite(e) || occupied);
      if (attempted && writeRequiresRecovery(e)) {
        this.state.reloadRequired.set(true);
        if (!this.saved && unknown) {
          this.state.uncertainCreation.set(true);
          // Only an identity can be looked up.
          this.canCheckSave.set(!!creation);
        }
      }
      if (e instanceof HttpError) {
        this.state.reject(e.validationReport, submittedKey, this.template);
      }
      // A conflict here leaves the edits on screen, which only this editor can say.
      this.error.set(
        unknown
          ? this.i18n.t(
              this.saved || creation
                ? "Metadata.SaveUnconfirmed"
                : "Metadata.LegacySaveUnconfirmed",
            )
          : e instanceof HttpError && e.status === 412
            ? this.i18n.t(
                e.deleted ? "Metadata.ItemDeleted" : "Metadata.ItemChanged",
              )
            : e instanceof Error
              ? e.message
              : String(e),
      );
    } finally {
      if (operation.current()) {
        this.saving.set(false);
        this.keepRecovery();
      }
    }
  }
  /**
   * Show the saved instance at its edit address. With `rescope`, a create's journal moves to that
   * address as well: it is written there before the copy at the create address is removed, so later
   * edits and missing acknowledgements survive a reload. Answers whether the operation is current.
   */
  private async moveToEditAddress(
    operation: { current(): boolean },
    rescope: boolean,
  ) {
    const id = resourcePathId(String(this.saved!["@id"]));
    // Keep the CEE element, focus and any edits made while the save was pending.
    // Update the router as well as browser history: otherwise cancelling a
    // later navigation restores the original create URL. The same route
    // component is reused, so the CEE element and its working form survive.
    this.updatingAddress = true;
    try {
      await this.router.navigateByUrl(
        "/instances/edit/" +
          encodeURIComponent(id) +
          "?" +
          new URLSearchParams({
            folderId: resourceSelector(this.folder),
            returnTo: this.returnTo,
          }),
        { replaceUrl: true },
      );
    } finally {
      this.updatingAddress = false;
    }
    if (!operation.current()) return false;
    if (this.draftStore && this.draftScope && rescope) {
      const previous = this.draftStore;
      this.draftScope = metadataDraftScope(
        this.api.config.resourceRestAPI,
        this.api.userId,
        "edit",
        id,
        resourceSelector(this.folder),
      );
      this.draftStore = new MetadataDraftStore(this.draftScope, sessionStorage);
      try {
        const value = this.recoveryValue();
        if (value) this.draftStore.write(value);
        previous.clear();
      } catch {
        this.draftStorageError.set(true);
      }
    }
    return true;
  }
  /**
   * Settle a create whose outcome is unknown by reading the identity it was sent under. Found: the
   * instance exists and this page adopts it, keeping later edits as unsaved changes. Not found: it was
   * not created, and Save sends the same identity again. Anything else leaves Save blocked. The check
   * can be repeated, and a refusal of the session offers Sign in again.
   */
  private async checkCreation() {
    const creation = this.creation;
    if (
      !this.alive ||
      !creation ||
      this.loading() ||
      this.saving() ||
      this.checkingSave()
    )
      return;
    const operation = this.state.begin("recovery");
    this.checkingSave.set(true);
    this.creationCheckRefused.set(false);
    this.error.set(this.i18n.t("Metadata.CheckingSave"));
    // A changed template or lost permission still needs a reload whatever the outcome.
    const blocked = () => this.recoveryTemplateChanged || !this.writable();
    try {
      const path =
        "/template-instances/" +
        encodeURIComponent(resourcePathId(creation.id));
      const [stored, report] = await Promise.allSettled([
        this.api.request<CeeJsonObject>(path),
        this.api.request<Resource>(path + "/report"),
      ]);
      if (!operation.current()) return;
      if (stored.status === "rejected") {
        if (
          !(stored.reason instanceof HttpError) ||
          stored.reason.status !== 404
        )
          throw stored.reason;
        this.state.uncertainCreation.set(false);
        this.state.reloadRequired.set(blocked());
        this.canCheckSave.set(false);
        this.error.set(
          this.i18n.t(
            blocked() ? "Metadata.DraftNeedsReview" : "Metadata.CreateNotSaved",
          ),
        );
        operation.finish();
        return;
      }
      if (report.status === "rejected") throw report.reason;
      if (!can(report.value.data, "updateResource")) {
        this.error.set(this.i18n.t("Metadata.RecoveryReadOnly"));
        return;
      }
      const latest = stored.value;
      const result = metadataCreateOutcome(creation, latest, this.template);
      if (result === "unresolved") {
        this.error.set(this.i18n.t("Metadata.RecoveryUnresolved"));
        return;
      }
      // CEE binds the identities the server minted for new elements to the submitted occurrences,
      // keeping later edits. A stored instance holding other values leaves the form modified.
      const attempt = creation.attempt;
      let identityRecovery = false;
      let acknowledged: CeeJsonObject | undefined;
      if (attempt?.needsElementIds)
        try {
          acknowledged = attempt.snapshot.acknowledge(latest.data);
        } catch {
          identityRecovery = true;
        }
      if (result === "saved" && attempt) {
        this.baseline = metadataKey(acknowledged ?? attempt.metadata);
        this.baselineName = attempt.typedName;
      } else {
        this.baseline = metadataKey(latest.data);
        this.baselineName = String(latest.data["schema:name"] ?? "");
      }
      this.creation = undefined;
      this.saved = latest.data;
      this.etag = latest.etag;
      this.savedHere = true;
      this.state.uncertainCreation.set(false);
      this.state.reloadRequired.set(identityRecovery || blocked());
      this.state.clearServer();
      this.canCheckSave.set(false);
      if (!(await this.moveToEditAddress(operation, true))) return;
      this.changed();
      this.error.set(
        identityRecovery
          ? this.i18n.t("Metadata.SavedIdentityUnavailable")
          : blocked()
            ? this.i18n.t("Metadata.DraftNeedsReview")
            : "",
      );
      this.notice.set(
        this.i18n.t(
          this.dirty() ? "Metadata.SavedWithChanges" : "Metadata.SaveConfirmed",
        ),
      );
      operation.finish();
    } catch (error) {
      if (!operation.current()) return;
      operation.fail(error);
      this.creationCheckRefused.set(
        error instanceof HttpError && error.status === 401,
      );
      this.error.set(this.i18n.t("Metadata.RecoveryUnavailable"));
    } finally {
      if (operation.current()) {
        this.checkingSave.set(false);
        this.keepRecovery();
      }
    }
  }
  async checkSaveStatus() {
    if (this.creation && this.state.uncertainCreation())
      return this.checkCreation();
    const pending = this.pendingUpdate;
    if (
      !this.alive ||
      !pending ||
      this.loading() ||
      this.saving() ||
      this.checkingSave()
    )
      return;
    if (this.recoveryTemplateChanged) {
      this.error.set(this.i18n.t("Metadata.DraftNeedsReview"));
      return;
    }
    const operation = this.state.begin("recovery");
    this.checkingSave.set(true);
    const access = pending.purpose === "access";
    this.error.set(
      this.i18n.t(access ? "Metadata.CheckingAccess" : "Metadata.CheckingSave"),
    );
    try {
      const path =
        "/template-instances/" +
        encodeURIComponent(resourcePathId(String(pending.opened["@id"])));
      const [latest, report] = await Promise.all([
        this.api.request<CeeJsonObject>(path),
        this.api.request<Resource>(path + "/report"),
      ]);
      if (!operation.current()) return;
      if (!can(report.data, "updateResource")) {
        this.error.set(this.i18n.t("Metadata.RecoveryReadOnly"));
        return;
      }
      const result = metadataUpdateOutcome(pending, latest, this.template);
      if (
        result === "unresolved" ||
        (access && result !== "unchanged") ||
        (pending.purpose === "acknowledgement" && result !== "saved")
      ) {
        this.error.set(this.i18n.t("Metadata.RecoveryUnresolved"));
        return;
      }
      if (result === "saved") {
        // Acknowledge only after the values match. CEE binds minted IDs to the
        // original submitted objects, retaining later edits, moves and deletions.
        this.baseline = metadataKey(
          pending.snapshot.needsElementIds
            ? pending.snapshot.acknowledge(latest.data)
            : pending.snapshot.metadata,
        );
        this.baselineName = pending.typedName;
        this.saved = latest.data;
        this.etag = latest.etag;
        this.savedHere = true;
      }
      this.writable.set(true);
      if (this.editorConfig)
        this.cee.config = {
          ...this.editorConfig,
          readOnlyMode: false,
          defaultLanguage: this.i18n.language,
          fallbackLanguage,
        };
      this.state.reloadRequired.set(false);
      this.state.clearServer();
      this.pendingUpdate = undefined;
      this.canCheckSave.set(false);
      this.canRecheckAccess.set(false);
      this.changed();
      this.error.set("");
      this.notice.set(
        this.i18n.t(
          access
            ? "Metadata.AccessRestored"
            : result === "saved"
              ? "Metadata.SaveConfirmed"
              : "Metadata.SaveUnchanged",
        ),
      );
      operation.finish();
    } catch (error) {
      if (!operation.current()) return;
      operation.fail(error);
      this.error.set(
        this.i18n.t(
          access
            ? "Metadata.AccessUnavailable"
            : "Metadata.RecoveryUnavailable",
        ),
      );
    } finally {
      if (operation.current()) {
        this.checkingSave.set(false);
        this.keepRecovery();
      }
    }
  }
  async mayLeave() {
    if (this.updatingAddress) return true;
    if (!this.alive || this.saving()) return false;
    if (!this.dirty()) {
      // A create whose outcome is known keeps its identity across a reload, not after leaving.
      if (
        this.creation?.attempt &&
        !this.state.reloadRequired() &&
        !this.recoveryDraft()
      )
        this.clearRecovery();
      return true;
    }
    const decision = this.state.checkpoint();
    const draft = this.draftKey();
    const leave =
      (await this.confirmation.confirm(
        this.i18n.t("Metadata.DiscardChanges"),
      )) &&
      decision() &&
      !this.saving() &&
      draft === this.draftKey();
    // An unknown write outcome outlives discarded input; it must still block a repeated create.
    if (leave && !this.state.reloadRequired() && !this.recoveryDraft())
      this.clearRecovery();
    return leave;
  }
  back() {
    if (!this.saving()) void this.router.navigateByUrl(this.returnTo);
  }
  @HostListener("window:beforeunload", ["$event"]) beforeUnload(
    event: BeforeUnloadEvent,
  ) {
    this.keepRecovery();
    if (this.dirty() || this.saving()) {
      event.preventDefault();
      event.returnValue = "";
    }
  }
  ngOnDestroy() {
    this.alive = false;
    this.state.dispose();
    this.editor?.nativeElement.removeEventListener("change", this.changed);
    this.editor?.nativeElement.removeEventListener(
      "validationChange",
      this.validated,
    );
  }
}
