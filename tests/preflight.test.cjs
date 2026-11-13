const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SCRIPT = path.join(__dirname, "..", "skills", "orca-hub", "scripts", "preflight.cjs");

const OK = {
  git: 'echo "git version 2.40.0"',
  orca: [
    'case "$1 $2" in',
    '  "--version ") echo "1.4.256" ;;',
    '  "repo list") echo "[]" ;;',
    '  "skills get") echo "# orchestration" ;;',
    "  *) exit 2 ;;",
    "esac",
  ].join("\n"),
  gh: [
    'case "$1 $2" in',
    '  "auth status") echo "  ✓ Logged in to github.com account octo (keyring)" ;;',
    "  *) exit 2 ;;",
    "esac",
  ].join("\n"),
};

// Builds a PATH dir of stub executables; a null body leaves that tool out.
function run(overrides = {}, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preflight-"));
  const bodies = { ...OK, ...overrides };
  for (const [name, body] of Object.entries(bodies)) {
    if (body === null) continue;
    const file = path.join(dir, name);
    fs.writeFileSync(file, "#!/bin/sh\n" + body + "\n");
    fs.chmodSync(file, 0o755);
  }
  const r = spawnSync(process.execPath, [SCRIPT], {
    env: { PATH: dir, ...env },
    encoding: "utf8",
    timeout: 20000,
  });
  fs.rmSync(dir, { recursive: true, force: true });
  return { code: r.status, lines: r.stdout.trim().split("\n").filter(Boolean) };
}

test("all present: one ok line with versions, exit 0", () => {
  const r = run();
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.lines.length, 1);
  assert.match(r.lines[0], /^ok: orca 1\.4\.256, gh octo, node v\d+\.\d+\.\d+, git 2\.40\.0$/);
});

test("orca absent: names Orca and where to get it", () => {
  const r = run({ orca: null });
  assert.strictEqual(r.code, 1);
  assert.ok(r.lines.some((l) => /^missing: .*Orca.*https:\/\/orca\.dev\b/.test(l)), r.lines.join("\n"));
});

test("orca app closed: tells to open the Orca app", () => {
  const r = run({ orca: 'case "$1 $2" in "repo list") exit 1 ;; "skills get") echo x ;; *) echo 1.4.256 ;; esac' });
  assert.strictEqual(r.code, 1);
  assert.ok(r.lines.some((l) => /^missing: .*open the Orca app/.test(l)), r.lines.join("\n"));
});

test("orchestration skill missing: names it and the install command", () => {
  const r = run({ orca: 'case "$1 $2" in "skills get") exit 1 ;; *) echo 1.4.256 ;; esac' });
  assert.strictEqual(r.code, 1);
  assert.ok(
    r.lines.some((l) => /^missing: .*orchestration.*orca skills install --skill orchestration/.test(l)),
    r.lines.join("\n"),
  );
});

test("gh absent: install pointer", () => {
  const r = run({ gh: null });
  assert.strictEqual(r.code, 1);
  assert.ok(r.lines.some((l) => /^missing: .*gh.*https:\/\/cli\.github\.com/.test(l)), r.lines.join("\n"));
});

test("gh not logged in: gh auth login", () => {
  const r = run({ gh: 'echo "You are not logged into any GitHub hosts." >&2; exit 1' });
  assert.strictEqual(r.code, 1);
  assert.ok(r.lines.some((l) => /^missing: .*gh auth login/.test(l)), r.lines.join("\n"));
});

test("git absent: names git", () => {
  const r = run({ git: null });
  assert.strictEqual(r.code, 1);
  assert.ok(r.lines.some((l) => /^missing: git\b/.test(l)), r.lines.join("\n"));
});

test("two failures: both lines in one run", () => {
  const r = run({ orca: null, gh: null });
  assert.strictEqual(r.code, 1);
  assert.ok(r.lines.some((l) => /Orca/.test(l)), r.lines.join("\n"));
  assert.ok(r.lines.some((l) => /cli\.github\.com/.test(l)), r.lines.join("\n"));
});

test("hung tool: times out into a missing line", () => {
  const start = Date.now();
  const r = run({ gh: "exec /bin/sleep 30" }, { PREFLIGHT_TIMEOUT_MS: "500" });
  assert.ok(Date.now() - start < 10000, "script hung");
  assert.strictEqual(r.code, 1);
  assert.ok(r.lines.some((l) => /^missing: .*gh/.test(l)), r.lines.join("\n"));
});
