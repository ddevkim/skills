#!/usr/bin/env node
/* Checks a walkthrough data file against the worker's committed head, before anyone shows it to the developer.
   Usage: node <hub>/walkcheck.cjs <hub>/walkthroughs/<id>-w<n>.js <worktree path> origin/<base>
   Prints one line per problem and exits 1, or prints "ok" and exits 0. It never changes the worktree.
   On "ok" it also writes <id>-w<n>.diff.js beside the data file: the per-file diff the page shows, taken from git. */
"use strict";
const fs = require("fs");
const { execFileSync } = require("child_process");

const [file, wt, base] = process.argv.slice(2);
if (!file || !wt || !base) { console.log("usage: walkcheck.cjs <data.js> <worktree> origin/<base>"); process.exit(2); }
const problems = [];
const git = (...a) => execFileSync("git", ["-c", "core.quotePath=false", "-C", wt, ...a], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });

// 1. Plain data only: the page runs this file as a script, so anything but JSON could execute.
let D = null;
const m = fs.readFileSync(file, "utf8").match(/^\s*window\.HUB_WALK\s*=\s*([\s\S]*?);?\s*$/);
try { D = m ? JSON.parse(m[1]) : null; } catch { D = null; }
if (!D || typeof D !== "object") {
  console.log("not plain JSON data: write the file as `window.HUB_WALK = <JSON.stringify output>;` with nothing else");
  process.exit(1);
}
const arr = x => Array.isArray(x) ? x : [];

// 2. Required fields.
for (const k of ["item", "round", "title", "head", "base", "files"]) if (D[k] === undefined || D[k] === "") problems.push(`missing field: ${k}`);
if (D.kind !== "docs" && !arr(D.purpose && D.purpose.spec).length) problems.push("missing field: purpose.spec");

// 3. The worktree is clean and at the walkthrough's head.
if (git("status", "--porcelain").trim()) problems.push("the worktree has uncommitted changes: commit them or leave them out, then write the walkthrough again");
const head = git("rev-parse", "HEAD").trim();
if (!/^[0-9a-f]{7,40}$/.test(String(D.head || "")) || !head.startsWith(String(D.head))) problems.push(`head ${D.head} is not the worktree's head ${head.slice(0, 7)}`);

// 4. Every file:line exists at the head, and every code excerpt equals the file from that line.
const lines = new Map();
const fileLines = f => {
  if (!lines.has(f)) {
    let text = null;
    try { text = git("show", `HEAD:${f}`); } catch { text = null; }
    lines.set(f, text === null ? null : text.replace(/\n$/, "").split("\n"));
  }
  return lines.get(f);
};
const norm = s => s.replace(/\s+$/, "");
const refs = [
  ...arr(D.flow).map(s => ({ ...s, where: "flow" })),
  ...arr(D.edges).flatMap(e => arr(e.steps).map(s => ({ ...s, where: `edges "${e.name}"` }))),
  ...arr(D.tests).map(s => ({ ...s, where: "tests" })),
  ...arr(D.changes).filter(c => c && typeof c === "object" && !c.removed).map(s => ({ ...s, where: "changes" })),
];
for (const s of refs) {
  if (!s.file) continue;
  const L = fileLines(s.file);
  const n = Number(s.line);
  if (!L) { problems.push(`${s.where}: ${s.file}:${s.line} — the file does not exist at the head`); continue; }
  if (!Number.isInteger(n) || n < 1 || n > L.length) { problems.push(`${s.where}: ${s.file}:${s.line} — the file has ${L.length} lines`); continue; }
  if (typeof s.code === "string" && s.code !== "") {
    const want = s.code.replace(/\n$/, "").split("\n");
    const got = L.slice(n - 1, n - 1 + want.length);
    const k = want.findIndex((w, i) => norm(w) !== norm(got[i] ?? ""));
    if (k >= 0) problems.push(`${s.where}: ${s.file}:${n + k} — the excerpt says ${JSON.stringify(want[k])} but the file says ${JSON.stringify(got[k] ?? "(end of file)")}`);
  }
}

