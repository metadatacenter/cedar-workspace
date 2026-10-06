// Fails when a text box in a component template lacks autocomplete="off".
// Without it, a browser lists beneath the box what was once typed into any box
// with the same name or id, on this site or another. Those entries cover the
// workspace's own menus, and none of them is the value the box asks for.
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const root = new URL("..", import.meta.url).pathname;
const sourceDir = join(root, "src");

// A browser never offers typed history for these input types.
const noHistory = new Set([
  "checkbox",
  "radio",
  "range",
  "color",
  "file",
  "hidden",
  "button",
  "submit",
  "reset",
  "image",
]);

async function* templates(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* templates(path);
    else if (
      path.endsWith(".html") ||
      (path.endsWith(".ts") && !path.endsWith(".spec.ts"))
    )
      yield path;
  }
}

// Each <input> and <textarea> opening tag in `text`, with the line it starts on.
function* textEntryTags(text) {
  for (const match of text.matchAll(/<(input|textarea)(?=[\s/>])/g)) {
    let quote = null;
    let end = match.index + match[0].length;
    for (; end < text.length; end++) {
      const character = text[end];
      if (quote) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") quote = character;
      else if (character === ">") break;
    }
    const tag = text.slice(match.index, end + 1);
    const type = /\stype="([^"]*)"/.exec(tag)?.[1];
    if (match[1] === "input" && noHistory.has(type)) continue;
    yield { tag, line: text.slice(0, match.index).split("\n").length };
  }
}

test('every text box carries autocomplete="off"', async () => {
  const missing = [];
  let scanned = 0;
  for await (const file of templates(sourceDir)) {
    scanned++;
    for (const { tag, line } of textEntryTags(await readFile(file, "utf8"))) {
      if (!/\sautocomplete="off"/.test(tag))
        missing.push(`${relative(sourceDir, file)}:${line}`);
    }
  }
  assert.ok(scanned > 0);
  assert.deepEqual(missing, []);
});
