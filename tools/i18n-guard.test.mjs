// Fails when a user-visible string in a component template or a user-facing
// TypeScript sink bypasses the translation files. Deliberate exceptions live in
// i18n-allowlist.json beside this file, each with a reason; an entry that no
// longer matches a finding also fails, so the list cannot accumulate dead rows.
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const root = new URL("..", import.meta.url).pathname;
const sourceDir = join(root, "src");
const allowList = JSON.parse(
  await readFile(new URL("i18n-allowlist.json", import.meta.url), "utf8"),
);

// Attributes whose static value a user reads or hears. The first group is the
// shared rule; `help` and `text` are this repository's own component inputs
// (CopyButton's tooltip and FilterChip's visible text).
const textAttributes = [
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "title",
  "placeholder",
  "alt",
  "label",
  "matTooltip",
  "help",
  "text",
];

// TypeScript calls whose string arguments reach the screen in this repository.
// Errors are included because every caught error is shown through an error
// signal; the server's own messages arrive at run time and are not literals.
const sinkCalls = [
  { name: "confirm", pattern: /\bconfirm\s*\(/g },
  { name: "error.set", pattern: /\berror\.set\s*\(/g },
  { name: "notice.set", pattern: /\bnotice\.set\s*\(/g },
  { name: "failedChange.set", pattern: /\bfailedChange\.set\s*\(/g },
  { name: "ceeVersion.set", pattern: /\bceeVersion\.set\s*\(/g },
  { name: "closed.emit", pattern: /\bclosed\.emit\s*\(/g },
  { name: "new Error", pattern: /\bnew\s+Error\s*\(/g },
  { name: "new HttpError", pattern: /\bnew\s+HttpError\s*\(/g },
  { name: "textContent =", pattern: /\.textContent\s*=(?!=)/g },
  // Groups and Permissions pass the success or failure text of a write here.
  // Their callback arguments are request code and are skipped.
  { name: "write", pattern: /\bthis\.write\s*\(/g, skipCallbacks: true },
  { name: "save", pattern: /\bthis\.save\s*\(/g, skipCallbacks: true },
];
// Object properties whose value is displayed.
const sinkProperties = [
  "label",
  "title",
  "message",
  "placeholder",
  "ariaLabel",
  "summary",
  "tooltip",
  "description",
];

const letter = /\p{L}/u;
// A translation key, or the prefix of one completed at run time: dotted
// identifiers beginning with a capital, such as `ResourceActions.Open` or
// `ResourceTypes.`. A literal of this shape is a lookup, not text.
const keyShape = /^[A-Z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)*\.[A-Za-z0-9_]*$/;

async function sources(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!["assets", "fixtures", "testing"].includes(entry.name))
        found.push(...(await sources(path)));
    } else if (
      /\.(html|ts)$/.test(entry.name) &&
      !/\.spec\.ts$/.test(entry.name) &&
      entry.name !== "test-setup.ts"
    )
      found.push(path);
  }
  return found;
}

// Returns the index just past the quoted string or template literal starting at
// `start`, honouring escapes and nested `${ … }` expressions.
function skipString(text, start) {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") i += 2;
    else if (c === quote) return i + 1;
    else if (quote === "`" && c === "$" && text[i + 1] === "{") {
      i = skipBalanced(text, i + 1, "{", "}");
    } else i++;
  }
  return i;
}
function skipBalanced(text, start, open, close) {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(text, i);
      continue;
    }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return i + 1;
    i++;
  }
  return i;
}

// String literals in an expression, with template-literal substitutions removed.
function literals(expression) {
  const found = [];
  for (let i = 0; i < expression.length;) {
    const c = expression[i];
    if (c === '"' || c === "'" || c === "`") {
      const end = skipString(expression, i);
      let value = expression.slice(i + 1, end - 1);
      if (c === "`") value = value.replace(/\$\{[\s\S]*?\}/g, " ");
      const before = expression.slice(0, i).trimEnd();
      const after = expression.slice(end).trimStart();
      found.push({
        value,
        compared:
          /(===|!==|==|!=)$/.test(before) || /^(===|!==|==|!=)/.test(after),
        // Index keys, arguments of lookups such as `params.get('search')`, and
        // locale identifiers passed to `locale(…)`.
        indexed:
          /\[$/.test(before) ||
          /^\]/.test(after) ||
          /\.(includes|get|has|replace|startsWith|endsWith|locale)\($/.test(
            before,
          ),
      });
      i = end;
    } else i++;
  }
  return found;
}
// Literals in an expression that would be displayed as they stand. Comparison
// operands, index keys and translation keys are identifiers rather than text.
function displayedLiterals(expression) {
  return literals(expression)
    .filter((l) => letter.test(l.value))
    .filter((l) => !l.compared && !l.indexed)
    .filter((l) => !keyShape.test(l.value.trim()))
    .map((l) => l.value.trim());
}
function inArrayLiteralOnly(expression) {
  // Arrays of identifiers such as ['new-folder','rename'].includes(action).
  return /^\s*\[[^\]]*\]\s*\.includes\(/.test(expression);
}

function stripControlFlow(text) {
  let out = "";
  for (let i = 0; i < text.length;) {
    const block =
      /^@(else\s+if|if|for|switch|case|defer|placeholder|loading|error|else|empty|default)\b/.exec(
        text.slice(i),
      );
    if (!block) {
      out += text[i++];
      continue;
    }
    i += block[0].length;
    while (/\s/.test(text[i] || "")) i++;
    if (text[i] === "(") i = skipBalanced(text, i, "(", ")");
    out += " ";
  }
  return out;
}

function scanTemplate(template, report) {
  let i = 0;
  const text = (chunk) => {
    let rest = chunk;
    // Interpolations: the text around them is checked here, their literals below.
    rest = rest.replace(/\{\{([\s\S]*?)\}\}/g, (_m, expression) => {
      for (const value of displayedLiterals(expression))
        report("interpolation", value);
      return " ";
    });
    // Angular control flow: `@if (…) {`, `} @else {`, `@for (…; track …) {`.
    rest = stripControlFlow(rest);
    rest = rest.replace(/[{}]/g, " ");
    rest = rest.replace(/&[a-zA-Z]+;|&#\d+;|&#x[0-9a-fA-F]+;/g, " ");
    const trimmed = rest.replace(/\s+/g, " ").trim();
    if (letter.test(trimmed)) report("text", trimmed);
  };
  while (i < template.length) {
    if (template.startsWith("<!--", i)) {
      const end = template.indexOf("-->", i);
      i = end < 0 ? template.length : end + 3;
      continue;
    }
    if (template[i] === "<" && /[a-zA-Z/!]/.test(template[i + 1] || "")) {
      // A tag: read attributes until the closing `>`, respecting quotes.
      let j = i + 1;
      const name = /^[\/!]?[\w:-]*/.exec(template.slice(j))[0];
      j += name.length;
      while (j < template.length && template[j] !== ">") {
        const match = /^\s*([^\s=/>]+)(\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/.exec(
          template.slice(j),
        );
        if (!match || !match[0]) {
          j++;
          continue;
        }
        j += match[0].length;
        const attribute = match[1];
        let value = match[3] || "";
        if (/^["']/.test(value)) value = value.slice(1, -1);
        const bare = attribute.replace(/^\[|\]$/g, "").replace(/^attr\./, "");
        if (!textAttributes.includes(bare)) continue;
        if (attribute.startsWith("[")) {
          if (!inArrayLiteralOnly(value))
            for (const literal of displayedLiterals(value))
              report(`[${bare}]`, literal);
        } else {
          let staticText = value.replace(/\{\{([\s\S]*?)\}\}/g, (_m, e) => {
            for (const literal of displayedLiterals(e))
              report(`${bare} interpolation`, literal);
            return " ";
          });
          staticText = staticText.replace(/&[a-zA-Z]+;/g, " ").trim();
          if (letter.test(staticText)) report(bare, staticText);
        }
      }
      i = j + 1;
      continue;
    }
    // Text runs until the next tag, skipping `<` inside interpolations.
    let j = i;
    while (j < template.length) {
      if (template.startsWith("{{", j)) {
        const end = template.indexOf("}}", j);
        j = end < 0 ? template.length : end + 2;
      } else if (
        template[j] === "<" &&
        /[a-zA-Z/!]/.test(template[j + 1] || "")
      )
        break;
      else j++;
    }
    text(template.slice(i, j));
    i = j;
  }
}

// Blanks comments and returns the text with inline templates removed, plus the
// inline templates themselves.
function splitTypeScript(source) {
  let code = "";
  const templates = [];
  for (let i = 0; i < source.length;) {
    const c = source[i];
    if (c === "/" && source[i + 1] === "/") {
      const end = source.indexOf("\n", i);
      i = end < 0 ? source.length : end;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? source.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const end = skipString(source, i);
      if (c === "`" && /\btemplate\s*:\s*$/.test(code)) {
        templates.push(source.slice(i + 1, end - 1));
        code += "``";
      } else code += source.slice(i, end);
      i = end;
      continue;
    }
    code += c;
    i++;
  }
  return { code, templates };
}

function topLevelArguments(expression) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < expression.length;) {
    const c = expression[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(expression, i);
      continue;
    }
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) {
      parts.push(expression.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  parts.push(expression.slice(start));
  return parts;
}

function scanTypeScript(code, report) {
  for (const sink of sinkCalls) {
    for (const match of code.matchAll(sink.pattern)) {
      const start = match.index + match[0].length;
      let expression;
      if (sink.name === "textContent =") {
        const end = code.indexOf(";", start);
        expression = code.slice(start, end < 0 ? undefined : end);
      } else {
        const end = skipBalanced(code, start - 1, "(", ")");
        expression = code.slice(start, end - 1);
        if (sink.skipCallbacks)
          expression = topLevelArguments(expression)
            .filter((argument) => !argument.includes("=>"))
            .join(",");
      }
      for (const value of displayedLiterals(expression))
        report(sink.name, value);
    }
  }
  const property = new RegExp(
    `(?:^|[\\s{,])(${sinkProperties.join("|")})\\s*:(?!:)`,
    "g",
  );
  for (const match of code.matchAll(property)) {
    // The value runs to the next comma or closing brace at nesting depth zero.
    let i = match.index + match[0].length;
    let depth = 0;
    const start = i;
    while (i < code.length) {
      const c = code[i];
      if (c === '"' || c === "'" || c === "`") {
        i = skipString(code, i);
        continue;
      }
      if ("([{".includes(c)) depth++;
      else if (")]}".includes(c)) {
        if (depth === 0) break;
        depth--;
      } else if ((c === "," || c === ";") && depth === 0) break;
      i++;
    }
    const expression = code.slice(start, i);
    // Type annotations (`label: string`) contain no literals and pass.
    for (const value of displayedLiterals(expression))
      report(`${match[1]}:`, value);
  }
}

async function findings() {
  const found = [];
  for (const path of await sources(sourceDir)) {
    const file = relative(root, path);
    const source = await readFile(path, "utf8");
    const report = (where, text) => found.push({ file, where, text });
    if (path.endsWith(".html")) scanTemplate(source, report);
    else {
      const { code, templates } = splitTypeScript(source);
      for (const template of templates) scanTemplate(template, report);
      scanTypeScript(code, report);
    }
  }
  return found;
}

const matches = (entry, finding) =>
  entry.file === finding.file && entry.text === finding.text;

test("every user-visible string is stated through the translation files", async () => {
  const found = await findings();
  const unlisted = found.filter((f) => !allowList.some((e) => matches(e, f)));
  assert.deepEqual(
    unlisted.map((f) => `${f.file} (${f.where}): ${f.text}`),
    [],
    "move these strings to src/assets/i18n/*.json, or list a deliberate exception in tools/i18n-allowlist.json",
  );
});

test("every allow-list entry has a reason and still matches a finding", async () => {
  const found = await findings();
  for (const entry of allowList)
    assert.ok(
      entry.reason && entry.reason.trim(),
      `allow-list entry for "${entry.text}" in ${entry.file} needs a reason`,
    );
  const stale = allowList.filter((e) => !found.some((f) => matches(e, f)));
  assert.deepEqual(
    stale.map((e) => `${e.file}: ${e.text}`),
    [],
    "remove allow-list entries that no longer match anything",
  );
});

export { findings };
