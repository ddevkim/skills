// allow.cjs writes the permission rules an autonomy level gives a Claude Code or Codex worker into
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

test("skips the Claude rules when they would show in git and the repo owns .claude/.gitignore, and still writes the Codex rules", () => {
  const l = lab();
  const c = codexFiles(l.wt);
  fs.mkdirSync(path.dirname(l.file));
  fs.writeFileSync(path.join(l.wt, ".claude", ".gitignore"), "cache/\n");
  const before = snapshot(l.wt, (p) => p.endsWith(".git"));
  const r = l.run("write", l.wt, "medium");
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /not written: .*\.claude/);
  assert.ok(!fs.existsSync(l.file), "wrote a file git would show");
  assert.strictEqual(fs.readFileSync(path.join(l.wt, ".claude", ".gitignore"), "utf8"), "cache/\n");
  assert.ok(fs.existsSync(c.rules) && fs.existsSync(c.ignore), "a Codex worker lost its rules over the Claude half");
  assert.strictEqual(l.git("status", "--porcelain"), "?? .claude/\n", "the Codex rules show in git status");
  assert.notStrictEqual(l.run("check", l.wt).code, 0, "check passed while the Codex rules exist");
  assert.strictEqual(l.run("remove", l.wt).code, 0);
  assert.deepStrictEqual(snapshot(l.wt, (p) => p.endsWith(".git")), before);
  assert.strictEqual(l.run("check", l.wt).code, 0);
});

test("exits 1 and writes nothing when the repo owns both .gitignore files", () => {
  const l = lab();
  const c = codexFiles(l.wt);
  fs.mkdirSync(path.dirname(l.file));
  fs.writeFileSync(path.join(l.wt, ".claude", ".gitignore"), "cache/\n");
  fs.mkdirSync(c.dir);
  fs.writeFileSync(c.ignore, "cache/\n");
  const before = snapshot(l.wt);
  const r = l.run("write", l.wt, "high");
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /\.claude/);
  assert.match(r.out, /\.codex/);
  assert.deepStrictEqual(snapshot(l.wt), before);
});

test("skips a half whose file git tracks, so git add -A never commits the rules", () => {
  for (const half of ["claude", "codex"]) {
    const l = lab();
    const c = codexFiles(l.wt);
    const [mine, other] = half === "claude" ? [l.file, c.rules] : [c.rules, l.file];
    fs.mkdirSync(path.dirname(mine), { recursive: true });
    fs.writeFileSync(mine, half === "claude" ? "{}\n" : "# the repo's own rules\n");
    l.git("add", mine);
    l.git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "track");
    const r = l.run("write", l.wt, "medium");
    assert.strictEqual(r.code, 0, half);
    assert.match(r.out, /not written: .*tracked/, half);
    assert.strictEqual(fs.readFileSync(mine, "utf8"), half === "claude" ? "{}\n" : "# the repo's own rules\n", `${half}: overwrote a tracked file`);
    assert.ok(fs.existsSync(other), `${half}: the other half was not written`);
    assert.strictEqual(l.git("status", "--porcelain"), "", `${half}: the written half shows in git status`);
    assert.strictEqual(l.run("remove", l.wt).code, 0);
    assert.strictEqual(fs.readFileSync(mine, "utf8"), half === "claude" ? "{}\n" : "# the repo's own rules\n", `${half}: remove changed a tracked file`);
    assert.ok(!fs.existsSync(other), `${half}: remove left the other half`);
    assert.strictEqual(l.run("check", l.wt).code, 0, half);
  }
});

test("skips the half with a dangling symlink at any path it writes, creates nothing at its target, and writes the other half", () => {
  for (const rel of [".claude", ".claude/settings.local.json", ".claude/.gitignore", ".codex", ".codex/rules",
    ".codex/rules/orca-hub.rules", ".codex/.gitignore"]) {
    const l = lab();
    const target = path.join(l.root, "away");
    const link = path.join(l.wt, rel);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link);
    const r = l.run("write", l.wt, "medium");
    assert.strictEqual(r.code, 0, rel);
    assert.match(r.out, /not written: .*symlink/, rel);
    assert.ok(!fs.existsSync(target), `${rel}: wrote through a dangling symlink`);
    assert.ok(fs.existsSync(rel.startsWith(".claude") ? codexFiles(l.wt).rules : l.file), `${rel}: the other half was not written`);
    assert.strictEqual(l.run("remove", l.wt).code, 0, rel);
    assert.ok(!fs.existsSync(target), `${rel}: remove wrote through a dangling symlink`);
  }
});