// 5. The structure map names real files, known layers, and nodes that exist.
const map = D.map && typeof D.map === "object" ? D.map : {};
const layers = arr(map.layers), ids = new Set(arr(map.nodes).map(n => n.id));
if (["behaviour", "schema"].includes(D.kind) && !arr(map.nodes).length) problems.push("missing field: map.nodes (the modules this PR touches)");
for (const n of arr(map.nodes)) {
  if (!n.id || !n.label) problems.push(`map: a node needs id and label (${JSON.stringify(n)})`);
  if (!layers.includes(n.layer)) problems.push(`map: node ${n.id} has layer ${JSON.stringify(n.layer)}, which is not in map.layers`);
  if (!["new", "changed", "existing"].includes(n.state)) problems.push(`map: node ${n.id} needs state new, changed, or existing`);
  if (n.file && !fileLines(n.file)) problems.push(`map: node ${n.id} — ${n.file} does not exist at the head`);
}
for (const l of arr(map.links)) for (const end of [l.from, l.to]) if (!ids.has(end)) problems.push(`map: link ${l.from} → ${l.to} names ${JSON.stringify(end)}, which is not a node id`);

// 6. files equals the diff against the base, path by path and count by count.
const diff = new Map();
for (const row of git("diff", "--numstat", "--no-renames", `${base}...HEAD`).trim().split("\n").filter(Boolean)) {
  const [a, r, p] = row.split("\t");
  diff.set(p, { a: a === "-" ? 0 : Number(a), r: r === "-" ? 0 : Number(r) });
}
const listed = new Map(arr(D.files).map(f => [f.path, f]));
for (const [p, { a, r }] of diff) {
  const f = listed.get(p);
  if (!f) problems.push(`files: ${p} changed (+${a} −${r}) but is not listed`);
  else if (Number(f.added) !== a || Number(f.removed) !== r) problems.push(`files: ${p} is listed as +${f.added} −${f.removed} but the diff says +${a} −${r}`);
}
for (const p of listed.keys()) if (!diff.has(p)) problems.push(`files: ${p} is listed but did not change`);

if (problems.length) { console.log(problems.join("\n")); process.exit(1); }

// 7. The per-file diff, from git and never by hand. A file with more than MAX_LINES diff lines is listed without its lines.
const MAX_LINES = 800;
const raw = git("diff", "--no-ext-diff", "--no-color", "--no-renames", "--no-textconv", "--src-prefix=a/", "--dst-prefix=b/", `${base}...HEAD`);
const diffFiles = raw.split(/^(?=diff --git )/m).filter(Boolean).map(chunk => {
  const ls = chunk.replace(/\n$/, "").split("\n");
  // The path from "+++ b/<path>" (or "--- a/<path>" for a deleted file); a binary or mode-only change has neither, so the
  // header "diff --git a/<path> b/<path>" is split in half (no renames: both halves are the same path).
  const plus = ls.find(l => l.startsWith("+++ b/")), minus = ls.find(l => l.startsWith("--- a/"));
  const rest = ls[0].slice("diff --git a/".length);
  const path = (plus ? plus.slice(6) : minus ? minus.slice(6) : rest.slice(0, (rest.length - 3) / 2)).replace(/\t$/, ""); // git ends a path with a space in a tab
  const at = ls.findIndex(l => l.startsWith("@@"));
  if (at < 0) return { path, note: ls.some(l => l.startsWith("Binary files")) ? "binary" : "mode" };
  const lines = ls.slice(at);
  return lines.length > MAX_LINES ? { path, omitted: lines.length } : { path, lines };
});
const out = file.replace(/\.js$/, "") + ".diff.js";
fs.writeFileSync(`${out}.${process.pid}.tmp`, "window.HUB_DIFF = " + JSON.stringify({ head: head.slice(0, 7), base, files: diffFiles }) + ";\n");
fs.renameSync(`${out}.${process.pid}.tmp`, out);
console.log("ok");
