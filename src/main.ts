import { ConfirmationOutlet } from "./app/confirmation";
import { Component } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { provideRouter, RouterOutlet, TitleStrategy } from "@angular/router";
import { Workspace } from "./app/workspace";
import {
  detectLanguage,
  provideWorkspaceTranslations,
  translations,
} from "./app/i18n";
import { metadataRoute, leaveMetadata } from "./app/metadata-route";
import { PageTitles } from "./app/page-title";
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
    // Each title is a translation key; the dashboard names itself after what it lists.
    { provide: TitleStrategy, useExisting: PageTitles },
    provideRouter([
      { path: "", pathMatch: "full", redirectTo: "dashboard" },
      { path: "dashboard", component: Workspace },
      { path: "messaging", redirectTo: "dashboard", pathMatch: "full" },
      {
        path: "profile",
        loadComponent: () =>
          import("./app/profile").then((module) => module.Profile),
        title: "Account.Profile.Title",
      },
      {
        path: "settings",
        loadComponent: () =>
          import("./app/settings").then((module) => module.Settings),
        title: "Account.Settings.Title",
      },
      {
        path: "groups",
        loadComponent: () =>
          import("./app/groups").then((module) => module.Groups),
        title: "Groups.Title",
      },
      {
        path: "privacy",
        loadComponent: () =>
          import("./app/privacy").then((module) => module.Privacy),
        title: "Account.Privacy.Title",
      },
      {
        path: "logout",
        loadComponent: () =>
          import("./app/logout").then((module) => module.Logout),
        title: "Logout.Title",
      },
      {
        matcher: metadataRoute,
        title: "Metadata.Title",
        loadComponent: () =>
          import("./app/metadata-editor").then(
            (module) => module.MetadataEditor,
          ),
        canDeactivate: [leaveMetadata],
      },
      { path: "**", redirectTo: "dashboard" },
    ]),
  ],
}).catch((error) => {
  console.error(error);
  // Translation may be what failed, so the message is read from the map directly.
  document.body.textContent = translations[language].Errors.StartupFailed;
});
