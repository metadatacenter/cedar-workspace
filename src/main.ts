import { Component } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { provideRouter, RouterOutlet } from "@angular/router";
import { Privacy } from "./app/privacy";
import { Groups } from "./app/groups";
import { Settings } from "./app/settings";
import { Profile } from "./app/profile";
import { Workspace } from "./app/workspace";
import {
  MetadataEditor,
  metadataRoute,
  leaveMetadata,
} from "./app/metadata-editor";
@Component({
  selector: "cedar-workspace",
  imports: [RouterOutlet],
  template: "<router-outlet />",
})
class App {}
bootstrapApplication(App, {
  providers: [
    provideRouter([
      { path: "", pathMatch: "full", redirectTo: "dashboard" },
      { path: "dashboard", component: Workspace },
      { path: "messaging", redirectTo: "dashboard", pathMatch: "full" },
      { path: "profile", component: Profile },
      { path: "settings", component: Settings },
      { path: "groups", component: Groups },
      { path: "privacy", component: Privacy },
      {
        matcher: metadataRoute,
        component: MetadataEditor,
        canDeactivate: [leaveMetadata],
      },
    ]),
  ],
}).catch((error) => {
  console.error(error);
  document.body.textContent = "Unable to start CEDAR Workspace.";
});
