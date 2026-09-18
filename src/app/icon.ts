import { Component, Input, inject } from "@angular/core";
import { DomSanitizer, SafeHtml } from "@angular/platform-browser";
import {
  getIcon,
  iconStyle,
} from "@org.metadatacenter/cedar-design-tokens/icons";

@Component({
  selector: "cedar-icon",
  standalone: true,
  template: `<svg
    [attr.viewBox]="style.viewBox"
    [attr.width]="style.default"
    [attr.height]="style.default"
    fill="none"
    stroke="currentColor"
    [attr.stroke-width]="style.strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
    [attr.data-cedar-icon]="definition.name"
    [innerHTML]="body"
  ></svg>`,
  styles: [
    ":host { display: inline-flex; align-items: center; justify-content: center; vertical-align: middle; } svg { display: block; }",
  ],
})
export class Icon {
  @Input() name = "artifact-field";

  readonly style = iconStyle;
  private readonly sanitizer = inject(DomSanitizer);
  get definition() {
    return getIcon(this.name);
  }
  get body(): SafeHtml {
    // Only geometry from the shared, build-validated registry is trusted.
    return this.sanitizer.bypassSecurityTrustHtml(this.definition.body);
  }
}
