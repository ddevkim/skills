// Keeps the orca-hub instructions portable: every path they name exists, nothing
// in them holds only on the author's machine, and the language rules stay in place.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const skillDir = path.join(root, "skills", "orca-hub");
const refDir = path.join(skillDir, "references");
const HANGUL = /[가-힣]/;
const EXAMPLE_NOTE = "Korean strings in this file are examples";

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function docs() {
  const refs = fs.readdirSync(refDir).filter((n) => n.endsWith(".md")).map((n) => path.join(refDir, n));
  return [path.join(skillDir, "SKILL.md"), ...refs];
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}

function frontmatter() {
  const m = read(path.join(skillDir, "SKILL.md")).match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, "SKILL.md has no frontmatter");
  const fields = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-z-]+): (.+)$/);
    assert.ok(kv, `frontmatter line does not parse: ${line}`);
    fields[kv[1]] = kv[2];
  }
  return fields;
}

test("every path the instructions name exists", () => {
  const missing = [];
  for (const file of docs()) {
    const text = read(file);
    for (const [, target] of text.matchAll(/\]\(([^)\s#]+)(#[^)]*)?\)/g)) {
      if (/^[a-z]+:/.test(target)) continue;
      if (!fs.existsSync(path.resolve(path.dirname(file), target))) missing.push(`${path.relative(root, file)}: ${target}`);
    }
    for (const [, target] of text.matchAll(/(?<![\w/<.-])((?:references|templates|scripts)\/[\w.-]+\.[a-z]+)/g)) {
      if (!fs.existsSync(path.join(skillDir, target))) missing.push(`${path.relative(root, file)}: ${target}`);
    }
  }
  assert.deepStrictEqual(missing, []);
});

test("nothing under skills/ holds only on the author's machine", () => {
  const found = [];
  for (const file of walk(path.join(root, "skills"))) {
    const rel = path.relative(root, file);
    read(file).split("\n").forEach((line, i) => {
      for (const [p] of line.matchAll(/\/(?:Users|home)\/[^\s"'`)]+/g)) {
        if (rel === "skills/orca-hub/templates/state.js" && p.startsWith("/Users/me/")) continue;
        found.push(`${rel}:${i + 1}: ${p}`);
      }
      for (const [p] of line.matchAll(/(?:~|\$HOME|\$\{HOME\})\/[^\s"'`)]*/g)) {
        if (rel === "skills/orca-hub/SKILL.md" && p === "~/orca/workspaces/<repo>") continue; // Orca's documented default
        found.push(`${rel}:${i + 1}: ${p}`);
      }
      for (const [w] of line.matchAll(/noslop|ddevkim|jaemin/gi)) found.push(`${rel}:${i + 1}: ${w}`);
    });
  }
  assert.deepStrictEqual(found, []);
});

test("SKILL.md has the language section and it names lang", () => {
  const text = read(path.join(skillDir, "SKILL.md"));
  const section = text.match(/\n## Language\n([\s\S]*?)(?=\n## |$)/);
  assert.ok(section, "SKILL.md has no '## Language' section");
  assert.match(section[1], /`lang`/);
  assert.match(section[1], /"ko"/);
  assert.match(section[1], /"en"/);
});

test("each reference with Korean text says its Korean strings are examples", () => {
  const lacking = docs()
    .filter((f) => HANGUL.test(read(f)) && !read(f).includes(EXAMPLE_NOTE))
    .map((f) => path.relative(root, f));
  assert.deepStrictEqual(lacking, []);
});

test("the frontmatter parses, keeps the skill direct-invocation only, and is language-neutral", () => {
  const f = frontmatter();
  assert.strictEqual(f.name, "orca-hub");
  assert.ok(f.description && f.description.trim(), "description is empty");
  assert.strictEqual(f["disable-model-invocation"], "true");
  assert.doesNotMatch(f.description, HANGUL, "description relies on Korean trigger words");
});

test("the protocol slots the language section names exist in worker-spec.md", () => {
  const section = read(path.join(skillDir, "SKILL.md")).match(/\n## Language\n([\s\S]*?)(?=\n## )/)[1];
  const spec = read(path.join(refDir, "worker-spec.md"));
  const slots = [...section.matchAll(/`(<[^`>]*language[^`>]*>)`/g)].map((m) => m[1]);
  assert.ok(slots.length > 0, "the language section names no protocol slot");
  assert.deepStrictEqual(slots.filter((s) => !spec.includes(s)), []);
});

test("dashboard.md's Korean stage words are the page's ko phase labels", () => {
  const html = read(path.join(skillDir, "templates", "dashboard.html"));
  const ko = JSON.parse(html.match(/ko: \{[\s\S]*?phases: (\[[^\]]*\])/)[1]);
  assert.ok(read(path.join(refDir, "dashboard.md")).includes(`stages**: ${ko.join(", ")} (English`));
});

const STOP_LIST = ["drops a column or table", "spending money", "secrets or permission scopes",
  "unconditional force push", "`--admin`", "three rounds"];

test("SKILL.md has the autonomy section with its three levels and the six stops", () => {
  const section = read(path.join(skillDir, "SKILL.md")).match(/\n## Autonomy levels\n([\s\S]*?)(?=\n## )/);
  assert.ok(section, "SKILL.md has no '## Autonomy levels' section");
  for (const level of ["`low`", "`medium`", "`high`"]) assert.ok(section[1].includes(level), `no ${level}`);
  assert.deepStrictEqual(STOP_LIST.filter((s) => !section[1].includes(s)), [], "stop list entries missing");
});

test("the worker protocol has the autonomy level slot", () => {
  const protocol = read(path.join(refDir, "worker-spec.md")).match(/## Hub protocol[\s\S]*?\n```/)[0];
  assert.match(protocol, /AUTONOMY: <low \| medium \| high>/);
});

test("cleanup removes and checks the allow list", () => {
  const text = read(path.join(refDir, "cleanup.md"));
  assert.match(text, /allow\.cjs remove/);
  assert.match(text, /allow\.cjs check/);
});

test("the docs name the English labels of both pages", () => {
  const html = read(path.join(skillDir, "templates", "walkthrough.html"));
  const en = JSON.parse(html.match(/en: \{[\s\S]*?steps: (\[[^\]]*\])/)[1]);
  assert.ok(read(path.join(refDir, "walkthrough.md")).includes(en.join(" → ")), "walkthrough.md lacks the en step labels");
  const language = read(path.join(skillDir, "SKILL.md")).match(/\n## Language\n([\s\S]*?)(?=\n## )/)[1];
  assert.match(language, /`templates\/dashboard\.html`[\s\S]*`templates\/walkthrough\.html`/);
});

test("dashboard.md's to-do, ask, and needs rows say how the list differs by autonomy level", () => {
  const rows = read(path.join(refDir, "dashboard.md")).split("\n");
  for (const start of ["| **To-do list**", "| `ask` |", "| `needs` |"]) {
    const row = rows.find((l) => l.startsWith(start));
    assert.ok(row, `no row ${start}`);
    assert.match(row, /`medium`[\s\S]*`high`/, `${start} row does not name the levels`);
  }
});

const section = (text, heading) => (text.match(new RegExp(`\\n## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`)) || [])[1] || "";

test("SKILL.md builds one sidebar tree: a parent recorded with its old name, workers re-parented under it", () => {
  const start = section(read(path.join(skillDir, "SKILL.md")), "Start or resume");
  assert.match(start, /`hubWorktreeOldName`/, "no hubWorktreeOldName in Start or resume");
  assert.match(start, /`isMainWorktree: true`/, "does not say how the main workspace is found");
  assert.match(start, /orca worktree set --worktree path:<worker path> --parent-worktree path:<hubWorktree>/,
    "no re-parent command for a top-level worker");
  assert.doesNotMatch(start, /use `new-top-level` and log it/, "accepts top-level workers as the final state");
});

test("cleanup restores the parent's old name when the hub closes, and upgrade sets the parent", () => {
  const closing = section(read(path.join(refDir, "cleanup.md")), "Closing the hub");
  assert.match(closing, /`hubWorktreeOldName`/, "Closing the hub does not restore the old name");
  assert.match(closing, /early/, "the early-close path is not covered");
  assert.match(read(path.join(refDir, "upgrade.md")), /`hubWorktreeOldName`/, "upgrade.md lacks the line for an older hub");
});

test("state.js carries hubWorktreeOldName beside hubWorktree, empty by default", () => {
  const vm = require("node:vm");
  const sandbox = { window: {} };
  vm.runInNewContext(read(path.join(skillDir, "templates", "state.js")), sandbox);
  assert.strictEqual(sandbox.window.HUB_STATE.hubWorktreeOldName, "");
  const keys = Object.keys(sandbox.window.HUB_STATE);
  assert.strictEqual(keys.indexOf("hubWorktreeOldName"), keys.indexOf("hubWorktree") + 1);
});

test("the push rules name their exact forms and the allow list names its limits", () => {
  const protocol = read(path.join(refDir, "worker-spec.md"));
  const rule = (n) => protocol.split("\n").find((l) => l.startsWith(`${n}. `)) || "";
  assert.match(rule(11), /Push \(`git push`\)/, "rule 11 does not name the push form");
  assert.match(rule(13), /upstream/, "rule 13 does not say the bare push needs the upstream set first");
  const autonomy = section(read(path.join(skillDir, "SKILL.md")), "Autonomy levels");
  assert.match(autonomy, /`\+<ref>` are asked or refused/);
  assert.doesNotMatch(autonomy, /`\+<ref>` are refused/);
  assert.match(autonomy, /don't ask again/, "the allow-list paragraph does not warn about a stored answer");
});
