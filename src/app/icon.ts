import { Component, Input } from "@angular/core";
@Component({
  selector: "cedar-icon",
  template: `<svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path [attr.d]="paths[name] || paths['field']" />
  </svg>`,
  styles: [
    `
      :host {
        display: inline-flex;
        vertical-align: middle;
        align-items: center;
      }
    `,
  ],
})
export class Icon {
  @Input() name = "field";
  readonly paths: Record<string, string> = {
    folder: "M3 6h7l2 2h9v12H3z M3 6V4h7l2 2h9v2",
    template: "M5 2h9l5 5v15H5z M14 2v6h5 M8 12h8 M8 16h8",
    element: "M12 2l9 5v10l-9 5-9-5V7z M3 7l9 5 9-5 M12 12v10",
    field: "M4 5h16v14H4z M7 10h10 M7 14h5",
    instance: "M3 3h8l10 10-8 8L3 11z M7 7h.01",
    search: "M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15 M16 16l5 5",
    user: "M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M5 21v-3a7 7 0 0 1 14 0v3z",
    more: "M12 4h.01 M12 12h.01 M12 20h.01",
    info: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M12 11v6 M12 7h.01",
    external: "M14 3h7v7 M21 3l-12 12 M10 3H3v18h18v-7",
    left: "M15 5l-7 7 7 7",
    right: "M9 5l7 7-7 7",
    edit: "M15 5l4 4 M4 20l5-1L21 7l-4-4L5 15z",
    refresh: "M20 7a9 9 0 1 0 1 8 M20 2v6h-6",
  };
}
