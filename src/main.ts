import { Component } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { provideRouter, RouterOutlet } from "@angular/router";
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
      { path: "profile", component: Profile },
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