test("exits 1 when both halves hold a symlink", () => {
  const l = lab();
  const away = path.join(l.root, "away");
  fs.mkdirSync(away);
  fs.symlinkSync(away, path.join(l.wt, ".claude"));
  fs.symlinkSync(away, path.join(l.wt, ".codex"));
  const r = l.run("write", l.wt, "medium");
  assert.strictEqual(r.code, 1);
  assert.deepStrictEqual(fs.readdirSync(away), [], "wrote through the symlink");
});

test("a symlinked .claude skips only the Claude half, and with no record check, remove and low still pass", () => {
  const l = lab();
  const shared = path.join(l.root, "shared");
  fs.mkdirSync(shared);
  fs.writeFileSync(path.join(shared, "settings.local.json"), "{ not json");
  fs.symlinkSync(shared, path.join(l.wt, ".claude"));
  for (const args of [["check", l.wt], ["remove", l.wt], ["write", l.wt, "low"]]) assert.strictEqual(l.run(...args).code, 0, args[0]);
  const r = l.run("write", l.wt, "medium");
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /not written: .*\.claude.*symlink/);
  assert.deepStrictEqual(fs.readdirSync(shared), ["settings.local.json"], "wrote through the symlink");
  assert.ok(fs.existsSync(codexFiles(l.wt).rules), "a Codex worker lost its rules over a symlinked .claude");
  assert.strictEqual(l.run("remove", l.wt).code, 0);
  assert.strictEqual(l.run("check", l.wt).code, 0);
  assert.strictEqual(fs.readFileSync(path.join(shared, "settings.local.json"), "utf8"), "{ not json");
});

test("remove refuses to write through a symlink that replaced a file it wrote", () => {
  const l = lab();
  const away = path.join(l.root, "away");
  assert.strictEqual(l.run("write", l.wt, "medium").code, 0);
  fs.writeFileSync(away, "theirs\n");
  fs.rmSync(l.file);
  fs.symlinkSync(away, l.file);
  const r = l.run("remove", l.wt);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /symlink/);
  assert.strictEqual(fs.readFileSync(away, "utf8"), "theirs\n");
  assert.notStrictEqual(l.run("check", l.wt).code, 0, "check passed while the record is left");
});

test("broken JSON skips only the Claude half, and with no record check passes", () => {
  const l = lab();
  fs.mkdirSync(path.dirname(l.file));
  fs.writeFileSync(l.file, "{ not json");
  for (const args of [["check", l.wt], ["remove", l.wt], ["write", l.wt, "low"]]) assert.strictEqual(l.run(...args).code, 0, args[0]);
  const r = l.run("write", l.wt, "high");
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /not written: not valid JSON/);
  assert.doesNotMatch(r.out, /\n\s+at /, "stack trace");
  assert.ok(fs.existsSync(codexFiles(l.wt).rules), "a Codex worker lost its rules over broken Claude settings");
  assert.strictEqual(fs.readFileSync(l.file, "utf8"), "{ not json");
  assert.strictEqual(l.run("remove", l.wt).code, 0);
  assert.strictEqual(l.run("check", l.wt).code, 0);
});

test("settings that are not an object, or a permission list that is not an array, skip only the Claude half", () => {
  for (const text of ["null\n", '{"permissions":{"allow":"Bash(ls)"}}\n', "[]\n", '{"permissions":[]}\n']) {
    const l = lab();
    fs.mkdirSync(path.dirname(l.file));
    fs.writeFileSync(l.file, text);
    const r = l.run("write", l.wt, "high");
    assert.strictEqual(r.code, 0, text);
    assert.match(r.out, /not written: not valid JSON settings/, text);
    assert.doesNotMatch(r.out, /\n\s+at /, `${text}: stack trace`);
    assert.strictEqual(fs.readFileSync(l.file, "utf8"), text);
    assert.ok(fs.existsSync(codexFiles(l.wt).rules), `${text}: the Codex half was not written`);
  }
});

