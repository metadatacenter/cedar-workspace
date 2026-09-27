import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import { I18n, detectLanguage, provideWorkspaceTranslations } from "./i18n";

describe("Workspace language detection", () => {
  it.each([
    [["hu-HU", "en-US"], "hu"],
    [["hu"], "hu"],
    [["en-GB", "hu-HU"], "en"],
    [["de-DE", "hu-HU", "en"], "hu"],
    [["de-DE", "en-US", "hu"], "en"],
    [["HU_hu"], "hu"],
    [["de-DE", "fr"], "en"],
    [[], "en"],
    [undefined, "en"],
  ] as const)("chooses a language for %j: %s", (preferences, expected) => {
    expect(detectLanguage(preferences)).toBe(expected);
  });
});

describe("Workspace translations", () => {
  it("renders English text and English locales by default", () => {
    const i18n = TestBed.inject(I18n);
    expect(i18n.language).toBe("en");
    expect(i18n.t("Filters.Presets.Year", { year: 2026 })).toBe(
      "This year (2026)",
    );
    expect(i18n.locale("en-GB")).toBe("en-GB");
    expect(i18n.locale(undefined)).toBeUndefined();
  });
  it("renders Hungarian text and the Hungarian locale", () => {
    TestBed.configureTestingModule({
      providers: [provideWorkspaceTranslations("hu")],
    });
    const i18n = TestBed.inject(I18n);
    expect(i18n.language).toBe("hu");
    expect(i18n.t("Common.Cancel")).toBe("Mégse");
    expect(i18n.locale("en-US")).toBe("hu-HU");
    expect(i18n.locale(undefined)).toBe("hu-HU");
  });
  it("shows a server value it cannot translate as it arrived", () => {
    const i18n = TestBed.inject(I18n);
    expect(i18n.known("Roles.viewer", "viewer")).toBe("viewer");
    expect(i18n.known("Roles.auditor", "auditor")).toBe("auditor");
  });
});
