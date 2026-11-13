#!/usr/bin/env node
"use strict";
// Gives a Claude Code or Codex worker the permission rules of the hub's autonomy level, and takes them back.
//   node allow.cjs write <worktree> <low|medium|high>   low removes what an earlier write added
//   node allow.cjs remove <worktree>
//   node allow.cjs check <worktree>                      exit 1 while anything it wrote is still there
// It writes only <worktree>/.claude/settings.local.json, <worktree>/.codex/rules/orca-hub.rules, a
// .gitignore in each of .claude and .codex that keeps them out of git, and a record in the worktree's git
// dir. It never sets a permission mode and never reads or writes user settings.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Claude Code rule syntax (code.claude.com/docs/en/permissions, verified on 2.1.323). A rule without `*`
// matches one exact command, so only the three pushes the protocol uses run without a prompt; every other
// push asks, and the deny list refuses a plain force push as a second layer. Ask outranks allow, so an rm
// that may leave the worktree, or a gh pr create aimed at another repo (--repo, -R with or without a
// space; --base stays allowed for stacked PRs), still prompts. Rules match command text: a best-effort
// limit, not a boundary.
const RULES = {
  allow: ["Bash(git push)", "Bash(git push -u origin HEAD)", "Bash(git push --force-with-lease)",
    "Bash(gh pr create *)", "Bash(rm *)"],
  ask: ["Bash(rm /*)", "Bash(rm * /*)", "Bash(rm *..*)", "Bash(rm *~*)", "Bash(rm *$*)",
    "Bash(rm *.git)", "Bash(rm *.git/*)", "Bash(rm *.git *)",
    "Bash(gh pr create --repo *)", "Bash(gh pr create * --repo *)", "Bash(gh pr create --repo=*)",
    "Bash(gh pr create * --repo=*)", "Bash(gh pr create -R*)", "Bash(gh pr create * -R*)"],
  deny: ["Bash(git push --force *)", "Bash(git push * --force)", "Bash(git push * --force *)",
    "Bash(git push -f *)", "Bash(git push * -f)", "Bash(git push * -f *)", "Bash(git push * +*)"],
};
// Codex prefix_rule syntax (developers.openai.com/codex/rules, measured on Codex CLI 0.166.0): a rule
// matches a command whose argument list starts with its pattern, each position a literal or a list of
// alternatives, and the most restrictive match wins (forbidden, then prompt, then allow). There are no
// wildcards, so these guard fewer forms than the Claude rules. Codex checks each rule's match and
// not_match examples when it loads the file.
const FORCE = ["--force", "-f"];
const MAIN = ["main", "master", "HEAD:main", "HEAD:master"];
const CODEX_RULES = [
  { pattern: ["git", "push", "-u", "origin", "HEAD"], decision: "allow", justification: "orca-hub: the push workers use",
    match: ["git push -u origin HEAD"], not_match: ["git push -u origin HEAD:main", "git push origin HEAD"] },
  { pattern: ["git", "push", "--force-with-lease"], decision: "allow", justification: "orca-hub: the push after a rebase",
    match: ["git push --force-with-lease", "git push --force-with-lease origin x"], not_match: ["git push --force"] },
  { pattern: ["gh", "pr", "create"], decision: "allow", justification: "orca-hub: opening the item's PR",
    match: ["gh pr create --base feat/a --title t"], not_match: ["gh pr merge 1"] },
  { pattern: ["gh", "pr", "create", ["--repo", "-R"]], decision: "prompt",
    justification: "orca-hub: a PR in another repo needs the developer",
    match: ["gh pr create --repo o/r", "gh pr create -R o/r"], not_match: ["gh pr create --base feat/a"] },
  { pattern: ["rm", ["-r", "-rf", "-fr", "-R", "-Rf"], ["/", "~", "..", ".git", ".git/"]], decision: "prompt",
    justification: "orca-hub: this rm may leave the worktree or delete its git link",
    match: ["rm -rf /", "rm -r ..", "rm -fr ~", "rm -rf .git"], not_match: ["rm -rf src", "rm notes.txt"] },
  { pattern: ["git", "push", "origin", MAIN], decision: "prompt", justification: "orca-hub: a push to main or master needs the developer",
    match: ["git push origin main", "git push origin HEAD:master"], not_match: ["git push origin feat/a"] },
  { pattern: ["git", "push", "-u", "origin", MAIN], decision: "prompt", justification: "orca-hub: a push to main or master needs the developer",
    match: ["git push -u origin main"], not_match: ["git push -u origin HEAD"] },
  { pattern: ["git", "push", FORCE], decision: "forbidden", justification: "orca-hub: no plain force push; use git push --force-with-lease",
    match: ["git push --force", "git push -f origin x"], not_match: ["git push --force-with-lease"] },
  { pattern: ["git", "push", "origin", FORCE], decision: "forbidden", justification: "orca-hub: no plain force push; use git push --force-with-lease",
    match: ["git push origin --force", "git push origin -f x"], not_match: ["git push origin --force-with-lease"] },
  { pattern: ["git", "push", "-u", "origin", "HEAD", FORCE], decision: "forbidden",
    justification: "orca-hub: no plain force push; use git push --force-with-lease",
    match: ["git push -u origin HEAD --force"], not_match: ["git push -u origin HEAD --force-with-lease"] },
];
const CODEX_TEXT = `# orca-hub allow.cjs: written for one worker and removed with its allow list.
# Codex matches only the start of a command's argument list, so these rules are best-effort and weaker than
# the Claude rules beside them. Not matched: a flag in a later position (gh pr create --title t --repo o/r),
# a joined value (-Ro/r, --repo=o/r), other rm flag spellings (-r -f, -fR), and other paths under the
# home directory or above the worktree. A session that bypasses approvals refuses a "prompt" command too.

` + CODEX_RULES.map((r) => `prefix_rule(\n${Object.entries(r).map(([k, v]) => `    ${k} = ${JSON.stringify(v)},\n`).join("")})\n`).join("\n");
const LEVELS = { low: false, medium: true, high: true };
const IGNORE = "# orca-hub allow.cjs: removed with its allow list\nsettings.local.json\n.gitignore\n";
const CODEX_IGNORE = "# orca-hub allow.cjs: removed with its allow list\nrules/orca-hub.rules\n.gitignore\n";