test("remove leaves a .gitignore it made when its text changed since, and says so", () => {
  const l = lab();
  const c = codexFiles(l.wt);
  const ignore = path.join(l.wt, ".claude", ".gitignore");
  assert.strictEqual(l.run("write", l.wt, "medium").code, 0);
  fs.appendFileSync(ignore, "cache/\n");
  fs.appendFileSync(c.ignore, "cache/\n");
  const kept = [fs.readFileSync(ignore, "utf8"), fs.readFileSync(c.ignore, "utf8")];
  const r = l.run("remove", l.wt);
  assert.strictEqual(r.code, 0);
  assert.deepStrictEqual([fs.readFileSync(ignore, "utf8"), fs.readFileSync(c.ignore, "utf8")], kept);
  assert.match(r.out, /\.claude\/\.gitignore/);
  assert.match(r.out, /\.codex\/\.gitignore/);
  assert.ok(!fs.existsSync(l.file) && !fs.existsSync(c.rules), "remove left the rules");
});

test("refuses a path that is not a worktree, and broken JSON in a file it wrote, with a plain message", () => {
  const l = lab();
  const away = path.join(l.root, "away");
  fs.mkdirSync(away);
  const notRepo = l.run("write", away, "medium");
  assert.strictEqual(notRepo.code, 2);
  assert.doesNotMatch(notRepo.out, /\n\s+at /, "stack trace");
  assert.deepStrictEqual(fs.readdirSync(away), [], "left a directory in a path that is not a worktree");
  assert.strictEqual(l.run("write", l.wt, "high").code, 0);
  fs.writeFileSync(l.file, "{ not json");
  for (const args of [["remove", l.wt], ["check", l.wt]]) {
    const r = l.run(...args);
    assert.strictEqual(r.code, 1, args[0]);
    assert.match(r.out, /not valid JSON/);
    assert.doesNotMatch(r.out, /\n\s+at /, "stack trace");
  }
  assert.strictEqual(fs.readFileSync(l.file, "utf8"), "{ not json");
});

test("an rm that names .git asks, and an ordinary rm still runs", () => {
  const l = lab();
  assert.strictEqual(l.run("write", l.wt, "medium").code, 0);
  const p = JSON.parse(fs.readFileSync(l.file, "utf8")).permissions;
  const allowed = (cmd) => p.allow.some((r) => matches(r, cmd)) && ![...p.ask, ...p.deny].some((r) => matches(r, cmd));
  for (const cmd of ["rm -rf .git", "rm -r .git/hooks", "rm -rf ./.git"]) assert.ok(!allowed(cmd), `runs without a prompt: ${cmd}`);
  for (const cmd of ["rm notes.txt", "rm .gitignore"]) assert.ok(allowed(cmd), `${cmd} is no longer pre-allowed`);
});

test("a gh pr create to another repo asks, and --base still runs", () => {
  const l = lab();
  assert.strictEqual(l.run("write", l.wt, "medium").code, 0);
  const p = JSON.parse(fs.readFileSync(l.file, "utf8")).permissions;
  const allowed = (cmd) => p.allow.some((r) => matches(r, cmd)) && ![...p.ask, ...p.deny].some((r) => matches(r, cmd));
  for (const cmd of ["gh pr create --repo o/r --title t", "gh pr create --title t --repo o/r", "gh pr create --repo=o/r",
    "gh pr create --title t --repo=o/r", "gh pr create -R o/r", "gh pr create --title t -R o/r",
    "gh pr create -Ro/r", "gh pr create --title t -Ro/r"]) assert.ok(!allowed(cmd), `runs without a prompt: ${cmd}`);
  for (const cmd of ["gh pr create --base feat/a --title t", "gh pr create --title t --body b"]) assert.ok(allowed(cmd), `${cmd} is no longer pre-allowed`);
});

// A model of Codex's prefix_rule matching (not its real matcher): each pattern position is a literal or a list of
// alternatives, a rule matches any command that starts with its pattern, and the most restrictive decision wins.
const RANK = { allow: 1, prompt: 2, forbidden: 3 };
const codexFiles = (wt) => ({ dir: path.join(wt, ".codex"), rules: path.join(wt, ".codex", "rules", "orca-hub.rules"),
  ignore: path.join(wt, ".codex", ".gitignore") });
