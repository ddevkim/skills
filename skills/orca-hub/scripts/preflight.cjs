#!/usr/bin/env node
"use strict";
// Checks what a new orca-hub needs before it starts. Installs nothing.
// Prints one "ok:" line and exits 0, or one "missing:" line per failed check and exits 1.
const { spawnSync } = require("node:child_process");

const TIMEOUT_MS = Number(process.env.PREFLIGHT_TIMEOUT_MS) || 10000;

// Runs a tool; ok is false when it is absent, fails, or outlives the timeout.
function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: TIMEOUT_MS, killSignal: "SIGKILL" });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  return { ok: !r.error && r.status === 0, absent: r.error && r.error.code === "ENOENT", hung: r.error && r.error.code === "ETIMEDOUT", out };
}

function why(r, tool) {
  if (r.absent) return `${tool} is not installed`;
  if (r.hung) return `${tool} did not answer within ${TIMEOUT_MS} ms`;
  return null;
}

const missing = [];
const found = {};

const major = Number(process.versions.node.split(".")[0]);
if (major >= 18) found.node = process.version;
else missing.push(`node ${process.version} is older than 18 — install node 18 or newer: https://nodejs.org`);

const git = run("git", ["--version"]);
if (git.ok) found.git = (git.out.match(/\d+\.\d+(\.\d+)?/) || [git.out.trim()])[0];
else missing.push(`${why(git, "git") || "git does not run"} — install git: https://git-scm.com/downloads`);

const orca = run("orca", ["--version"]);
if (!orca.ok) {
  missing.push(`${why(orca, "Orca") || "the orca CLI does not run"} — get Orca at https://orca.dev`);
} else {
  found.orca = orca.out.trim().split("\n")[0];
  const repos = run("orca", ["repo", "list", "--json"]);
  if (!repos.ok) missing.push(`Orca does not answer (${why(repos, "orca") || "orca repo list failed"}) — open the Orca app`);
  const skill = run("orca", ["skills", "get", "orchestration"]);
  if (!skill.ok) missing.push(`the Orca orchestration skill is not available — run: orca skills install --skill orchestration`);
}

const auth = run("gh", ["auth", "status"]);
if (auth.absent) missing.push("gh is not installed — install the GitHub CLI: https://cli.github.com");
else if (auth.hung) missing.push(`gh did not answer within ${TIMEOUT_MS} ms — check gh, then run: gh auth status`);
else if (!auth.ok) missing.push("gh is not logged in — run: gh auth login");
else found.gh = (auth.out.match(/account (\S+)/) || [, "logged in"])[1];

if (missing.length) {
  for (const line of missing) console.log(`missing: ${line}`);
  process.exit(1);
}
console.log(`ok: orca ${found.orca}, gh ${found.gh}, node ${found.node}, git ${found.git}`);
