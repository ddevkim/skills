// allow.cjs writes the permission rules an autonomy level gives a Claude Code worker into
// that worker's worktree only, and removes them so the worktree is as it was.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SCRIPT = path.join(__dirname, "..", "skills", "orca-hub", "scripts", "allow.cjs");

// A temp root holding a fresh git repo (the worktree), an empty HOME, and an empty Claude config dir.
function lab() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "allow-"));
  const wt = path.join(root, "wt");
  for (const d of ["home", "cfg", "wt"]) fs.mkdirSync(path.join(root, d));
  fs.writeFileSync(path.join(root, "gitconfig"), "");
  const env = { ...process.env, HOME: path.join(root, "home"), CLAUDE_CONFIG_DIR: path.join(root, "cfg"),
    GIT_CONFIG_GLOBAL: path.join(root, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1" };
  spawnSync("git", ["init", "-q", wt], { env });
  const run = (...args) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { env, encoding: "utf8" });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  const git = (...args) => spawnSync("git", ["-C", wt, ...args], { env, encoding: "utf8" }).stdout;
  return { root, wt, run, git, file: path.join(wt, ".claude", "settings.local.json") };
}

// Every file under dir with its bytes, skipping git's own object store and index.
function snapshot(dir, skip = () => false) {
  const out = {};
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (skip(p)) return;
    if (e.isDirectory()) walk(p); else out[path.relative(dir, p)] = fs.readFileSync(p, "hex");
  });
  walk(dir);
  return out;
}

// A model of Claude Code's documented Bash rule syntax (not its real matcher): `*` is any text, and a trailing " *" also matches the bare command.
function matches(rule, cmd) {
  const body = rule.match(/^Bash\((.*)\)$/)[1];
  const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const re = body.endsWith(" *") && body.indexOf("*") === body.length - 1
    ? esc(body.slice(0, -2)) + "( .*)?"
    : body.split("*").map(esc).join(".*");
  return new RegExp(`^${re}$`).test(cmd);
}

test("low writes nothing", () => {
  const l = lab();
  const before = snapshot(l.wt);
  assert.strictEqual(l.run("write", l.wt, "low").code, 0);
  assert.deepStrictEqual(snapshot(l.wt), before);
});

test("medium and high write the same rules, kept out of git", () => {
  const written = ["medium", "high"].map((level) => {
    const l = lab();
    assert.strictEqual(l.run("write", l.wt, level).code, 0);
    assert.strictEqual(l.git("status", "--porcelain"), "", "the allow list shows in git status");
    return JSON.parse(fs.readFileSync(l.file, "utf8")).permissions;
  });
  assert.deepStrictEqual(written[0], written[1]);
  const p = written[0];
  const allowed = (cmd) => p.allow.some((r) => matches(r, cmd)) && ![...p.ask, ...p.deny].some((r) => matches(r, cmd));
  for (const cmd of ["git push", "git push -u origin HEAD", "git push --force-with-lease", "gh pr create --base main --title t",
    "rm src/old.js", "rm -f tests/a.test.cjs"]) assert.ok(allowed(cmd), `not pre-allowed: ${cmd}`);
  for (const cmd of ["git push --force", "git push -f origin x", "git push origin x --force", "git push origin +x",
    "git push -fu origin x", "git push -u origin --delete x", "git push -u origin :x", "git push -u origin x -d", "git push origin -f x", "git push origin --prune", "git push --mirror", "git push origin main",
    "git push origin HEAD:main", "git push -u origin main", "git push --force-with-lease origin main", "git push origin x -fu",
    "rm ../other/file", "rm -rf /tmp/x", "rm ~/x", "rm $DIR/x"]) assert.ok(!allowed(cmd), `runs without a prompt: ${cmd}`);
});

test("write merges into an existing file and remove restores its bytes", () => {
  const l = lab();
  fs.mkdirSync(path.dirname(l.file));
  const original = '{\n    "model": "opus",\n    "permissions": { "allow": ["Bash(gh pr create *)", "Bash(npm test)"] }\n}\n';
  fs.writeFileSync(l.file, original);
  fs.writeFileSync(path.join(l.wt, ".gitignore"), ".claude/settings.local.json\n");
  assert.strictEqual(l.run("write", l.wt, "medium").code, 0);
  const merged = JSON.parse(fs.readFileSync(l.file, "utf8"));
  assert.strictEqual(merged.model, "opus");
  assert.ok(merged.permissions.allow.includes("Bash(npm test)"));
  assert.ok(merged.permissions.allow.includes("Bash(git push -u origin HEAD)"));
  assert.strictEqual(merged.permissions.allow.filter((r) => r === "Bash(gh pr create *)").length, 1);
  assert.strictEqual(l.run("remove", l.wt).code, 0);
  assert.strictEqual(fs.readFileSync(l.file, "utf8"), original);
  assert.strictEqual(l.run("check", l.wt).code, 0, "check reports a rule the original file held");
});