function codexRules(text) {
  return [...text.matchAll(/prefix_rule\(([\s\S]*?)\n\)/g)].map(([, body]) => {
    const field = (k) => { const m = body.match(new RegExp(`^\\s*${k} = (.*),$`, "m")); return m ? JSON.parse(m[1]) : undefined; };
    return { pattern: field("pattern"), decision: field("decision"), match: field("match") || [], notMatch: field("not_match") || [] };
  });
}
const tokens = (e) => (Array.isArray(e) ? e : e.split(" "));
const hits = (rule, cmd) => tokens(cmd).length >= rule.pattern.length && rule.pattern.every((p, i) => [].concat(p).includes(tokens(cmd)[i]));
const decide = (rules, cmd) => rules.filter((r) => hits(r, cmd)).map((r) => r.decision).sort((a, b) => RANK[b] - RANK[a])[0] || null;

// The decision each command needs. A prefix allow covers whatever follows it, so the forms that reach main, widen the
// push, or force it through an allowed prefix need their own rule; -f with --force-with-lease drops the lease.
const CODEX_WANT = {
  "git push -u origin HEAD": "allow", "git push --force-with-lease": "allow",
  "gh pr create --title t": "allow", "gh pr create --base feat/a --title t": "allow", "gh pr create --title x --body y": "allow",
  "gh pr create --base feat/a --title x --body y": "allow",
  "git push --force origin HEAD": "forbidden", "git push -f": "forbidden", "git push origin --force": "forbidden",
  "git push origin -f x": "forbidden", "git push -u origin HEAD --force": "forbidden", "git push -u origin HEAD -f": "forbidden",
  "git push -u origin HEAD -fu": "forbidden", "git push -u origin HEAD -uf": "forbidden", "git push -fu origin HEAD": "forbidden",
  "git push origin -uf HEAD:main": "forbidden", "git push --set-upstream origin HEAD --force": "forbidden",
  "git push --force-with-lease --force": "forbidden", "git push --force-with-lease -f": "forbidden",
  "git push --force-with-lease -fu": "forbidden",
  "gh pr create --repo o/r": "prompt", "gh pr create -R o/r": "prompt",
  "rm -rf .git": "prompt", "rm -rf /": "prompt", "rm -r ..": "prompt", "rm -fr ~": "prompt", "rm -Rf .git/": "prompt",
  "rm -rf .": "prompt", "rm -rf ./": "prompt", "rm -rf *": "prompt", "rm -rf ./.git": "prompt", "rm -rf ./.git/": "prompt",
  "rm -rf -- /": "prompt", "rm -rf -- ~": "prompt", "rm -rf -- ..": "prompt", "rm -r -f /": "prompt",
  "rm notes.txt": null, "rm -rf src": null, "rm -rf -- src": null,
  "git push origin HEAD:main": "prompt", "git push origin main": "prompt", "git push origin master": "prompt",
  "git push origin HEAD:master": "prompt", "git push -u origin main": "prompt", "git push -u origin refs/heads/main": "prompt",
  "git push origin +HEAD:main": "prompt", "git push origin :main": "prompt", "git push origin --delete main": "prompt",
  "git push origin HEAD:refs/heads/main": "prompt", "git push origin +HEAD:refs/heads/main": "prompt",
  "git push origin --force-with-lease HEAD:main": "prompt", "git push --set-upstream origin main": "prompt",
  "git push origin feat/a": null, "git push --set-upstream origin HEAD": null,
  "git push --force-with-lease origin x": "prompt", "git push --force-with-lease origin main": "prompt",
  "git push --force-with-lease origin HEAD:main": "prompt", "git push --force-with-lease origin +HEAD:main": "prompt",
  "git push --force-with-lease origin --force": "prompt", "git push --force-with-lease --mirror": "prompt",
  "git push --force-with-lease --all": "prompt", "git push --force-with-lease --delete": "prompt",
  "git push --force-with-lease -u origin HEAD:main": "prompt", "git push --force-with-lease --set-upstream origin main": "prompt",
  "git push --force-with-lease --no-verify origin +HEAD:main": "prompt", "git push --force-with-lease -q origin --delete main": "prompt",
  "git push --force-with-lease --repo=origin HEAD:main": "prompt", "git push --force-with-lease HEAD:main": "prompt",
  "git push --force-with-lease --force-if-includes origin main": "prompt", "git push --force-with-lease -v": "prompt",
  "git push --force-with-lease -o ci.skip": "prompt",
  "git push -u origin HEAD +HEAD:main": "prompt", "git push -u origin HEAD HEAD:main": "prompt",
  "git push -u origin HEAD +HEAD:master": "prompt", "git push -u origin HEAD main": "prompt",
  "git push -u origin HEAD :main": "prompt", "git push -u origin HEAD --delete main": "prompt",
  "git push -u origin HEAD -d main": "prompt", "git push -u origin HEAD --mirror": "prompt",
  "git push -u origin HEAD --all": "prompt", "git push -u origin HEAD --tags": "prompt", "git push -u origin HEAD --prune": "prompt",
  "git push -u origin HEAD HEAD:refs/heads/main": "prompt", "git push -u origin HEAD +HEAD:refs/heads/main": "prompt",
  "git push -u origin HEAD :refs/heads/master": "prompt", "git push -u origin HEAD --no-verify +HEAD:main": "prompt",
  "git push -u origin HEAD -o ci.skip --force": "prompt", "git push -u origin HEAD --force-with-lease": "prompt",
  "git push --set-upstream origin HEAD +HEAD:main": "prompt",
  // flags before the remote
  "git push -d origin feat/x": "prompt", "git push --delete origin feat/x": "prompt", "git push --mirror": "prompt",
  "git push --mirror origin": "prompt", "git push --all origin": "prompt", "git push --prune origin": "prompt",
  "git push --no-verify origin main": "prompt", "git push -q origin HEAD:main": "prompt",
  "git push --no-verify -u origin HEAD:main": "prompt", "git push --no-verify --force": "forbidden",
  "git push -v -f origin HEAD": "forbidden", "git push --quiet origin --delete feat/x": "prompt",
  "git push origin HEAD --force": "forbidden", "git push origin HEAD -f": "forbidden",
  "git push origin -u HEAD:main": "prompt", "git push origin -u main": "prompt", "git push origin --set-upstream main": "prompt",
  "git push origin +HEAD": "prompt", "git push -u origin HEAD +HEAD": "prompt",
  "git push origin --force-with-lease main": "prompt", "git push --force-with-lease origin HEAD": "prompt",
  "git push -u origin HEAD:refs/heads/main": "prompt",
  "rm -rf ./*": "prompt", "rm -rf ../": "prompt", "rm -rf ~/": "prompt", "rm -rf -- .git": "prompt", "rm -f -r .git": "prompt",
  "rm -rf .git .": "prompt",
  "gh pr merge 1": "prompt", "gh pr merge 1 --admin": "prompt",
};
// Forms no prefix rule can name: Codex cannot say "exactly this argument list", so they keep the decision of the prefix
// they start with. The rules file header names each kind; a change here means the header must change too.
const CODEX_GAPS = {
  "git push -u origin HEAD HEAD~3:main": "allow", "git push -u origin HEAD feat/a +HEAD:main": "allow",
  "git push -u origin HEAD :feat/other-worker": "allow", "git push -u origin HEAD +feat/other-worker": "allow",
  "git push -u origin HEAD --force-with-lease=main +HEAD:main": "allow",
  "gh pr create --title x --repo o/r": "allow", "gh pr create -Ro/r": "allow", "gh pr create --repo=o/r": "allow",
  "git -C . push --force": null, "git push upstream main": null, "rm -rf ../x": null, "rm -rf src ..": null,
  "git push -o ci.skip origin main": null, "rm -rf /tmp/x": null, "git push origin feat/x --force": null,
  "git push -fuq origin HEAD": null, "git push --force-with-lease -fuq": "allow", "rm --recursive --force .git": null,
  "rm -rfv .git": null, "git push origin main:main": null,
  "git push": null, "git push origin": null, "git push origin HEAD": null,
};