const [cmd, arg, level] = process.argv.slice(2);
if (!arg || !["write", "remove", "check"].includes(cmd) || (cmd === "write" && !(level in LEVELS))) {
  console.error("usage: node allow.cjs write <worktree> <low|medium|high> | remove <worktree> | check <worktree>");
  process.exit(2);
}
const wt = path.resolve(arg);
const fail = (code, msg) => { console.error(msg); process.exit(code); };
const dir = path.join(wt, ".claude");
const file = path.join(dir, "settings.local.json");
const ignore = path.join(dir, ".gitignore");
const codexDir = path.join(wt, ".codex");
const rulesDir = path.join(codexDir, "rules");
const rulesFile = path.join(rulesDir, "orca-hub.rules");
const codexIgnore = path.join(codexDir, ".gitignore");
const git = (...args) => spawnSync("git", ["-C", wt, ...args], { encoding: "utf8" });
const top = git("rev-parse", "--show-toplevel").stdout.trim();
if (!top || fs.realpathSync(top) !== fs.realpathSync(wt)) fail(2, `not a git worktree root: ${wt}`);
const record = path.join(git("rev-parse", "--absolute-git-dir").stdout.trim(), "orca-hub-allow.json");
for (const p of [dir, file, codexDir, rulesDir, rulesFile]) if (fs.existsSync(p) && fs.lstatSync(p).isSymbolicLink()) fail(1, `refused: ${p} is a symlink`);
const parse = (text, f) => { try { return JSON.parse(text); } catch { return fail(1, `not valid JSON: ${f}`); } };
const readJson = (f) => (fs.existsSync(f) ? parse(fs.readFileSync(f, "utf8"), f) : null);

