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

test("refuses a dangling symlink at any path it writes, and creates nothing at its target", () => {
  for (const rel of [".claude", ".claude/settings.local.json", ".claude/.gitignore", ".codex", ".codex/rules",
    ".codex/rules/orca-hub.rules", ".codex/.gitignore"]) {
    const l = lab();
    const target = path.join(l.root, "away");
    const link = path.join(l.wt, rel);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link);
    const r = l.run("write", l.wt, "medium");
    assert.strictEqual(r.code, 1, rel);
    assert.match(r.out, /symlink/, rel);
    assert.ok(!fs.existsSync(target), `${rel}: wrote through a dangling symlink`);
  }
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
  for (const gap of ["git -C . push --force", "other than origin", "rm -rf src ..", "$"]) assert.ok(text.includes(gap), `header does not name ${gap}`);
  const want = {
    "git push -u origin HEAD": "allow", "git push --force-with-lease": "allow",
    "gh pr create --title t": "allow", "gh pr create --base feat/a --title t": "allow", "gh pr create --title x --body y": "allow",
    "git push --force origin HEAD": "forbidden", "git push -f": "forbidden", "git push origin --force": "forbidden",
    "git push origin -f x": "forbidden", "git push -u origin HEAD --force": "forbidden", "git push -u origin HEAD -f": "forbidden",
    "gh pr create --repo o/r": "prompt", "gh pr create -R o/r": "prompt",
    "rm -rf .git": "prompt", "rm -rf /": "prompt", "rm -r ..": "prompt", "rm -fr ~": "prompt", "rm -Rf .git/": "prompt",
    "rm -rf .": "prompt", "rm -rf ./": "prompt", "rm -rf *": "prompt",
    "rm notes.txt": null, "rm -rf src": null,
    "git push origin HEAD:main": "prompt", "git push origin main": "prompt", "git push origin master": "prompt",
    "git push origin HEAD:master": "prompt", "git push -u origin main": "prompt",
    "git push origin +HEAD:main": "prompt", "git push origin :main": "prompt", "git push origin --delete main": "prompt",
    // a prefix allow covers whatever follows it, so the forms that reach main or force through one need their own rule
    "git push --force-with-lease origin x": "prompt", "git push --force-with-lease origin main": "prompt",
    "git push --force-with-lease origin HEAD:main": "prompt", "git push --force-with-lease origin +HEAD:main": "prompt",
    "git push --force-with-lease origin --force": "prompt", "git push --force-with-lease --force": "prompt",
    "git push --force-with-lease -f": "prompt", "git push --force-with-lease --mirror": "prompt",
    "git push --force-with-lease --all": "prompt", "git push --force-with-lease --delete": "prompt",
    "git push -u origin HEAD +HEAD:main": "prompt", "git push -u origin HEAD HEAD:main": "prompt",
    "git push -u origin HEAD +HEAD:master": "prompt", "git push -u origin HEAD main": "prompt",
    "git push -u origin HEAD :main": "prompt", "git push -u origin HEAD --delete main": "prompt",
    "git push -u origin HEAD -d main": "prompt", "git push -u origin HEAD --mirror": "prompt",
    "git push -u origin HEAD --all": "prompt", "git push -u origin HEAD --tags": "prompt",
  };
  const got = Object.fromEntries(Object.keys(want).map((cmd) => [cmd, decide(rules, cmd)]));
  assert.deepStrictEqual(got, want);
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

test("refuses a symlinked .codex", () => {
  const l = lab();
  const away = path.join(l.root, "away");
  fs.mkdirSync(away);
  fs.symlinkSync(away, codexFiles(l.wt).dir);
  assert.strictEqual(l.run("write", l.wt, "medium").code, 1);
  assert.deepStrictEqual(fs.readdirSync(away), [], "wrote through the symlink");
  assert.ok(!fs.existsSync(l.file), "wrote the Claude rules after refusing");
});
