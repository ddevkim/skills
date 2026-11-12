#!/usr/bin/env node
/* Live sync for the hub dashboard. Copied into the hub folder; never edited there.
   Every cycle (15 s after the previous one started, never overlapping) it runs, in parallel:
   - `orca worktree ps --agent-wait` (what each worker is doing, prompt waits),
   - `orca orchestration worker-list`, `task-list`, and `inbox` for the hub's Run, so it sees workers the hub has not
     written into state.js yet and worker messages the hub has not handled yet (state.js lastMsgId),
   - every 4th cycle `gh pr view` for each open PR (CI),
   and writes live.js. dashboard.html re-reads live.js every 5 s. It writes only live.js and sync.pid; state.js stays the hub's.

   node <hub>/sync.cjs          loop (one instance per hub folder, guarded by sync.pid); it exits by itself once state.js has closed: true
   node <hub>/sync.cjs --once   one cycle, no lock */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFile } = require("child_process");

const HUB = __dirname;
const STATE = path.join(HUB, "state.js"), LIVE = path.join(HUB, "live.js"), PID = path.join(HUB, "sync.pid");
const CYCLE_MS = 15000, GH_EVERY = 4, INBOX_LIMIT = 60;
const PHASE_NUM = { red: 1, green: 2, verified: 3, "pr-open": 6, "ci-green": 7 }; // status --phase → state.js phases
const FROM_WORKERS = new Set(["status", "ask", "question", "worker_done", "escalation"]);

const oneLine = (s, n) => String(s ?? "").split("\n")[0].replace(/\s+/g, " ").trim().slice(0, n);
const flat = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const iso = ms => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null);
const arr = x => Array.isArray(x) ? x : [];

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: "utf8", timeout: 25000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) { err.stderr = stderr; return reject(err); }
      try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); }
    });
  });
}
const result = j => (j && j.result !== undefined ? j.result : j) || {};
const errLine = (what, e) => `${what}: ${oneLine(e.stderr || e.message, 120)}`;

function readState() {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(STATE, "utf8"), ctx, { timeout: 1000 });
  if (!ctx.window.HUB_STATE) throw new Error("state.js did not set window.HUB_STATE");
  return ctx.window.HUB_STATE;
}

function lastAssistantText(read) {
  const msgs = (read && read.transcript && read.transcript.messages) || [];
  const texts = msgs.filter(m => m.role === "assistant")
    .flatMap(m => (m.blocks || []).filter(b => b.type === "text" && b.text).map(b => ({ t: m.timestamp || 0, text: b.text })));
  texts.sort((a, b) => a.t - b.t);
  return texts.length ? flat(texts[texts.length - 1].text, 200) : null;
}

