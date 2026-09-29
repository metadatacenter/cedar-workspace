import { Component, inject, input, output } from "@angular/core";
import { TranslatePipe } from "@ngx-translate/core";
import { FriendlyDatePipe } from "./friendly-date";
import { I18n } from "./i18n";
import { Icon } from "./icon";
import { Resource, title } from "./resource";
import { Tooltip } from "./tooltip";

export type FolderSort =
  "name" | "-name" | "lastUpdatedOnTS" | "-lastUpdatedOnTS";

/** A reusable folder-only listing. Its host owns navigation, paging and permissions. */
@Component({
  selector: "cedar-folder-list",
  imports: [TranslatePipe, FriendlyDatePipe, Icon, Tooltip],
  templateUrl: "./folder-list.html",
  styleUrl: "./folder-list.scss",
})
export class FolderList {
  private readonly i18n = inject(I18n);
  readonly folders = input.required<readonly Resource[]>();
  readonly label = input.required<string>();
  readonly sort = input<FolderSort>("name");
  readonly busy = input(false);
  readonly disabledId = input<string>();
  readonly openFolder = output<string>();
  readonly sortChange = output<FolderSort>();
  readonly now = Date.now();
  readonly title = (folder: Resource) =>
    title(folder, this.i18n.t("Common.Untitled"));

  open(folder: Resource) {
    if (!this.busy() && folder["@id"] !== this.disabledId())
      this.openFolder.emit(folder["@id"]);
  }
  changeSort(column: "name" | "lastUpdatedOnTS") {
    if (!this.busy())
      this.sortChange.emit(this.sort() === column ? `-${column}` : column);
  }
  direction(column: "name" | "lastUpdatedOnTS") {
    return this.sort() === column
      ? "ascending"
      : this.sort() === `-${column}`
        ? "descending"
        : "none";
  }
}