test("medium and high also write Codex rules kept out of git, and low takes them out", () => {
  for (const level of ["medium", "high"]) {
    const l = lab();
    const c = codexFiles(l.wt);
    assert.strictEqual(l.run("write", l.wt, level).code, 0);
    assert.ok(fs.existsSync(c.rules) && fs.existsSync(c.ignore), `${level} wrote no Codex rules`);
    assert.strictEqual(l.git("check-ignore", c.rules, c.ignore).trim().split("\n").length, 2, "git does not ignore the Codex files");
    assert.strictEqual(l.git("status", "--porcelain"), "");
    assert.strictEqual(l.run("write", l.wt, "low").code, 0);
    assert.ok(!fs.existsSync(c.dir), "low left the Codex rules");
  }
});

test("the Codex rules give each command the decision the protocol needs", () => {
  const l = lab();
  assert.strictEqual(l.run("write", l.wt, "medium").code, 0);
  const text = fs.readFileSync(codexFiles(l.wt).rules, "utf8");
  assert.match(text, /best-effort/);
  const rules = codexRules(text);
  assert.match(text, /anything appended after an allowed prefix also runs/);
  assert.match(text, /exactly this argument list/, "the header does not say why the allow rules cannot be narrower");
  for (const gap of ["git -C . push --force", "other than origin", "rm -rf src ..", "$", "HEAD~3:main", "feat/a +HEAD:main",
    ":feat/x", "--force-with-lease=main", "../x", "git push -o ci.skip origin main", "any absolute path other than / itself (rm -rf /tmp/x)",
    "git push origin feat/x --force", "longer bundled short flags (-fuq)", "--recursive --force", "push.default"])
    assert.ok(text.includes(gap), `header does not name ${gap}`);
  const got = Object.fromEntries(Object.keys(CODEX_WANT).map((cmd) => [cmd, decide(rules, cmd)]));
  assert.deepStrictEqual(got, CODEX_WANT);
  const gaps = Object.fromEntries(Object.keys(CODEX_GAPS).map((cmd) => [cmd, decide(rules, cmd)]));
  assert.deepStrictEqual(gaps, CODEX_GAPS, "a named gap changed: update the header and the table");
});