function remove() {
  const rec = readJson(record);
  if (!rec) return;
  const now = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (now === rec.written) {
    if (rec.original === null) fs.rmSync(file);
    else fs.writeFileSync(file, rec.original);
  } else if (now !== null) { // changed since the write: take out only the rules it added
    const settings = parse(now, file);
    for (const key of Object.keys(RULES)) {
      const list = settings.permissions && settings.permissions[key];
      if (list) settings.permissions[key] = list.filter((r) => !rec.added[key].includes(r));
    }
    fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
  }
  if (rec.madeIgnore) fs.rmSync(ignore, { force: true });
  if (rec.madeDir && fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  if (rec.codex) { // the rules file carries this script's name, so it goes back to what was there
    if (rec.codex.original === null) fs.rmSync(rulesFile, { force: true });
    else fs.writeFileSync(rulesFile, rec.codex.original);
    if (rec.codex.madeIgnore) fs.rmSync(codexIgnore, { force: true });
    for (const [d, made] of [[rulesDir, rec.codex.madeRulesDir], [codexDir, rec.codex.madeDir]]) {
      if (made && fs.existsSync(d) && fs.readdirSync(d).length === 0) fs.rmdirSync(d);
    }
  }
  fs.rmSync(record);
}

function write() {
  remove();
  if (!LEVELS[level]) return;
  const ignored = git("check-ignore", "-q", "--no-index", file).status === 0;
  const codexIgnored = git("check-ignore", "-q", "--no-index", rulesFile).status === 0;
  for (const [f, shown, owner] of [[file, !ignored, ignore], [rulesFile, !codexIgnored, codexIgnore]]) {
    if (shown && fs.existsSync(owner)) {
      console.error(`not written: git would show ${f} and the repo owns ${owner}; this worker keeps its prompts`);
      process.exit(1);
    }
  }
  const rec = { level, files: [file, rulesFile, ...(ignored ? [] : [ignore]), ...(codexIgnored ? [] : [codexIgnore])],
    original: fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null,
    madeDir: !fs.existsSync(dir), madeIgnore: !ignored, added: {},
    codex: { original: fs.existsSync(rulesFile) ? fs.readFileSync(rulesFile, "utf8") : null,
      madeDir: !fs.existsSync(codexDir), madeRulesDir: !fs.existsSync(rulesDir), madeIgnore: !codexIgnored } };
  const settings = rec.original === null ? {} : parse(rec.original, file);
  settings.permissions = settings.permissions || {};
  for (const [key, rules] of Object.entries(RULES)) {
    const list = settings.permissions[key] || [];
    rec.added[key] = rules.filter((r) => !list.includes(r));
    settings.permissions[key] = [...list, ...rec.added[key]];
  }
  rec.written = JSON.stringify(settings, null, 2) + "\n";
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(rulesDir, { recursive: true });
  fs.writeFileSync(record, JSON.stringify(rec, null, 2) + "\n");
  if (rec.madeIgnore) fs.writeFileSync(ignore, IGNORE);
  fs.writeFileSync(file, rec.written);
  if (rec.codex.madeIgnore) fs.writeFileSync(codexIgnore, CODEX_IGNORE);
  fs.writeFileSync(rulesFile, CODEX_TEXT);
  console.log(`wrote ${level} rules to ${file} and ${rulesFile}`);
}

// remove deletes the record last, so a remove that stopped halfway leaves it for check to report.
function check() {
  const left = [];
  const rec = readJson(record);
  if (rec) left.push(`record ${record}`);
  for (const [f, text] of [[ignore, IGNORE], [codexIgnore, CODEX_IGNORE], [rulesFile, CODEX_TEXT]]) {
    if (fs.existsSync(f) && fs.readFileSync(f, "utf8") === text) left.push(`file ${f}`);
  }
  const p = (readJson(file) || {}).permissions || {};
  for (const [key, rules] of Object.entries(rec ? rec.added : {})) { // rules the original held are not ours
    for (const r of rules) if ((p[key] || []).includes(r)) left.push(`${key} ${r} in ${file}`);
  }
  for (const line of left) console.log(`left: ${line}`);
  if (left.length) process.exit(1);
  console.log(`clean: ${wt}`);
}

({ write, remove, check })[cmd]();
