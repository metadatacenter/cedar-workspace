import { resourceSelector, resourcePathId } from "./resource-address";
import { Toast } from "./toast";
import { WorkspaceReturn } from "./workspace-return";
import { Confirmation } from "./confirmation";
import { Icon } from "./icon";
import { Tooltip } from "./tooltip";
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
import {
  ActivatedRoute,
  CanDeactivateFn,
  Router,
  UrlMatcher,
  UrlSegment,
} from "@angular/router";
import type {
  CedarEmbeddableEditorElement,
  CeeConfig,
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

export const metadataRoute: UrlMatcher = (segments) => {
  if (
    segments[0]?.path !== "instances" ||
    !["create", "edit"].includes(segments[1]?.path) ||
    segments.length < 3
  )
    return null;
  return {
    consumed: segments,
    posParams: {
      mode: segments[1],
      id: new UrlSegment(
        segments
          .slice(2)
          .map((s) => s.path)
          .join("/"),
        {},
      ),
    },
  };
};
export function workspaceReturn(value: string | null, folder: string): string {
  const fallback = "/dashboard?" + new URLSearchParams({ folderId: resourceSelector(folder) });
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
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((key) => [key, v[key]]),
        )
      : v,
  );
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
// CEE describes its problems in English for diagnostics, so the page states the ones
// it presents as warnings in the reader's language. Any other problem keeps CEE's text.
export function metadataWarningMessage(
  template: CeeJsonObject,
  problem: MetadataProblem,
  t: (key: string, params?: Record<string, unknown>) => string,
): string {
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
}
export const leaveMetadata: CanDeactivateFn<MetadataEditor> = (editor) =>
  editor.mayLeave();

