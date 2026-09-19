import { Toast } from "./toast";
import { Confirmation } from "./confirmation";
import { Icon } from "./icon";
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
  CeeDataQualityReport,
  CeeJsonObject,
} from "cedar-embeddable-editor";
import { Backend } from "./backend.service";
import { CeeLoader } from "./cee-loader";
import { can, Resource } from "./resource";

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
  const fallback = "/dashboard?" + new URLSearchParams({ folderId: folder });
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
export const leaveMetadata: CanDeactivateFn<MetadataEditor> = (editor) =>
  editor.mayLeave();

@Component({
  selector: "cedar-metadata-page",
  imports: [Toast, Icon, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: "./metadata-editor.html",
})
export class MetadataEditor implements AfterViewInit, OnDestroy {
  readonly confirmation = inject(Confirmation);
  readonly api = inject(Backend);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly loader = inject(CeeLoader);
  @ViewChild("editor", { static: true })
  editor!: ElementRef<CedarEmbeddableEditorElement>;
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly dirty = signal(false);
  readonly writable = signal(false);
  readonly error = signal("");
  readonly notice = signal("");
  readonly quality = signal<CeeDataQualityReport | null>(null);
  name = "";
  templateName = "";
  returnTo = "/dashboard";
  private folder = "";
  private template!: CeeJsonObject;
  private saved?: CeeJsonObject;
  private etag: string | null = null;
  private baseline = "";
  private baselineName = "";
  private alive = true;
  private updatingAddress = false;
  private get cee() {
    return this.editor.nativeElement;
  }
  private chosenName() {
    return this.name.trim() || this.templateName + " metadata";
  }
  async ngAfterViewInit() {
    try {
      if (!(await this.api.init()) || !this.alive) return;
      this.folder =
        this.route.snapshot.queryParamMap.get("folderId") ||
        this.api.profile.homeFolderId;
      this.returnTo = workspaceReturn(
        this.route.snapshot.queryParamMap.get("returnTo"),
        this.folder,
      );
      const configResponse = await fetch(
        "/config/embeddable-editor-config.json",
        { cache: "no-store" },
      );
      if (!configResponse.ok)
        throw new Error("Unable to load metadata editor configuration.");
      const config: CeeConfig = await configResponse.json();
      const id = this.route.snapshot.paramMap.get("id")!;
      if (this.route.snapshot.paramMap.get("mode") === "edit") {
        const path = "/template-instances/" + encodeURIComponent(id);
        const [instance, report] = await Promise.all([
          this.api.request<CeeJsonObject>(path),
          this.api.request<Resource>(path + "/report"),
        ]);
        this.saved = instance.data;
        this.etag = instance.etag;
        this.writable.set(can(report.data, "updateResource"));
        const templateId = this.saved["schema:isBasedOn"];
        if (typeof templateId !== "string")
          throw new Error("Metadata does not identify its template.");
        this.template = (
          await this.api.request<CeeJsonObject>(
            "/templates/" + encodeURIComponent(templateId),
          )
        ).data;
      } else {
        const [template, folder] = await Promise.all([
          this.api.request<CeeJsonObject>(
            "/templates/" + encodeURIComponent(id),
          ),
          this.api.request<Resource>(
            "/folders/" + encodeURIComponent(this.folder),
          ),
        ]);
        this.template = template.data;
        this.writable.set(can(folder.data, "createInFolder"));
      }
      await this.loader.load();
      if (!this.alive) return;
      this.templateName = String(this.template["schema:name"] || "Untitled");
      this.name = this.saved
        ? String(this.saved["schema:name"] || "")
        : this.templateName + " metadata";
      // Both inputs are set once; permission must be settled before configuration.
      this.cee.config = { ...config, readOnlyMode: !this.writable() };
      if (this.saved)
        this.cee.templateAndInstanceObject = {
          templateObject: this.template,
          instanceObject: this.saved,
        };
      else this.cee.templateObject = this.template;
      // Angular Elements applies input setters in a microtask.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (!this.alive) return;
      this.baseline = metadataKey(this.cee.currentMetadata);
      this.baselineName = this.chosenName();
      this.cee.addEventListener("change", this.changed);
      this.quality.set(this.cee.dataQualityReport);
      this.loading.set(false);
    } catch (e) {
      if (this.alive)
        this.error.set(e instanceof Error ? e.message : String(e));
    }
  }
  readonly changed = () => {
    if (this.loading() || !this.alive) return;
    this.quality.set(this.cee.dataQualityReport);
    this.dirty.set(
      metadataKey(this.cee.currentMetadata) !== this.baseline ||
        this.chosenName() !== this.baselineName,
    );
    this.notice.set("");
  };
  get missingRequired() {
    const q = this.quality();
    return Math.max(
      0,
      (q?.requiredFieldValueCount || 0) -
        (q?.nonNullRequiredFieldValueCount || 0),
    );
  }
  async save() {
    if (this.loading() || this.saving() || !this.writable()) return;
    this.saving.set(true);
    this.error.set("");
    this.notice.set("");
    try {
      if (this.saved && !this.etag)
        throw new Error(
          "No concurrency validator was returned. Reload before saving. Your edits have been kept.",
        );
      const current = this.cee.currentMetadata;
      const baseline = metadataKey(current);
      const name = this.chosenName();
      const metadata: CeeJsonObject = structuredClone(current);
      metadata["schema:name"] = name;
      metadata["schema:isBasedOn"] = this.template["@id"];
      let path =
        "/template-instances?folder_id=" + encodeURIComponent(this.folder);
      if (this.saved) {
        metadata["@id"] = this.saved["@id"];
        path =
          "/template-instances/" +
          encodeURIComponent(String(this.saved["@id"]));
      } else {
        metadata["schema:description"] ||= String(
          this.template["schema:description"] || "",
        );
      }
      const reply = await this.api.request<CeeJsonObject>(
        path,
        this.saved ? "PUT" : "POST",
        metadata,
        this.etag,
      );
      if (!this.alive) return;
      this.saved = reply.data;
      this.etag = reply.etag;
      this.baseline = baseline;
      this.baselineName = name;
      // Keep the CEE element, focus and any edits made while the save was pending.
      // Update the router as well as browser history: otherwise cancelling a
      // later navigation restores the original create URL. The same route
      // component is reused, so the CEE element and its working form survive.
      this.updatingAddress = true;
      try {
        await this.router.navigateByUrl(
          "/instances/edit/" +
            encodeURIComponent(String(this.saved["@id"])) +
            "?" +
            new URLSearchParams({
              folderId: this.folder,
              returnTo: this.returnTo,
            }),
          { replaceUrl: true },
        );
      } finally {
        this.updatingAddress = false;
      }
      this.changed();
      this.notice.set(
        this.dirty() ? "Saved. You have further unsaved changes." : "Saved.",
      );
    } catch (e) {
      if (this.alive)
        this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.saving.set(false);
    }
  }
  async mayLeave() {
    return (
      this.updatingAddress ||
      (!this.saving() &&
        (!this.dirty() ||
          (await this.confirmation.confirm(
            "Discard unsaved metadata changes?",
          ))))
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
    this.cee.removeEventListener("change", this.changed);
  }
}
