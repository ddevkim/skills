#!/usr/bin/env node
"use strict";
// Gives a Claude Code or Codex worker the permission rules of the hub's autonomy level, and takes them back.
//   node allow.cjs write <worktree> <low|medium|high>   low removes what an earlier write added
//   node allow.cjs remove <worktree>
//   node allow.cjs check <worktree>                      exit 1 while anything it wrote is still there
// It writes only <worktree>/.claude/settings.local.json, <worktree>/.codex/rules/orca-hub.rules, a
// .gitignore in each of .claude and .codex that keeps them out of git, and a record in the worktree's git
// dir. It never sets a permission mode and never reads or writes user settings. write exits 1 only when it
// wrote neither half.
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
// wildcards, so these guard fewer forms than the Claude rules, and an allow rule also allows whatever
// follows its pattern: the prompt rules after each push allow name the forms that would reach main or
// widen the push. Codex checks each rule's match and not_match examples when it loads the file.
const FORCE = ["--force", "-f"];
const MAIN = ["main", "master", "HEAD:main", "HEAD:master", "+main", "+master", "+HEAD:main", "+HEAD:master", ":main", ":master"];
const WIDE = ["--delete", "-d", "--mirror", "--all", "--branches", "--tags", "--prune"];
const CODEX_RULES = [
  { pattern: ["git", "push", "-u", "origin", "HEAD"], decision: "allow", justification: "orca-hub: the push workers use",
    match: ["git push -u origin HEAD"], not_match: ["git push -u origin HEAD:main", "git push origin HEAD"] },
  { pattern: ["git", "push", "-u", "origin", "HEAD", [...MAIN, ...WIDE]], decision: "prompt",
    justification: "orca-hub: a push to main or master, or a wider push, needs the developer",
    match: ["git push -u origin HEAD +HEAD:main", "git push -u origin HEAD --delete main"], not_match: ["git push -u origin HEAD"] },
  { pattern: ["git", "push", "--force-with-lease"], decision: "allow", justification: "orca-hub: the push after a rebase",
    match: ["git push --force-with-lease"], not_match: ["git push --force"] },
  { pattern: ["git", "push", "--force-with-lease", ["origin", ...FORCE, ...WIDE]], decision: "prompt",
    justification: "orca-hub: workers push --force-with-lease with nothing after it",
    match: ["git push --force-with-lease origin main", "git push --force-with-lease --force"], not_match: ["git push --force-with-lease"] },
  { pattern: ["gh", "pr", "create"], decision: "allow", justification: "orca-hub: opening the item's PR",
    match: ["gh pr create --base feat/a --title t"], not_match: ["gh pr merge 1"] },
  { pattern: ["gh", "pr", "create", ["--repo", "-R"]], decision: "prompt",
    justification: "orca-hub: a PR in another repo needs the developer",
    match: ["gh pr create --repo o/r", "gh pr create -R o/r"], not_match: ["gh pr create --base feat/a"] },
  { pattern: ["rm", ["-r", "-rf", "-fr", "-R", "-Rf"], ["/", "~", "..", ".git", ".git/", ".", "./", "*"]], decision: "prompt",
    justification: "orca-hub: this rm may leave the worktree, delete it, or delete its git link",
    match: ["rm -rf /", "rm -r ..", "rm -fr ~", "rm -rf .git", "rm -rf ."], not_match: ["rm -rf src", "rm notes.txt"] },
  { pattern: ["git", "push", "origin", [...MAIN, ...WIDE]], decision: "prompt",
    justification: "orca-hub: a push to main or master, or a wider push, needs the developer",
    match: ["git push origin main", "git push origin HEAD:master", "git push origin --delete main"], not_match: ["git push origin feat/a"] },
  { pattern: ["git", "push", "-u", "origin", [...MAIN, ...WIDE]], decision: "prompt",
    justification: "orca-hub: a push to main or master, or a wider push, needs the developer",
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
# the Claude rules beside them, and anything appended after an allowed prefix also runs. Not matched: a flag
# in a later position (gh pr create --title t --repo o/r), a joined value (-Ro/r, --repo=o/r), git options
# before the subcommand (git -C . push --force), remotes other than origin, other rm flag spellings (-r -f,
# -fR), a later operand (rm -rf src ..), a $ expansion, and other paths under the home directory or above
# the worktree. A session that bypasses approvals refuses a "prompt" command too.

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
// lstat, not existsSync: existsSync follows a link, so a dangling one would pass and a write would land at its target.
const isLink = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };
for (const p of [dir, file, ignore, codexDir, rulesDir, rulesFile, codexIgnore]) if (isLink(p)) fail(1, `refused: ${p} is a symlink`);
const parse = (text, f) => { try { return JSON.parse(text); } catch { return fail(1, `not valid JSON: ${f}`); } };
const readJson = (f) => (fs.existsSync(f) ? parse(fs.readFileSync(f, "utf8"), f) : null);

function remove() {
  const rec = readJson(record);
  if (!rec) return;
  const claude = rec.claude === undefined ? rec : rec.claude; // a record from 0.1.1 keeps the Claude half at the top
  const now = claude && fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (claude && now === claude.written) {
    if (claude.original === null) fs.rmSync(file);
    else fs.writeFileSync(file, claude.original);
  } else if (now !== null) { // changed since the write: take out only the rules it added
    const settings = parse(now, file);
    for (const key of Object.keys(RULES)) {
      const list = settings.permissions && settings.permissions[key];
      if (list) settings.permissions[key] = list.filter((r) => !claude.added[key].includes(r));
    }
    fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
  }
  if (claude && claude.madeIgnore) fs.rmSync(ignore, { force: true });
  if (claude && claude.madeDir && fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
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

// Each half (Claude, Codex) is written on its own, so a repo that owns one half's files still lets the other agent's
// workers run without prompts. A half is skipped when git would show its file and the repo owns that half's
// .gitignore, or when git tracks its file (git add -A would commit the rules).
function skipped(f, owner, agent) {
  const tracked = git("ls-files", "--error-unmatch", f).status === 0;
  const shown = git("check-ignore", "-q", "--no-index", f).status !== 0;
  const why = tracked ? `${f} is tracked by git` : shown && fs.existsSync(owner) ? `git would show ${f} and the repo owns ${owner}` : "";
  if (why) console.error(`not written: ${why}; a ${agent} worker keeps its prompts`);
  return why ? null : { madeIgnore: shown };
}

function write() {
  remove();
  if (!LEVELS[level]) return;
  const rec = { level, claude: skipped(file, ignore, "Claude Code"), codex: skipped(rulesFile, codexIgnore, "Codex") };
  if (!rec.claude && !rec.codex) process.exit(1);
  const { claude, codex } = rec;
  if (claude) {
    Object.assign(claude, { original: fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null, madeDir: !fs.existsSync(dir), added: {} });
    const settings = claude.original === null ? {} : parse(claude.original, file);
    settings.permissions = settings.permissions || {};
    for (const [key, rules] of Object.entries(RULES)) {
      const list = settings.permissions[key] || [];
      claude.added[key] = rules.filter((r) => !list.includes(r));
      settings.permissions[key] = [...list, ...claude.added[key]];
    }
    claude.written = JSON.stringify(settings, null, 2) + "\n";
  }
  if (codex) Object.assign(codex, { original: fs.existsSync(rulesFile) ? fs.readFileSync(rulesFile, "utf8") : null,
    madeDir: !fs.existsSync(codexDir), madeRulesDir: !fs.existsSync(rulesDir) });
  fs.writeFileSync(record, JSON.stringify(rec, null, 2) + "\n");
  if (claude) {
    fs.mkdirSync(dir, { recursive: true });
    if (claude.madeIgnore) fs.writeFileSync(ignore, IGNORE);
    fs.writeFileSync(file, claude.written);
  }
  if (codex) {
    fs.mkdirSync(rulesDir, { recursive: true });
    if (codex.madeIgnore) fs.writeFileSync(codexIgnore, CODEX_IGNORE);
    fs.writeFileSync(rulesFile, CODEX_TEXT);
  }
  console.log(`wrote ${level} rules to ${[claude && file, codex && rulesFile].filter(Boolean).join(" and ")}`);
}

// remove deletes the record last, so a remove that stopped halfway leaves it for check to report.
function check() {
  const left = [];
  const rec = readJson(record);
  if (rec) left.push(`record ${record}`);
  for (const [f, text] of [[ignore, IGNORE], [codexIgnore, CODEX_IGNORE], [rulesFile, CODEX_TEXT]]) {
    if (fs.existsSync(f) && fs.readFileSync(f, "utf8") === text) left.push(`file ${f}`);
  }
  const claude = rec && (rec.claude === undefined ? rec : rec.claude);
  const p = (readJson(file) || {}).permissions || {};
  for (const [key, rules] of Object.entries(claude ? claude.added : {})) { // rules the original held are not ours
    for (const r of rules) if ((p[key] || []).includes(r)) left.push(`${key} ${r} in ${file}`);
  }
  for (const line of left) console.log(`left: ${line}`);
  if (left.length) process.exit(1);
  console.log(`clean: ${wt}`);
}

({ write, remove, check })[cmd]();