const hasCodex = spawnSync("codex", ["--version"], { encoding: "utf8" }).status === 0;
test("the real Codex matcher gives every command in both tables the same decision", { skip: !hasCodex && "codex is not on PATH" }, async () => {
  const { spawn } = require("node:child_process");
  const l = lab();
  assert.strictEqual(l.run("write", l.wt, "medium").code, 0);
  const home = path.join(l.root, "codex-home");
  fs.mkdirSync(home);
  const ask = (cmd) => new Promise((resolve, reject) => {
    const p = spawn("codex", ["execpolicy", "check", "--rules", codexFiles(l.wt).rules, "--", ...tokens(cmd)],
      { env: { ...process.env, CODEX_HOME: home } });
    let out = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { out += d; });
    p.on("close", () => { try { resolve(JSON.parse(out).decision || null); } catch { reject(new Error(`${cmd}: ${out}`)); } });
  });
  const all = { ...CODEX_WANT, ...CODEX_GAPS };
  const cmds = Object.keys(all);
  const got = {};
  for (let i = 0; i < cmds.length; i += 8) await Promise.all(cmds.slice(i, i + 8).map(async (c) => { got[c] = await ask(c); }));
  assert.deepStrictEqual(got, all);
});

test("each Codex rule carries examples that hold, so Codex checks them when it loads the file", () => {
  const l = lab();
  assert.strictEqual(l.run("write", l.wt, "high").code, 0);
  const rules = codexRules(fs.readFileSync(codexFiles(l.wt).rules, "utf8"));
  assert.ok(rules.length > 0, "no prefix_rule parsed");
  for (const r of rules) {
    assert.ok(r.match.length > 0 && r.notMatch.length > 0, `rule ${JSON.stringify(r.pattern)} lacks examples`);
    for (const e of r.match) assert.ok(hits(r, e), `match example does not match: ${e}`);
    for (const e of r.notMatch) assert.ok(!hits(r, e), `not_match example matches: ${e}`);
  }
  assert.ok(rules.some((r) => r.decision === "forbidden" && r.notMatch.includes("git push --force-with-lease")),
    "no force rule shows that --force-with-lease is not caught");
});

