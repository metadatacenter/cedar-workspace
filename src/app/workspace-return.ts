import { Component, EventEmitter, Input, Output } from "@angular/core";
import { TranslatePipe } from "@ngx-translate/core";
import { Icon } from "./icon";

/** A shared visual control; editors retain their guarded navigation behavior. */
@Component({
  selector: "cedar-workspace-return",
  imports: [Icon, TranslatePipe],
  template: `
    @if (guarded) {
      <button type="button" [disabled]="disabled" (click)="activate.emit()"
        [attr.aria-label]="'Common.BackToWorkspace' | translate">
        <cedar-icon name="back" /><span>{{ 'Common.Workspace' | translate }}</span>
      </button>
    } @else {
      <a href="/dashboard" [attr.aria-label]="'Common.BackToWorkspace' | translate">
        <cedar-icon name="back" /><span>{{ 'Common.Workspace' | translate }}</span>
      </a>
    }
  `,
  styleUrl: "./workspace-return.scss",
})
export class WorkspaceReturn {
  @Input() guarded = false;
  @Input() disabled = false;
  @Output() activate = new EventEmitter<void>();
}