function ciOf(rollup) {
  let pass = 0, fail = 0, pending = 0;
  for (const c of rollup || []) {
    const st = c.__typename === "StatusContext" ? c.state : (c.status !== "COMPLETED" ? "PENDING" : c.conclusion);
    if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(st)) pass++;
    else if (!st || ["PENDING", "EXPECTED", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED"].includes(st)) pending++;
    else fail++; // FAILURE, ERROR, CANCELLED (blocks a required check), TIMED_OUT, ACTION_REQUIRED, STARTUP_FAILURE, STALE
  }
  return { ci: !(pass + fail + pending) ? "none" : fail ? "fail" : pending ? "pending" : "pass", pass, fail, pending };
}

// Item ids in state.js; a task titled "<id>: <title>" (SKILL.md, step 6) belongs to that item.
function itemOfTitle(title, ids) {
  const m = String(title || "").match(/^([A-Za-z0-9_-]+):/);
  return m && ids.has(m[1]) ? m[1] : null;
}

// Workers the hub started but has not recorded in state.js yet, from the Run's worker list.
function discover(S, workerList, taskList, ids) {
  const known = new Set(arr(S.workers).map(w => w.dispatch).filter(Boolean));
  const titleOf = new Map(arr(result(taskList).tasks).map(t => [t.id, t.title]));
  const out = {};
  for (const w of arr(result(workerList).workers)) {
    if (known.has(w.dispatchId) || ["succeeded", "failed", "stopped", "abandoned", "released"].includes(w.state)) continue;
    const item = itemOfTitle(titleOf.get(w.taskId), ids);
    if (!item || arr(S.workers).some(x => x.item === item && x.tone !== "done")) continue;
    const ws = String(w.workspace || "");
    out[item] = { dispatch: w.dispatchId, path: ws.includes("::") ? ws.slice(ws.indexOf("::") + 2) : null, state: w.state };
  }
  return out;
}

// Each item's newest "SUMMARY: <sentence>" line from its worker's status and worker_done messages (protocol rule 7):
// the card shows what the PR does so far without waiting for the hub. Uses every fetched message, handled or not.
function notes(inbox, itemOf, after) {
  const out = {};
  for (const m of arr(result(inbox).messages).filter(m => ["status", "worker_done"].includes(m.type)).sort((a, b) => a.sequence - b.sequence)) {
    const hit = /^[ \t>*\-\d.]*SUMMARY:[ \t*]*(.+)$/im.exec(String(m.body || ""));
    const item = hit && itemOf(m);
    // fresh: the hub has not handled this message yet, so its own `done` in state.js is older than this line.
    if (item) out[item] = { text: oneLine(hit[1], 200), at: m.created_at, fresh: m.sequence > after };
  }
  return out;
}

// Worker messages newer than state.js lastMsgId: what the hub has not handled yet.
function pending(S, inbox, workerList, taskList, ids, discovered) {
  const msgs = arr(result(inbox).messages).filter(m => FROM_WORKERS.has(m.type)).sort((a, b) => a.sequence - b.sequence);
  const all = arr(result(inbox).messages);
  const last = S.lastMsgId ? all.find(m => m.id === S.lastMsgId) : null;
  // lastMsgId outside the fetched window is older than all of it; an empty one means nothing was handled yet.
  const after = last ? last.sequence : -Infinity;
  const fresh = msgs.filter(m => m.sequence > after);
  const titleOf = new Map(arr(result(taskList).tasks).map(t => [t.id, t.title]));
  const itemOfDispatch = new Map([
    ...arr(S.workers).filter(w => w.dispatch).map(w => [w.dispatch, w.item]),
    ...Object.entries(discovered).map(([item, d]) => [d.dispatch, item]),
    ...arr(result(workerList).workers).map(w => [w.dispatchId, itemOfTitle(titleOf.get(w.taskId), ids)]).filter(([, i]) => i)
  ]);
  const payload = m => { try { return JSON.parse(m.payload || "{}"); } catch { return {}; } };
  const itemOf = m => { const p = payload(m); return itemOfDispatch.get(p.dispatchId) || itemOfTitle(titleOf.get(p.taskId), ids) || itemOfTitle(m.subject, ids); };
  const items = {};
  for (const m of fresh) {
    const p = payload(m);
    const item = itemOf(m);
    if (!item) continue;
    const e = items[item] || (items[item] = { count: 0 });
    e.count++;
    e.last = { type: m.type, subject: oneLine(m.subject, 100), at: m.created_at };
    if (m.type === "status" && PHASE_NUM[p.phase] && (!e.phase || PHASE_NUM[p.phase] >= PHASE_NUM[e.phase])) e.phase = p.phase;
  }
  return {
    count: fresh.length, more: !last && !!S.lastMsgId && msgs.length >= INBOX_LIMIT,
    oldestAt: fresh.length ? fresh[0].created_at : null, items, notes: notes(inbox, itemOf, after)
  };
}

async function syncWorkers(S, ps, discovered, errors) {
  const watched = [
    ...arr(S.workers).filter(w => w.tone !== "done" && w.path),
    ...Object.entries(discovered).filter(([, d]) => d.path).map(([item, d]) => ({ item, path: d.path, dispatch: d.dispatch }))
  ];
  if (!watched.length || !ps) return {};
  const byPath = new Map(arr(result(ps).worktrees).map(r => [r.path, r]));
  const out = {};
  await Promise.all(watched.map(async w => {
    const row = byPath.get(w.path);
    if (!row) return;
    const agents = row.agents || [];
    // An agent waiting on a prompt matters most, then one that is working (a worktree can hold several agents).
    const a = agents.find(x => x.agentWait) || agents.find(x => x.state === "working") || agents[0] || {};
    const entry = {
      at: iso(Math.max(a.updatedAt || 0, row.lastActivityAt || 0)),
      state: a.state || row.status || null,
      say: a.lastAssistantMessage ? flat(a.lastAssistantMessage, 200) : null,
      tool: a.toolName ? `${a.toolName}: ${oneLine(a.toolInput, 80)}`.replace(/: $/, "") : null,
      wait: a.agentWait || null
    };
    if (!["done", "idle"].includes(entry.state) && w.dispatch) { // working or waiting on a prompt: show its latest sentence
      try { entry.say = lastAssistantText(result(await run("orca", ["orchestration", "worker-read", "--dispatch", w.dispatch, "--limit", "8", "--json"]))) || entry.say; }
      catch (e) { errors.push(errLine(`orca worker-read ${w.item}`, e)); }
    }
    out[w.item] = entry;
  }));
  return out;
}

async function syncPrs(S, errors) {
  const items = arr(S.lanes).flatMap(l => arr(l.items)).filter(i => i.pr && i.status !== "merged");
  const out = {};
  await Promise.all(items.map(async i => {
    try {
      const args = ["pr", "view", String(i.pr)];
      const repo = i.repo || S.repo; // an item may live in another repo than the hub's
      if (repo) args.push("--repo", repo);
      args.push("--json", "state,statusCheckRollup,mergeStateStatus,reviewDecision,headRefOid");
      const p = await run("gh", args);
      out[i.pr] = { state: p.state, merge: p.mergeStateStatus, review: p.reviewDecision || null, head: p.headRefOid, ...ciOf(p.statusCheckRollup) };
    } catch (e) { errors.push(errLine(`gh pr view ${i.pr}`, e)); }
  }));
  return out;
}

function writeLive(live) {
  const tmp = `${LIVE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `window.HUB_LIVE = ${JSON.stringify(live, null, 1)};\n`);
  fs.renameSync(tmp, LIVE); // atomic: the page never reads half a file
}

let prev = { workers: {}, prs: {}, discovered: {}, hub: null }, cycle = 0;
async function syncOnce(withGh) {
  const started = Date.now(), errors = [];
  let S;
  try { S = readState(); }
  catch (e) { errors.push(`state.js: ${oneLine(e.message, 120)}`); writeLive({ at: new Date().toISOString(), ...prev, errors }); return null; }
  const ids = new Set(arr(S.lanes).flatMap(l => arr(l.items)).map(i => i.id));
  const soft = (what, p) => p.catch(e => { errors.push(errLine(what, e)); return null; });
  const runArgs = S.runId ? ["--run", S.runId, "--json"] : null;
  const [ps, workerList, taskList, inbox, prs] = await Promise.all([
    soft("orca worktree ps", run("orca", ["worktree", "ps", "--agent-wait", "--json", "--limit", "200"])),
    runArgs ? soft("orca worker-list", run("orca", ["orchestration", "worker-list", ...runArgs])) : null,
    runArgs ? soft("orca task-list", run("orca", ["orchestration", "task-list", ...runArgs])) : null,
    S.runId ? soft("orca inbox", run("orca", ["orchestration", "inbox", "--terminal", `run:${S.runId}`, "--limit", String(INBOX_LIMIT), "--json", "--full"])) : null,
    withGh ? syncPrs(S, errors) : Promise.resolve(prev.prs)
  ]);
  const discovered = workerList && taskList ? discover(S, workerList, taskList, ids) : prev.discovered;
  const workers = await syncWorkers(S, ps, discovered, errors);
  const hub = inbox ? pending(S, inbox, workerList, taskList, ids, discovered) : prev.hub;
  prev = { workers: ps ? workers : prev.workers, prs, discovered, hub };
  writeLive({ at: new Date().toISOString(), cycleMs: Date.now() - started, ...prev, errors });
  return S;
}

function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } }

if (process.argv.includes("--once")) {
  syncOnce(true).then(() => process.exit(0));
} else {
  const other = fs.existsSync(PID) ? Number(fs.readFileSync(PID, "utf8").trim()) : 0;
  if (other && other !== process.pid && alive(other)) {
    console.log(`sync already running (pid ${other})`);
    process.exit(0);
  }
  fs.writeFileSync(PID, String(process.pid));
  const stop = () => { try { if (fs.readFileSync(PID, "utf8").trim() === String(process.pid)) fs.unlinkSync(PID); } catch {} process.exit(0); };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  // One cycle at a time: the next starts CYCLE_MS after this one started, or right away when it ran longer.
  const loop = async () => {
    const t = Date.now();
    if (!fs.existsSync(STATE)) stop(); // hub folder removed
    let S = null;
    try { S = await syncOnce(cycle++ % GH_EVERY === 0); } catch (e) { console.error(new Date().toISOString(), e); }
    if (S && S.closed) stop(); // the hub set closed: true after the final sweep
    setTimeout(loop, Math.max(0, CYCLE_MS - (Date.now() - t)));
  };
  loop();
}