test("skips the Codex rules when they would show in git and the repo owns .codex/.gitignore, and still writes the Claude rules", () => {
  const l = lab();
  const c = codexFiles(l.wt);
  fs.mkdirSync(c.dir);
  fs.writeFileSync(c.ignore, "cache/\n");
  const before = snapshot(l.wt, (p) => p.endsWith(".git"));
  const r = l.run("write", l.wt, "medium");
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /not written: .*\.codex/);
  assert.ok(!fs.existsSync(c.rules), "wrote a file git would show");
  assert.ok(!fs.existsSync(c.rules.replace(/[^/]+$/, "")), "made .codex/rules for a skipped half");
  assert.strictEqual(fs.readFileSync(c.ignore, "utf8"), "cache/\n");
  assert.ok(fs.existsSync(l.file), "a Claude worker lost its allow list over the Codex half");
  assert.notStrictEqual(l.run("check", l.wt).code, 0, "check passed while the Claude rules exist");
  assert.strictEqual(l.run("remove", l.wt).code, 0);
  assert.deepStrictEqual(snapshot(l.wt, (p) => p.endsWith(".git")), before);
  assert.strictEqual(l.run("check", l.wt).code, 0);
});

test("remove puts back an orca-hub.rules that was there before, byte for byte", () => {
  const l = lab();
  const c = codexFiles(l.wt);
  fs.mkdirSync(path.dirname(c.rules), { recursive: true });
  const original = "# kept by hand\nprefix_rule(pattern = [\"ls\"], decision = \"allow\")\n";
  fs.writeFileSync(c.rules, original);
  assert.strictEqual(l.run("write", l.wt, "high").code, 0);
  assert.notStrictEqual(fs.readFileSync(c.rules, "utf8"), original);
  assert.strictEqual(l.run("remove", l.wt).code, 0);
  assert.strictEqual(fs.readFileSync(c.rules, "utf8"), original);
});

test("remove puts back a recorded orca-hub.rules even after .codex was deleted", () => {
  const l = lab();
  const c = codexFiles(l.wt);
  fs.mkdirSync(path.dirname(c.rules), { recursive: true });
  fs.writeFileSync(c.rules, "# kept by hand\n");
  assert.strictEqual(l.run("write", l.wt, "high").code, 0);
  fs.rmSync(c.dir, { recursive: true });
  const r = l.run("remove", l.wt);
  assert.strictEqual(r.code, 0, r.out);
  assert.strictEqual(fs.readFileSync(c.rules, "utf8"), "# kept by hand\n");
  assert.strictEqual(l.run("check", l.wt).code, 0);
});

test("remove keeps a .codex the repo had, and check names the Codex files while they exist", () => {
  const l = lab();
  const c = codexFiles(l.wt);
  fs.mkdirSync(c.dir);
  fs.writeFileSync(path.join(c.dir, "config.toml"), "model = \"x\"\n");
  const before = snapshot(l.wt, (p) => p.endsWith(".git"));
  assert.strictEqual(l.run("write", l.wt, "high").code, 0);
  const found = l.run("check", l.wt);
  assert.notStrictEqual(found.code, 0);
  assert.match(found.out, /orca-hub\.rules/);
  assert.match(found.out, /\.codex\/\.gitignore/);
  assert.strictEqual(l.run("remove", l.wt).code, 0);
  assert.deepStrictEqual(snapshot(l.wt, (p) => p.endsWith(".git")), before);
  assert.strictEqual(l.run("check", l.wt).code, 0);
});

test("a symlinked .codex skips only the Codex half", () => {
  const l = lab();
  const away = path.join(l.root, "away");
  fs.mkdirSync(away);
  fs.symlinkSync(away, codexFiles(l.wt).dir);
  const r = l.run("write", l.wt, "medium");
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /not written: .*\.codex.*symlink/);
  assert.deepStrictEqual(fs.readdirSync(away), [], "wrote through the symlink");
  assert.ok(fs.existsSync(l.file), "a Claude worker lost its allow list over a symlinked .codex");
});