test("remove leaves nothing where there was nothing, and check says so", () => {
  const l = lab();
  const before = snapshot(l.wt, (p) => p.endsWith(".git"));
  assert.strictEqual(l.run("check", l.wt).code, 0);
  assert.strictEqual(l.run("write", l.wt, "high").code, 0);
  const found = l.run("check", l.wt);
  assert.notStrictEqual(found.code, 0, "check passed while the allow list exists");
  assert.match(found.out, /Bash\(gh pr create \*\)/);
  assert.strictEqual(l.run("remove", l.wt).code, 0);
  assert.deepStrictEqual(snapshot(l.wt, (p) => p.endsWith(".git")), before);
  assert.strictEqual(l.run("check", l.wt).code, 0);
});

test("never a bypass mode, never a file outside the worktree", () => {
  for (const level of ["low", "medium", "high"]) {
    const l = lab();
    const outside = snapshot(l.root, (p) => p === l.wt);
    assert.strictEqual(l.run("write", l.wt, level).code, 0);
    const text = fs.existsSync(l.file) ? fs.readFileSync(l.file, "utf8") : "";
    assert.doesNotMatch(text, /bypassPermissions|defaultMode|dangerously|disableBypass/);
    assert.deepStrictEqual(snapshot(l.root, (p) => p === l.wt), outside);
    l.run("remove", l.wt);
    assert.deepStrictEqual(snapshot(l.root, (p) => p === l.wt), outside);
  }
});

test("refuses when the file would show in git and the repo owns .claude/.gitignore", () => {
  const l = lab();
  fs.mkdirSync(path.dirname(l.file));
  fs.writeFileSync(path.join(l.wt, ".claude", ".gitignore"), "cache/\n");
  const r = l.run("write", l.wt, "medium");
  assert.notStrictEqual(r.code, 0);
  assert.match(r.out, /git/);
  assert.ok(!fs.existsSync(l.file), "wrote a file git would show");
});

test("refuses a symlinked .claude, a path that is not a worktree, and broken JSON, with a plain message", () => {
  const l = lab();
  const away = path.join(l.root, "away");
  fs.mkdirSync(away);
  fs.symlinkSync(away, path.join(l.wt, ".claude"));
  const linked = l.run("write", l.wt, "medium");
  assert.strictEqual(linked.code, 1);
  assert.deepStrictEqual(fs.readdirSync(away), [], "wrote through the symlink");
  const notRepo = l.run("write", away, "medium");
  assert.strictEqual(notRepo.code, 2);
  assert.doesNotMatch(notRepo.out, /\n\s+at /, "stack trace");
  assert.deepStrictEqual(fs.readdirSync(away), [], "left a directory in a path that is not a worktree");
  const m = lab();
  fs.mkdirSync(path.dirname(m.file));
  fs.writeFileSync(m.file, "{ not json");
  for (const args of [["write", m.wt, "high"], ["check", m.wt]]) {
    const r = m.run(...args);
    assert.strictEqual(r.code, 1, args[0]);
    assert.match(r.out, /not valid JSON/);
    assert.doesNotMatch(r.out, /\n\s+at /, "stack trace");
  }
  assert.strictEqual(fs.readFileSync(m.file, "utf8"), "{ not json");
});

test("an rm that names .git asks, and an ordinary rm still runs", () => {
  const l = lab();
  assert.strictEqual(l.run("write", l.wt, "medium").code, 0);
  const p = JSON.parse(fs.readFileSync(l.file, "utf8")).permissions;
  const allowed = (cmd) => p.allow.some((r) => matches(r, cmd)) && ![...p.ask, ...p.deny].some((r) => matches(r, cmd));
  for (const cmd of ["rm -rf .git", "rm -r .git/hooks"]) assert.ok(!allowed(cmd), `runs without a prompt: ${cmd}`);
  assert.ok(allowed("rm notes.txt"), "rm notes.txt is no longer pre-allowed");
});
