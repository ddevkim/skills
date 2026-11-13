// Keeps the hub instructions portable: every path they name exists, nothing
// in them holds only on the author's machine, and the language rules stay in place.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const skillDir = path.join(root, "skills", "hub");
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
        if (rel === "skills/hub/templates/state.js" && p.startsWith("/Users/me/")) continue;
        found.push(`${rel}:${i + 1}: ${p}`);
      }
      for (const [p] of line.matchAll(/(?:~|\$HOME|\$\{HOME\})\/[^\s"'`)]*/g)) {
        if (rel === "skills/hub/SKILL.md" && p === "~/orca/workspaces/<repo>") continue; // Orca's documented default
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
  assert.strictEqual(f.name, "hub");
  assert.match(f.description, /^Use when the developer invokes \/vera:hub or \$vera:hub /);
  assert.match(read(path.join(skillDir, "SKILL.md")), /^# Vera hub$/m);
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

test("resume never records the hub's own name as the parent's old name", () => {
  const start = section(read(path.join(skillDir, "SKILL.md")), "Start or resume");
  assert.match(start, /a resume never records/, "step 5 records the old name on every pass");
  assert.match(start, /`hubWorktree` set: only re-parent its live workers/, "resume re-runs step 5 on a renamed parent");
  assert.doesNotMatch(start, /set the parent as in step 5 and re-parent/, "resume re-records the parent's current name");
  assert.match(start, /name already has a hub's `<Hub> · <feature>` form/, "a second hub would record the first hub's name");
});

test("cleanup restores the parent's old name when the hub closes, and upgrade sets the parent", () => {
  const closing = section(read(path.join(refDir, "cleanup.md")), "Closing the hub");
  assert.match(closing, /`hubWorktreeOldName`/, "Closing the hub does not restore the old name");
  assert.match(closing, /when the developer closes the hub early/, "the early-close path is not covered");
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

const autonomy0 = () => section(read(path.join(skillDir, "SKILL.md")), "Autonomy levels");

test("the push rules name their exact forms and the allow list names its limits", () => {
  const protocol = read(path.join(refDir, "worker-spec.md"));
  const rule = (n) => protocol.split("\n").find((l) => l.startsWith(`${n}. `)) || "";
  assert.match(rule(11), /Push \(`git push`\)/, "rule 11 does not name the push form");
  assert.match(rule(13), /upstream/, "rule 13 does not say the bare push needs the upstream set first");
  assert.match(rule(13), /`\+<ref>` are asked or refused/, "rule 13 must say other push forms are asked or refused");
  assert.match(rule(13), /unless <the developer>'s own settings ask/, "rule 13 must not promise no prompt unconditionally");
  assert.match(autonomy0(), /ask and deny rules outrank allow from any settings file/, "the allow list must say user ask or deny rules still prompt");
  assert.match(autonomy0(), /never edits user settings/);
  const autonomy = section(read(path.join(skillDir, "SKILL.md")), "Autonomy levels");
  assert.match(autonomy, /`\+<ref>` are asked or refused/);
  assert.doesNotMatch(autonomy, /`\+<ref>` are refused/);
  assert.match(autonomy, /"don't ask again" answer in a worker terminal is stored by Claude Code for the main checkout and outlives the worktree/,
    "the allow-list paragraph does not warn about a stored answer");
});

test("the hub records whether the parent's name was automatic and asks when it cannot give a name back", () => {
  const vm = require("node:vm");
  const sandbox = { window: {} };
  vm.runInNewContext(read(path.join(skillDir, "templates", "state.js")), sandbox);
  const keys = Object.keys(sandbox.window.HUB_STATE);
  assert.strictEqual(sandbox.window.HUB_STATE.hubWorktreeOldNameMode, "");
  assert.strictEqual(keys.indexOf("hubWorktreeOldNameMode"), keys.indexOf("hubWorktreeOldName") + 1);
  const start = section(read(path.join(skillDir, "SKILL.md")), "Start or resume");
  assert.match(start, /`hubWorktreeOldNameMode` \(the mode\)/, "step 5 does not record the name mode");
  assert.match(start, /rename it again when its name differs from the hub's/, "resume leaves an unrenamed parent");
  const closing = section(read(path.join(refDir, "cleanup.md")), "Closing the hub");
  assert.match(closing, /no command returns a workspace to its automatic name/, "the close hides that an automatic name comes back fixed");
  assert.match(closing, /Otherwise, if the parent still carries the hub's name: ask the developer which name to give back/);
  assert.match(closing, /`--workspace-status`/, "the close does not say what happens to the parent's board status");
  assert.match(read(path.join(refDir, "upgrade.md")), /an existing `hubWorktree` is kept/);
});

test("step 5 reads and records the parent's name in one edit before it renames, once per hub folder", () => {
  const start = section(read(path.join(skillDir, "SKILL.md")), "Start or resume");
  const steps = ["1. Find the parent:", "2. Read that row's `displayName` and `displayNameMode`", "3. A parent whose name already has a hub's",
    "4. Write `hubWorktree`", "5. Only then rename:"].map((s) => start.indexOf(s));
  assert.ok(steps.every((i) => i >= 0), `a sub-step is missing: ${steps}`);
  assert.deepStrictEqual([...steps].sort((a, b) => a - b), steps, "the sub-steps are out of order");
  assert.match(start, /Write `hubWorktree` \(the path\), `hubWorktreeOldName` \(the name\), and `hubWorktreeOldNameMode` \(the mode\) into `state\.js` in one edit/);
  assert.match(start, /This recording happens exactly once per hub folder: on a new hub, or on an upgrade whose `hubWorktree` was ""; a resume never records\./);
  assert.doesNotMatch(start, /only while `hubWorktree` is still ""/, "the guard follows the store");
  const vm = require("node:vm");
  const sandbox = { window: {} };
  vm.runInNewContext(read(path.join(skillDir, "templates", "state.js")), sandbox);
  assert.strictEqual(sandbox.window.HUB_STATE.hubWorktree, "", "a fresh hub folder must start with an empty hubWorktree");
});

test("the close leaves a parent another open hub still shows under", () => {
  const closing = section(read(path.join(refDir, "cleanup.md")), "Closing the hub");
  assert.match(closing, /another open hub records the same `hubWorktree`/, "the close must check other hubs on the same parent");
  assert.match(closing, /Otherwise, if the parent still carries the hub's name: ask/);
  const up = read(path.join(refDir, "upgrade.md"));
  assert.match(up, /`hubWorktree`, `hubWorktreeOldName`, and `hubWorktreeOldNameMode`/, "upgrade step 5 must name all three fields");
  assert.match(up, /sub-steps 1-4 are skipped/);
});

test("Codex workers get the allow list, push only in the forms their prefix rules can name, and report refusals", () => {
  const autonomy = section(read(path.join(skillDir, "SKILL.md")), "Autonomy levels");
  assert.doesNotMatch(autonomy, /Codex workers keep prompting/, "the allow list still says Codex gets nothing");
  assert.match(autonomy, /`<worktree>\/\.codex\/rules\/vera-hub\.rules`/);
  assert.match(autonomy, /Codex refuses a `prompt` command instead of asking/);
  assert.doesNotMatch(section(read(path.join(skillDir, "SKILL.md")), "Start or resume"), /with a Claude worker, create the worktree first/,
    "step 6 writes the allow list for Claude workers only");
  const rule13 = read(path.join(refDir, "worker-spec.md")).split("\n").find((l) => l.startsWith("13. ")) || "";
  assert.match(rule13, /As a Codex worker[^.]*`git push -u origin HEAD` in place of the bare `git push` in rules 6d, 6e and 11, and `git push --force-with-lease` after a rebase/);
  assert.match(read(path.join(refDir, "cleanup.md")), /':!\.codex\/rules\/vera-hub\.rules'/);
});

test("the Codex rules are described as prefixes that also allow what follows, and refusals go to the developer", () => {
  const autonomy = section(read(path.join(skillDir, "SKILL.md")), "Autonomy levels");
  const row = autonomy.split("\n").find((l) => l.startsWith("| Worker permission prompts")) || "";
  assert.match(row, /Codex[^|]*allow rules also cover anything appended to these forms/, "the table promises exact forms to Codex workers");
  assert.match(row, /guard rules cover fewer forms than Claude's/);
  assert.match(row, /the bare `git push` is not pre-allowed for a Codex worker/, "the table lists the bare push as pre-allowed for Codex");
  assert.match(row, /Codex[^|]*a relative `rm` runs because the sandbox or the bypass lets it, not because of an allow rule/,
    "the table says Codex pre-allows rm");
  const rule13 = read(path.join(refDir, "worker-spec.md")).split("\n").find((l) => l.startsWith("13. ")) || "";
  assert.match(rule13, /Codex[^.]*a relative `rm` runs because the sandbox or the bypass lets it, not because of an allow rule/,
    "rule 13 says Codex pre-allows rm");
  assert.doesNotMatch(rule13, /Every other push form asks <the developer>/, "rule 13 says every push form asks, which a Codex worker under bypass does not get");
  assert.match(rule13, /Codex[^.]*allow rules also cover anything appended to these forms/);
  assert.match(rule13, /`git push origin feat\/x`/, "rule 13 does not show a push form that runs unasked under bypass");
  const question = read(path.join(skillDir, "SKILL.md")).split("\n").find((l) => l.startsWith("| `question` from a worker")) || "";
  assert.match(question, /Codex policy refusal[^|]*the command and why/);
  assert.match(question, /never replies with another form of the refused command/);
});

test("the allow list says each half is written on its own", () => {
  const autonomy = section(read(path.join(skillDir, "SKILL.md")), "Autonomy levels");
  assert.doesNotMatch(autonomy, /nothing was written, and that worker keeps its prompts/, "the old all-or-nothing refusal is still documented");
  assert.match(autonomy, /writes each half on its own/);
  assert.match(autonomy, /tracks `\.claude\/settings\.local\.json`/);
  assert.match(autonomy, /exits 1 only when it wrote neither half/);
  assert.match(autonomy, /a symlink in one of its paths/, "the per-half skip does not name a symlink");
  assert.match(autonomy, /settings file that is not valid JSON/, "the per-half skip does not name broken JSON");
});
