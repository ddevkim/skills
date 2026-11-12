"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const SYNC = path.join(__dirname, "..", "skills", "orca-hub", "templates", "sync.cjs");

// A copy in an empty folder: if loading it started the loop, it would write sync.pid there and exit, not touch templates/.
function loadInEmptyFolder() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-"));
  fs.copyFileSync(SYNC, path.join(dir, "sync.cjs"));
  const out = execFileSync(process.execPath, ["-e", "const m = require('./sync.cjs'); setTimeout(() => console.log(typeof m.notes), 50)"], { cwd: dir, encoding: "utf8" });
  return { out: out.trim(), files: fs.readdirSync(dir) };
}

test("loading sync.cjs as a module exports notes and starts no loop", () => {
  const { out, files } = loadInEmptyFolder();
  assert.strictEqual(out, "function");
  assert.deepStrictEqual(files, ["sync.cjs"]);
});

const msg = (sequence, type, item, body) => ({ sequence, type, item, body, created_at: `t${sequence}` });
const run = (messages, after = 0) => require(SYNC).notes({ result: { messages } }, m => m.item, after);

test("notes keeps each item's newest SUMMARY line, in sequence order", () => {
  const out = run([
    msg(3, "status", "S1", "SUMMARY: 세 번째"),
    msg(1, "status", "S1", "SUMMARY: 첫 번째"),
    msg(2, "worker_done", "S2", "SUMMARY: 끝났습니다\nmore"),
  ]);
  assert.strictEqual(out.S1.text, "세 번째");
  assert.strictEqual(out.S1.at, "t3");
  assert.strictEqual(out.S2.text, "끝났습니다");
});

test("notes ignores other message types and bodies without the line", () => {
  const out = run([
    msg(1, "status", "S1", "SUMMARY: 남습니다"),
    msg(2, "ask", "S1", "SUMMARY: 질문입니다"),
    msg(3, "escalation", "S1", "SUMMARY: 막혔습니다"),
    msg(4, "status", "S1", "no summary here"),
    msg(5, "status", "S3", "nothing"),
  ]);
  assert.deepStrictEqual(Object.keys(out), ["S1"]);
  assert.strictEqual(out.S1.text, "남습니다");
});

test("notes accepts the line indented, in a list, and in bold", () => {
  for (const body of ["   SUMMARY: 가", "- SUMMARY: 가", "1. SUMMARY: 가", "**SUMMARY:** 가", "intro\n  - **SUMMARY:** 가"]) {
    assert.strictEqual(run([msg(1, "status", "S1", body)]).S1.text, "가", body);
  }
});

test("notes marks fresh only for messages after the given sequence", () => {
  const out = run([msg(4, "status", "S1", "SUMMARY: 옛것"), msg(5, "status", "S2", "SUMMARY: 새것")], 4);
  assert.strictEqual(out.S1.fresh, false);
  assert.strictEqual(out.S2.fresh, true);
});