@Component({
  selector: "cedar-metadata-page",
  imports: [Toast, WorkspaceReturn, Icon, Tooltip, FormsModule, TranslatePipe],
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
  private async load() {
    const operation = this.state.begin("load", ["save"]);
    this.loading.set(true);
    this.state.loadFailed.set(false);
    this.unreadable.set(false);
    this.error.set("");
    this.editor?.nativeElement.removeEventListener("change", this.changed);
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
      const configResponse = await fetch(
        "/config/embeddable-editor-config.json",
        { cache: "no-store" },
      );
      if (!configResponse.ok)
        throw new Error(this.i18n.t("Metadata.ConfigurationUnavailable"));
      const config: CeeConfig = await configResponse.json();
      if (!operation.current()) return;
      let saved: CeeJsonObject | undefined,
        etag: string | null = null,
        template: CeeJsonObject,
        writable: boolean;
      if (mode === "edit") {
        const path = "/template-instances/" + encodeURIComponent(resourcePathId(id));
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
      this.editor = new ElementRef(this.loader.mountEditor(this.editorHost.nativeElement));
      this.saved = saved;
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
        throw new Error(this.i18n.t(saved ? "Metadata.UnreadableInstance" : "Metadata.UnreadableTemplate"));
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (!operation.current()) return;
      this.baseline = metadataKey(this.cee.currentMetadata);
      this.baselineName = this.name.trim();
      this.dirty.set(false);
      this.savedHere = false;
      this.notice.set("");
      this.cee.addEventListener("change", this.changed);
      this.refreshQuality();
      this.loading.set(false);
      operation.finish();
    } catch (e) {
      if (!operation.current()) return;
      operation.fail(e);
      this.state.loadFailed.set(true);
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }
  async reload() {
    if (!this.alive || this.saving() || this.state.uncertainCreation()) return;
    const decision = this.state.checkpoint();
    const draft = this.editor ? this.draftKey() : null;
    if (
      this.dirty() &&
      !(await this.confirmation.confirm(this.i18n.t("Metadata.DiscardChanges")))
    )
      return;
    if (
      decision() && !this.saving() && !this.state.uncertainCreation() &&
      draft === (this.editor ? this.draftKey() : null)
    ) await this.load();
  }
  private draftKey() {
    return metadataKey([this.cee.currentMetadata, this.name]);
  }
  private refreshQuality() {
    try {
      this.state.observe(this.cee.dataQualityReport, this.draftKey());
    } catch {
      this.state.observe(null, "unavailable");
    }
  }
  readonly changed = () => {
    if (this.loading() || !this.alive) return;
    this.refreshQuality();
    this.dirty.set(
      metadataKey(this.cee.currentMetadata) !== this.baseline ||
        this.name.trim() !== this.baselineName,
    );
    this.notice.set("");
  };
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
      (this.validationErrors.length > 0 || this.state.reloadRequired())
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
        message: this.i18n.counted("Metadata.RequiredMissing", this.missingRequired),
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
            : p.message || p.code,
        problem: p.path.length ? p : undefined,
      }));
    if (
      q?.isValid === false &&
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
      !this.writable() ||
      this.state.reloadRequired()
    )
      return;
    this.refreshQuality();
    if (this.validationErrors.length) return;
    const operation = this.state.begin("save");
    const submittedKey = this.draftKey();
    this.saving.set(true);
    this.error.set("");
    this.notice.set("");
    let attempted = false;
    try {
      if (this.saved && !this.etag) {
        this.state.reloadRequired.set(true);
        throw new Error(this.i18n.t("Metadata.NoRevision"));
      }
      const current = this.cee.currentMetadata;
      const baseline = metadataKey(current);
      const name = this.chosenName();
      const typedName = this.name.trim();
      const metadata: CeeJsonObject = structuredClone(current);
      metadata["schema:name"] = name;
      metadata["schema:isBasedOn"] = this.template["@id"];
      let path =
        "/template-instances?folder_id=" + encodeURIComponent(resourceSelector(this.folder));
      if (this.saved) {
        metadata["@id"] = this.saved["@id"];
        path =
          "/template-instances/" +
          encodeURIComponent(resourcePathId(String(this.saved["@id"])));
      } else {
        metadata["schema:description"] ||= String(
          this.template["schema:description"] || "",
        );
      }
      attempted = true;
      const reply = await this.api.request<CeeJsonObject>(
        path,
        this.saved ? "PUT" : "POST",
        metadata,
        this.etag,
      );
      if (!operation.current()) return;
      if (
        !reply.data ||
        typeof reply.data["@id"] !== "string" ||
        !reply.data["@id"].trim() ||
        (this.saved && reply.data["@id"] !== this.saved["@id"])
      ) {
        this.state.reloadRequired.set(true);
        this.state.uncertainCreation.set(!this.saved);
        throw new Error(this.i18n.t("Metadata.SaveUnconfirmed"));
      }
      this.saved = reply.data;
      this.savedHere = true;
      this.etag = reply.etag;
      this.state.reloadRequired.set(!reply.etag);
      this.state.clearServer();
      this.baseline = baseline;
      this.baselineName = typedName;
      // Keep the CEE element, focus and any edits made while the save was pending.
      // Update the router as well as browser history: otherwise cancelling a
      // later navigation restores the original create URL. The same route
      // component is reused, so the CEE element and its working form survive.
      this.updatingAddress = true;
      try {
        await this.router.navigateByUrl(
          "/instances/edit/" +
            encodeURIComponent(resourcePathId(String(this.saved["@id"]))) +
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
      if (!operation.current()) return;
      operation.finish();
      this.changed();
      if (!reply.etag) this.error.set(this.i18n.t("Metadata.NoRevision"));
      this.notice.set(
        this.i18n.t(
          this.dirty() ? "Metadata.SavedWithChanges" : "Common.Saved",
        ),
      );
    } catch (e) {
      if (!operation.current()) return;
      operation.fail(e);
      this.refreshQuality();
      if (attempted && writeRequiresRecovery(e)) {
        this.state.reloadRequired.set(true);
        if (!this.saved && uncertainWrite(e)) this.state.uncertainCreation.set(true);
      }
      if (e instanceof HttpError) {
        this.state.reject(e.validationReport, submittedKey, this.template);
      }
      // A conflict here leaves the edits on screen, which only this editor can say.
      this.error.set(
        this.state.uncertainCreation()
          ? this.i18n.t("Metadata.SaveUnconfirmed")
          : e instanceof HttpError && e.status === 412
            ? this.i18n.t(e.deleted ? "Metadata.ItemDeleted" : "Metadata.ItemChanged")
            : e instanceof Error
              ? e.message
              : String(e),
      );
    } finally {
      if (operation.current()) this.saving.set(false);
    }
  }
  async mayLeave() {
    if (this.updatingAddress) return true;
    if (!this.alive || this.saving()) return false;
    if (!this.dirty()) return true;
    const decision = this.state.checkpoint();
    const draft = this.draftKey();
    return (
      await this.confirmation.confirm(this.i18n.t("Metadata.DiscardChanges")) &&
      decision() && !this.saving() && draft === this.draftKey()
    );
  }
  back() {
    if (!this.saving()) void this.router.navigateByUrl(this.returnTo);
  }
  @HostListener("window:beforeunload", ["$event"]) beforeUnload(
    event: BeforeUnloadEvent,
  ) {
    if (this.dirty() || this.saving()) {
      event.preventDefault();
      event.returnValue = "";
    }
  }
  ngOnDestroy() {
    this.alive = false;
    this.state.dispose();
    this.editor?.nativeElement.removeEventListener("change", this.changed);
  }
}
