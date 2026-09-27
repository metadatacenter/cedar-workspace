import { ConfirmationOutlet } from "./app/confirmation";
import { Component } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { TranslateService } from "@ngx-translate/core";
import { provideRouter, RouterOutlet } from "@angular/router";
import { Logout } from "./app/logout";
import { Privacy } from "./app/privacy";
import { Groups } from "./app/groups";
import { Settings } from "./app/settings";
import { Profile } from "./app/profile";
import { Workspace } from "./app/workspace";
import {
  detectLanguage,
  provideWorkspaceTranslations,
  translations,
} from "./app/i18n";
import {
  MetadataEditor,
  metadataRoute,
  leaveMetadata,
} from "./app/metadata-editor";
@Component({
  selector: "cedar-workspace",
  imports: [RouterOutlet, ConfirmationOutlet],
  template: "<router-outlet /><cedar-confirmation />",
})
class App {}
const language = detectLanguage();
document.documentElement.lang = language;
bootstrapApplication(App, {
  providers: [
    provideWorkspaceTranslations(language),
    provideRouter([
      { path: "", pathMatch: "full", redirectTo: "dashboard" },
      { path: "dashboard", component: Workspace },
      { path: "messaging", redirectTo: "dashboard", pathMatch: "full" },
      { path: "profile", component: Profile },
      { path: "settings", component: Settings },
      { path: "groups", component: Groups },
      { path: "privacy", component: Privacy },
      { path: "logout", component: Logout },
      {
        matcher: metadataRoute,
        component: MetadataEditor,
        canDeactivate: [leaveMetadata],
      },
      { path: "**", redirectTo: "dashboard" },
    ]),
  ],
})
  .then((application) => {
    document.title = application.injector
      .get(TranslateService)
      .instant("Header.Brand");
  })
  .catch((error) => {
    console.error(error);
    // Translation may be what failed, so the message is read from the map directly.
    document.body.textContent = translations[language].Errors.StartupFailed;
  });
