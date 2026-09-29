import { Tooltip } from "./tooltip";
import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  ViewChild,
  inject,
  signal,
} from "@angular/core";
import { TranslatePipe } from "@ngx-translate/core";
import type {
  CedarEmbeddableEditorElement,
  CedarEmbeddableFieldElement,
  CeeConfig,
  CeeJsonObject,
} from "cedar-embeddable-editor";
import { Backend } from "./backend.service";
import { CeeLoader } from "./cee-loader";
import { I18n, fallbackLanguage } from "./i18n";
import { Icon } from "./icon";
import { Resource, collections, title } from "./resource";

/** Render the element's contents as a transient template; the dialog owns its root heading. */
export function previewElement(element: CeeJsonObject): CeeJsonObject {
  return {
    ...element,
    "@id": "urn:cedar:workspace:element-preview",
    "@type": "https://schema.metadatacenter.org/core/Template",
  };
}

@Component({
  selector: "cedar-artifact-preview",
  imports: [Tooltip, Icon, TranslatePipe],
  template: `
    <dialog
      #dialog
      class="artifact-preview"
      [attr.aria-label]="name"
      (cancel)="$event.preventDefault(); $event.stopPropagation(); close()"
    >
      <header>
        <h2>{{ name }}</h2>
        <button
          autofocus
          type="button"
          [attr.aria-label]="'Preview.Close' | translate"
        [cedarTooltip]="'Preview.Close' | translate"
          (click)="close()"
        >
          <cedar-icon name="close" />
        </button>
      </header>
      <section
        tabindex="0"
        [attr.aria-label]="'Preview.Label' | translate"
        [attr.aria-busy]="loading()"
      >
        @if (loading()) {
          <p role="status">{{ "Common.Loading" | translate }}</p>
        }
        @if (error()) {
          <p role="alert">{{ "Preview.Unavailable" | translate }}</p>
        }
        <div #mount [hidden]="loading() || error()"></div>
      </section>
    </dialog>
  `,
  styleUrl: "./artifact-preview.scss",
})
export class ArtifactPreview implements AfterViewInit, OnDestroy {
  @Input({ required: true }) resource!: Resource;
  @Output() closed = new EventEmitter<void>();
  @ViewChild("dialog", { static: true }) dialog!: ElementRef<HTMLDialogElement>;
  @ViewChild("mount", { static: true }) mount!: ElementRef<HTMLDivElement>;
  private readonly api = inject(Backend);
  private readonly loader = inject(CeeLoader);
  private readonly i18n = inject(I18n);
  readonly loading = signal(true);
  readonly error = signal(false);
  private alive = true;
  private timer?: ReturnType<typeof setTimeout>;
  private originalFocus = document.activeElement as HTMLElement | null;
  get name() {
    return title(this.resource, this.i18n.t("Common.Untitled"));
  }
  private fail = () => {
    if (!this.alive) return;
    clearTimeout(this.timer);
    this.error.set(true);
    this.loading.set(false);
    this.mount.nativeElement.replaceChildren();
  };
  async ngAfterViewInit() {
    this.dialog.nativeElement.showModal();
    this.timer = setTimeout(this.fail, 30000);
    try {
      if (this.resource.resourceType === "folder") throw new Error();
      const [reply, config] = await Promise.all([
        this.api.request<CeeJsonObject>(
          "/" +
            collections[this.resource.resourceType] +
            "/" +
            encodeURIComponent(this.resource["@id"]),
        ),
        fetch("/config/embeddable-editor-config.json", {
          cache: "no-store",
        }).then(async (response) => {
          if (!response.ok) throw new Error();
          return (await response.json()) as CeeConfig;
        }),
        this.loader.load(),
      ]);
      if (!this.alive || this.error()) return;
      const artifact = reply.data;
      let template = artifact;
      if (this.resource.resourceType === "instance") {
        const id = artifact["schema:isBasedOn"];
        if (typeof id !== "string" || !id) throw new Error();
        template = (
          await this.api.request<CeeJsonObject>(
            "/templates/" + encodeURIComponent(id),
          )
        ).data;
      } else if (this.resource.resourceType === "element")
        template = previewElement(artifact);
      if (!this.alive || this.error()) return;
      const field = this.resource.resourceType === "field";
      const tag = field ? "cedar-embeddable-field" : "cedar-embeddable-editor";
      if (!customElements.get(tag)) throw new Error();
      const viewer = document.createElement(tag) as
        CedarEmbeddableEditorElement | CedarEmbeddableFieldElement;
      viewer.eventHandler = {
        ready: () => {
          if (!this.alive || this.error()) return;
          clearTimeout(this.timer);
          this.loading.set(false);
        },
        error: this.fail,
      };
      // Apply read-only configuration before any artifact input, even if host config is editable.
      viewer.config = {
        ...config,
        readOnlyMode: true,
        previewMode: true,
        trustTemplateRichText: false,
        showDownloadMenu: false,
        showExpandCollapseAll: false,
        showTemplateDescription: true,
        defaultLanguage: this.i18n.language,
        fallbackLanguage,
      };
      this.mount.nativeElement.replaceChildren(viewer);
      if (field) {
        (viewer as CedarEmbeddableFieldElement).fieldObject = artifact;
      } else if (this.resource.resourceType === "instance") {
        (viewer as CedarEmbeddableEditorElement).templateAndInstanceObject = {
          templateObject: template,
          instanceObject: artifact,
        };
      } else (viewer as CedarEmbeddableEditorElement).templateObject = template;
    } catch {
      this.fail();
    }
  }
  close() {
    this.dispose();
    this.dialog.nativeElement.close();
    this.closed.emit();
    // A grid/list transition can replace the button that opened this dialog.
    const trigger = document.querySelector<HTMLButtonElement>(
      `button[data-preview-id="${CSS.escape(this.resource["@id"])}"]`,
    );
    if (trigger) trigger.focus();
    else if (this.originalFocus?.isConnected) this.originalFocus.focus();
  }
  private dispose() {
    this.alive = false;
    clearTimeout(this.timer);
    this.mount.nativeElement.replaceChildren();
  }
  ngOnDestroy() {
    this.dispose();
  }
}
