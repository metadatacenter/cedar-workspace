import { Component, input } from "@angular/core";
import { TranslatePipe } from "@ngx-translate/core";
import { Icon } from "./icon";
import { Resource, title } from "./resource";

/** Pointer-only feedback; the original cards retain selection and semantics. */
@Component({
  selector: "cedar-drag-preview",
  imports: [Icon, TranslatePipe],
  template: `
    <div class="stack" [class.multiple]="resources().length > 1" aria-hidden="true">
      <div class="card">
        @for (resource of resources().slice(0, 3); track resource['@id']) {
          <div class="item"><cedar-icon [name]="resource.resourceType" size="small" />
            <span>{{ title(resource, 'Common.Untitled' | translate) }}</span>
          </div>
        }
        @if(resources().length > 1) {
          <span class="count">{{'Explorer.Selected' | translate:{count:resources().length} }}</span>
        }
        <div class="destination" [class.ready]="destination()">
          <cedar-icon name="folder" size="small" />
          <span>{{destination() ? ('Explorer.MoveTo' | translate:{name:destination()}) : ('Explorer.DragToFolder' | translate)}}</span>
        </div>
      </div>
    </div>
  `,
  styleUrl: "./drag-preview.scss",
})
export class DragPreview {
  readonly resources = input.required<Resource[]>();
  readonly destination = input("");
  readonly title = title;
}
