#!/usr/bin/env node
"use strict";
// Gives a Claude Code worker the permission rules of the hub's autonomy level, and takes them back.
//   node allow.cjs write <worktree> <low|medium|high>   low removes what an earlier write added
//   node allow.cjs remove <worktree>
//   node allow.cjs check <worktree>                      exit 1 while anything it wrote is still there
// It writes only <worktree>/.claude/settings.local.json, a .claude/.gitignore that keeps that file out of
// git, and a record in the worktree's git dir. It never sets a permission mode and never reads or writes
// user settings. Codex workers get nothing: no per-worktree equivalent was verified.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Claude Code rule syntax (code.claude.com/docs/en/permissions, verified on 2.1.323). A rule without `*`
// matches one exact command, so only the three pushes the protocol uses run without a prompt; every other
// push asks, and the deny list refuses a plain force push as a second layer. Ask outranks allow, so an rm
// that may leave the worktree still prompts. Rules match command text: a best-effort limit, not a boundary.
const RULES = {
  allow: ["Bash(git push)", "Bash(git push -u origin HEAD)", "Bash(git push --force-with-lease)",
    "Bash(gh pr create *)", "Bash(rm *)"],
  ask: ["Bash(rm /*)", "Bash(rm * /*)", "Bash(rm *..*)", "Bash(rm *~*)", "Bash(rm *$*)",
    "Bash(rm *.git)", "Bash(rm *.git/*)", "Bash(rm *.git *)"],
  deny: ["Bash(git push --force *)", "Bash(git push * --force)", "Bash(git push * --force *)",
    "Bash(git push -f *)", "Bash(git push * -f)", "Bash(git push * -f *)", "Bash(git push * +*)"],
};
const LEVELS = { low: false, medium: true, high: true };
const IGNORE = "# orca-hub allow.cjs: removed with its allow list\nsettings.local.json\n.gitignore\n";

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
const git = (...args) => spawnSync("git", ["-C", wt, ...args], { encoding: "utf8" });
const top = git("rev-parse", "--show-toplevel").stdout.trim();
if (!top || fs.realpathSync(top) !== fs.realpathSync(wt)) fail(2, `not a git worktree root: ${wt}`);
const record = path.join(git("rev-parse", "--absolute-git-dir").stdout.trim(), "orca-hub-allow.json");
for (const p of [dir, file]) if (fs.existsSync(p) && fs.lstatSync(p).isSymbolicLink()) fail(1, `refused: ${p} is a symlink`);
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
  fs.rmSync(record);
}

function write() {
  remove();
  if (!LEVELS[level]) return;
  const ignored = git("check-ignore", "-q", "--no-index", file).status === 0;
  if (!ignored && fs.existsSync(ignore)) {
    console.error(`not written: git would show ${file} and the repo owns ${ignore}; this worker keeps its prompts`);
    process.exit(1);
  }
  const rec = { level, original: fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null,
    madeDir: !fs.existsSync(dir), madeIgnore: !ignored, added: {} };
  const settings = rec.original === null ? {} : parse(rec.original, file);
  settings.permissions = settings.permissions || {};
  for (const [key, rules] of Object.entries(RULES)) {
    const list = settings.permissions[key] || [];
    rec.added[key] = rules.filter((r) => !list.includes(r));
    settings.permissions[key] = [...list, ...rec.added[key]];
  }
  rec.written = JSON.stringify(settings, null, 2) + "\n";
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(record, JSON.stringify(rec, null, 2) + "\n");
  if (rec.madeIgnore) fs.writeFileSync(ignore, IGNORE);
  fs.writeFileSync(file, rec.written);
  console.log(`wrote ${level} rules to ${file}`);
}

// remove deletes the record last, so a remove that stopped halfway leaves it for check to report.
function check() {
  const left = [];
  const rec = readJson(record);
  if (rec) left.push(`record ${record}`);
  if (fs.existsSync(ignore) && fs.readFileSync(ignore, "utf8") === IGNORE) left.push(`file ${ignore}`);
  const p = (readJson(file) || {}).permissions || {};
  for (const [key, rules] of Object.entries(rec ? rec.added : {})) { // rules the original held are not ours
    for (const r of rules) if ((p[key] || []).includes(r)) left.push(`${key} ${r} in ${file}`);
  }
  for (const line of left) console.log(`left: ${line}`);
  if (left.length) process.exit(1);
  console.log(`clean: ${wt}`);
}

({ write, remove, check })[cmd]();
