/**
 * The translation files, as data.
 *
 * Workspace ships an English and a Hungarian map, and a string one map lacks
 * shows as a raw key or silently falls back to English. These assertions are
 * structural rather than linguistic. A test cannot judge whether a translation
 * is good, but it can establish that one exists, that it is not the English
 * verbatim, and that no key name was translated along with its value.
 */
import { describe, expect, it } from "vitest";
import en from "../assets/i18n/en.json";
import hu from "../assets/i18n/hu.json";

type Flat = Record<string, string>;

const flatten = (node: object, prefix = ""): Flat => {
  const out: Flat = {};
  for (const [key, value] of Object.entries(node)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value))
      Object.assign(out, flatten(value, `${prefix}${key}.`));
    else out[`${prefix}${key}`] = String(value);
  }
  return out;
};

const maps = { en: flatten(en), hu: flatten(hu) };
const reference = maps.en;

/**
 * Hungarian values that are legitimately identical to the English: product
 * names, acronyms, identifiers and the universal "OK". Every other identical
 * value is an untranslated string.
 */
const identical = new Set([
  "Common.OK",
  "Dashboard.Doi",
  "Account.Profile.Uuid",
  "Account.Profile.Id",
]);

describe("the translation files", () => {
  it("are both non-empty", () => {
    expect(Object.keys(maps.en).length).toBeGreaterThan(0);
    expect(Object.keys(maps.hu).length).toBeGreaterThan(0);
  });

  it("declare exactly the same keys", () => {
    const missing = Object.keys(reference).filter((k) => !(k in maps.hu));
    const extra = Object.keys(maps.hu).filter((k) => !(k in reference));
    // Named rather than counted, so a failure says which string is affected.
    expect(missing, "hu.json is missing keys").toEqual([]);
    expect(extra, "hu.json has keys en.json does not").toEqual([]);
  });

  it.each(["en", "hu"] as const)("%s uses ASCII key names", (language) => {
    const nonAscii = Object.keys(maps[language]).filter(
      (k) => !/^[\x20-\x7e]+$/.test(k),
    );
    expect(nonAscii, "keys are identifiers and must not be translated").toEqual(
      [],
    );
  });

  it.each(["en", "hu"] as const)("%s has no blank values", (language) => {
    const blank = Object.entries(maps[language])
      .filter(([, v]) => v.trim() === "")
      .map(([k]) => k);
    expect(blank).toEqual([]);
  });

  it("translates every Hungarian value not listed as identical", () => {
    const untranslated = Object.entries(maps.hu)
      .filter(([k, v]) => v === reference[k] && !identical.has(k))
      .map(([k]) => k);
    expect(untranslated, "these values are the English verbatim").toEqual([]);
  });

  it("lists as identical only values that are identical", () => {
    const stale = [...identical].filter((k) => maps.hu[k] !== reference[k]);
    expect(stale, "remove these keys from the identical list").toEqual([]);
  });

  it("uses the same parameters in both languages", () => {
    const parameters = (value: string) =>
      [...value.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();
    const mismatched = Object.keys(reference).filter(
      (k) =>
        JSON.stringify(parameters(reference[k])) !==
        JSON.stringify(parameters(maps.hu[k] ?? "")),
    );
    expect(mismatched).toEqual([]);
  });
});
