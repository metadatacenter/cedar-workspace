import { TestBed } from "@angular/core/testing";
import { beforeEach } from "vitest";
import { provideWorkspaceTranslations } from "./app/i18n";

// Unit tests render English, the fallback language, whatever the host browser
// prefers. A test that needs Hungarian configures its own providers, which
// take precedence over these.
beforeEach(() => {
  TestBed.configureTestingModule({
    providers: provideWorkspaceTranslations("en"),
  });
});
