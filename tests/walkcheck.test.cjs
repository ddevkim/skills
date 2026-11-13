"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const WALKCHECK = path.join(__dirname, "..", "skills", "hub", "templates", "walkcheck.cjs");
// Ignore the machine's git config (signing, hooks, default branch) so the run is the same locally and on CI.
const env = { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
const git = (cwd, ...a) => execFileSync("git", a, { cwd, env, encoding: "utf8" });

// An "origin" with one commit on main, and a clone with one feature commit that changes app.js and adds lib.js.
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "walkcheck-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const origin = path.join(root, "origin"), wt = path.join(root, "wt");
  fs.mkdirSync(origin);
  git(origin, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(origin, "app.js"), "const a = 1;\nmodule.exports = a;\n");
  git(origin, "add", ".");
  git(origin, "commit", "-qm", "base");
  git(root, "clone", "-q", origin, wt);
  fs.writeFileSync(path.join(wt, "app.js"), "const a = 2;\nconst b = a + 1;\nmodule.exports = b;\n");
  fs.writeFileSync(path.join(wt, "lib.js"), "exports.x = 1;\n");
  git(wt, "add", ".");
  git(wt, "commit", "-qm", "feature");
  const head = git(wt, "rev-parse", "--short", "HEAD").trim();
  const data = {
    item: "S9", round: 1, title: "t", head, base: "main", kind: "behaviour",
    purpose: { spec: [{ id: "C1", text: "x" }] },
    map: { layers: ["code"], nodes: [{ id: "app", label: "app", layer: "code", file: "app.js", state: "changed" },
      { id: "lib", label: "lib", layer: "code", file: "lib.js", state: "new" }], links: [{ from: "app", to: "lib", label: "uses" }] },
    flow: [{ title: "adds one", file: "app.js", line: 2, code: "const b = a + 1;\nmodule.exports = b;" }],
    files: [{ path: "app.js", added: 3, removed: 2 }, { path: "lib.js", added: 1, removed: 0 }],
  };
  return { root, wt, data };
}

function walkcheck({ root, wt }, data) {
  const file = path.join(root, "walks", "S9-w1.js");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "window.HUB_WALK = " + JSON.stringify(data) + ";\n");
  const r = spawnSync(process.execPath, [WALKCHECK, file, wt, "origin/main"], { env, encoding: "utf8" });
  return { code: r.status, out: r.stdout, diff: path.join(root, "walks", "S9-w1.diff.js") };
}

test("each walkcheck test removes its temp folder", async t => {
  let root;
  await t.test("fixture", st => { root = setup(st).root; });
  assert.strictEqual(fs.existsSync(root), false);
});

test("walkcheck prints ok and writes the diff file when the walkthrough matches the head", t => {
  const s = setup(t);
  const r = walkcheck(s, s.data);
  assert.strictEqual(r.out, "ok\n");
  assert.strictEqual(r.code, 0);
  const diff = fs.readFileSync(r.diff, "utf8");
  assert.match(diff, /^window\.HUB_DIFF = /);
  assert.deepStrictEqual(JSON.parse(diff.slice(18).replace(/;\n$/, "")).files.map(f => f.path), ["app.js", "lib.js"]);
});

test("walkcheck fails when a flow excerpt differs from the file at that line", t => {
  const s = setup(t);
  s.data.flow[0].code = "const b = a + 2;\nmodule.exports = b;";
  const r = walkcheck(s, s.data);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /flow: app\.js:2 — the excerpt says "const b = a \+ 2;"/);
  assert.ok(!fs.existsSync(r.diff));
});

test("walkcheck fails when files omits a changed file", t => {
  const s = setup(t);
  s.data.files.pop();
  const r = walkcheck(s, s.data);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /files: lib\.js changed \(\+1 −0\) but is not listed/);
});

test("walkcheck fails when a map link names a node id that does not exist", t => {
  const s = setup(t);
  s.data.map.links.push({ from: "app", to: "ghost", label: "x" });
  const r = walkcheck(s, s.data);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /map: link app → ghost names "ghost", which is not a node id/);
});

test("walkcheck fails when the worktree has uncommitted changes", t => {
  const s = setup(t);
  fs.appendFileSync(path.join(s.wt, "lib.js"), "exports.y = 2;\n");
  const r = walkcheck(s, s.data);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /the worktree has uncommitted changes/);
});
