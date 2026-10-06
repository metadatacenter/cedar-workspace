// Every Workspace message that carries a count, at zero, one and two, in English and Hungarian.
//
// A message with a number before a noun needs a singular in English: "1 required fields are
// missing" was what one meant. Workspace keeps that singular under the message's key with `One`
// appended and chooses between the two in one place, `I18n.counted`. Hungarian keeps a noun
// singular after any number, so its two texts read alike. This fails when a counted message has
// no singular, when its singular still reads as a plural, or when a site picks the form itself
// rather than asking `counted`.
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const root = new URL("..", import.meta.url).pathname;
const catalogue = async (language) =>
  JSON.parse(await readFile(join(root, "src/assets/i18n", `${language}.json`), "utf8"));
const languages = { en: await catalogue("en"), hu: await catalogue("hu") };

function flatten(node, prefix = "", into = {}) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") flatten(value, path, into);
    else into[path] = value;
  }
  return into;
}
const texts = { en: flatten(languages.en), hu: flatten(languages.hu) };

// The parameters these messages count with, as opposed to names and lists they also carry.
const COUNTS = ["count", "instances", "total"];
const NOT_PLURAL = new Set(["is", "was", "has", "its", "this", "as"]);

/** The words that follow a counting placeholder, up to the end of its phrase. */
function wordsAfterCounts(text) {
  const found = [];
  for (const match of text.matchAll(/\{\{\s*(\w+)\s*\}\}([^.,:;()—–]*)/g)) {
    if (!COUNTS.includes(match[1])) continue;
    found.push(...match[2].trim().split(/\s+/).filter(Boolean).slice(0, 4));
  }
  return found;
}
const readsPlural = (text) =>
  wordsAfterCounts(text).some((word) => /s$/i.test(word) && !NOT_PLURAL.has(word.toLowerCase()));

const counted = Object.keys(texts.en).filter((key) => texts.en[key + "One"] !== undefined);

test("every English message that counts a plural noun has a singular, in both languages", () => {
  const missing = Object.entries(texts.en)
    .filter(([key, text]) => !key.endsWith("One") && readsPlural(text))
    .filter(([key]) => texts.en[key + "One"] === undefined || texts.hu[key + "One"] === undefined)
    .map(([key, text]) => `${key}: ${text}`);
  assert.deepEqual(missing, []);
});

for (const key of counted)
  for (const language of ["en", "hu"])
    for (const count of [0, 1, 2])
      test(`${key} with ${count}, in ${language}`, () => {
        const chosen = count === 1 ? key + "One" : key;
        const text = texts[language][chosen];
        assert.equal(typeof text, "string", `${language} has no text for ${chosen}`);
        // A singular may leave the number out ("this one item"), but it takes nothing the plural does not.
        const placeholders = (value) => new Set([...value.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]));
        const extra = [...placeholders(text)].filter((name) => !placeholders(texts.en[key]).has(name));
        assert.deepEqual(extra, [], "the form takes a parameter the plural does not");
        if (language === "en" && count === 1) {
          assert.ok(!readsPlural(text), `the singular still reads as a plural: ${text}`);
          assert.notEqual(text, texts.en[key], "the singular reads exactly as the plural");
        }
      });

// A site that chooses the form itself must name the singular's key, and a site that translates a
// counted message directly shows its plural for one. Either is a site not asking `counted`.
test("every site asks counted for the form rather than choosing it", async () => {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.(ts|html)$/.test(entry.name) && !entry.name.endsWith(".spec.ts")) files.push(path);
    }
  }
  await walk(join(root, "src/app"));
  const offenders = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const key of counted) {
      if (source.includes(`'${key}One'`) || source.includes(`"${key}One"`))
        offenders.push(`${file}: names ${key}One`);
      const literal = `['"]${key.replace(/\./g, "\\.")}['"]`;
      if (new RegExp(`\\bt\\(\\s*${literal}|${literal}\\s*\\|\\s*translate`).test(source))
        offenders.push(`${file}: translates ${key} without counted`);
    }
  }
  assert.deepEqual(offenders, []);
});
