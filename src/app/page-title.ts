import { Injectable, inject } from "@angular/core";
import { Title } from "@angular/platform-browser";
import { RouterStateSnapshot, TitleStrategy } from "@angular/router";
import { I18n } from "./i18n";

/**
 * Titles each page by its own name and then the product's, as "Profile – CEDAR Workspace".
 *
 * A route's title is a translation key. A page whose name depends on what it shows, as the
 * dashboard's depends on the folder or search it lists, names itself instead. Until it does,
 * and on a route with no title, the title is the product's name alone.
 */
@Injectable({ providedIn: "root" })
export class PageTitles extends TitleStrategy {
  private readonly document = inject(Title);
  private readonly i18n = inject(I18n);
  private route?: string;
  private page: string | null = null;
  override updateTitle(snapshot: RouterStateSnapshot) {
    this.route = this.buildTitle(snapshot);
    this.show();
  }
  /**
   * Name the current page by what it shows. The page that names itself clears its name with
   * `null` when it closes, which returns the title to the route's.
   */
  name(page: string | null) {
    this.page = page;
    this.show();
  }
  private show() {
    const page = this.page ?? (this.route ? this.i18n.t(this.route) : "");
    const product = this.i18n.t("Header.Brand");
    this.document.setTitle(page ? page + " – " + product : product);
  }
}
