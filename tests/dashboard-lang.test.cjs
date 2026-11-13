// dashboard.html renders its own labels in the language state.js names (lang: "ko" | "en", Korean by default).
// The page script runs in node:vm with a minimal document stub; no browser, no files written.
const test = require("node:test");
const assert = require("node:assert");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const REL = "skills/orca-hub/templates/dashboard.html";
const BASE_SHA = "959bd4e"; // the template before this feature: "as today"
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;
const NOW = Date.parse("2026-11-13T12:00:00Z");
const ago = min => new Date(NOW - min * 60000).toISOString();

const current = () => fs.readFileSync(path.join(ROOT, REL), "utf8");
const scriptOf = html => html.match(/<script>([\s\S]*?)<\/script>/)[1];

// Runs the page script. states: what state.js assigns on each tick (undefined = file missing).
async function render(html, { states, live, ticks = states.length }) {
  const app = { innerHTML: "" };
  let tickFn = null, n = 0;
  const ctx = { console, queueMicrotask, setInterval: fn => { tickFn = fn; } };
  ctx.window = ctx;
  ctx.document = {
    title: "", documentElement: { lang: "ko" }, getElementById: () => app, createElement: () => ({ remove() {} }),
    head: { appendChild(el) {
      const file = el.src.split("?")[0];
      const v = file === "state.js" ? states[Math.min(n++, states.length - 1)] : live;
      const g = file === "state.js" ? "HUB_STATE" : "HUB_LIVE";
      queueMicrotask(() => { if (v === undefined) return el.onerror(); ctx[g] = structuredClone(v); el.onload(); });
    } }
  };
  vm.createContext(ctx);
  vm.runInContext(`Date.now = () => ${NOW};`, ctx);
  vm.runInContext(scriptOf(html) + "\n;globalThis.__L10N = typeof L10N === 'undefined' ? undefined : L10N;", ctx);
  const settle = async () => { for (let k = 0; k < 20; k++) await new Promise(r => setImmediate(r)); };
  await settle();
  for (let k = 1; k < ticks; k++) { tickFn(); await settle(); }
  return { html: app.innerHTML, title: ctx.document.title, lang: ctx.document.documentElement.lang, table: ctx.__L10N };
}

// Sample hub data is ASCII, so any Hangul in an English render came from the template.
const item = (id, status, more = {}) => ({ id, title: `Title ${id}`, status, phases: 2, base: "feat/x", ...more });
const SAMPLE = {
  title: "Notify", owner: "Dev", updatedAt: "2026-11-13 11:50", baseSha: "a1b2c3d", workerCap: 2, flowSummary: "base then ui",
  ask: "Approve A6 first.", needs: [{ text: "Put the secret in A2's terminal." }, "Log in to the staging DB."],
  summary: ["One fact."], refs: [{ label: "Rules", href: "https://example.com/rules" }],
  workers: [{ lane: "base", item: "A2", worktree: "wt-a2", state: "coding", tone: "active" },
    { lane: "base", item: "A6", worktree: "wt-a6", state: "waiting", tone: "support" },
    { lane: "base", item: "A7", worktree: "wt-a7", state: "gone", tone: "done" }],
  lanes: [
    { name: "other", countsAsPr: false, items: [item("X1", "blocked", { ext: "their PR is red" })] },
    { name: "base", countsAsPr: true, items: [
      item("A1", "todo", { phases: 0 }), item("A2", "active", { done: "Did a thing.", risk: ["migration"], waiting: "Q1 answer" }),
      item("A3", "review", { reviewPending: false, walkthrough: "A3-w1" }), item("A4", "walk", { walkthrough: "A4-w1", phases: 4 }),
      item("A5", "pr", { pr: 5, prUrl: "https://github.com/o/r/pull/5", phases: 6 }),
      item("A6", "ready", { base: "main", pr: 6, prUrl: "https://github.com/o/r/pull/6", phases: 7, walkthrough: "A6-w2", walkApproved: "A6-w1" }),
      item("A7", "merged", { pr: 7, phases: 8, mergeSha: "abcdef1234" }), item("A8", "blocked", { ext: "needs a key" }),
      item("A9", "active", { walkPending: true, after: ["A1"] }), item("A10", "active", { reviewPending: true })
    ] }
  ],
  decisions: [{ id: "Q1", status: "open", text: "Default off?", options: ["off", "on"], recommend: "off", items: ["A2"] },
    { id: "Q2", status: "watching", text: "Checking." }, { id: "Q3", status: "answered", text: "Who merges?", answer: "hub" }],
  log: ["11:50 started"]
};
const LIVE = {
  at: ago(200), errors: ["gh failed"], discovered: { A1: { path: "/w/wt-a1" } },
  workers: {
    A1: { state: "idle", at: ago(1) }, A2: { state: "idle", at: ago(10), tool: "Bash: ls", say: "Looking." },
    A3: { state: "working", at: ago(45) }, A4: { state: "working", at: ago(2), wait: { source: "hook", since: NOW - 7 * 60000 }, tool: "Bash: rm x" },
    A5: { state: "working", at: ago(3), wait: "Allow push?" }, A6: { state: "idle", at: ago(0.5), wait: { source: "hook" } }
  },
  prs: { 5: { ci: "pending", pass: 1, fail: 0, pending: 2 }, 6: { ci: "pass" }, 8: { ci: "fail", fail: 2 } },
  hub: { count: 3, more: true, oldestAt: ago(20), items: { A9: { phase: "verified" }, A10: { last: { type: "worker_done" } }, A3: { last: { type: "escalation" } } },
    notes: { A2: { text: "Newer summary.", fresh: true } } }
};
const withLang = (s, lang) => lang === undefined ? s : { ...s, lang };
const VARIANTS = {
  full: { states: [SAMPLE], live: LIVE },
  closed: { states: [{ ...SAMPLE, closed: true, decisions: [] }], live: LIVE },
  calm: { states: [{ ...SAMPLE, ask: "", needs: [], decisions: [], lanes: [{ name: "b", countsAsPr: true, items: [item("C1", "todo")] }] }], live: { at: ago(0.2) } },
  allMerged: { states: [{ ...SAMPLE, ask: "", needs: [], decisions: [], lanes: [{ name: "b", countsAsPr: true, items: [item("M1", "merged", { pr: 1 })] }] }], live: undefined },
  broken: { states: [SAMPLE, null], live: { ...LIVE, at: ago(1) } }
};
const renderVariant = (html, v, lang) => render(html, { ...v, states: v.states.map(s => s && withLang(s, lang)) });
const visible = r => r.html + "\n" + r.title;

test("C5 English render has no Hangul in any variant", async () => {
  for (const [name, v] of Object.entries(VARIANTS)) {
    const r = await renderVariant(current(), v, "en");
    const hit = visible(r).match(new RegExp(`.{0,40}${HANGUL.source}.{0,40}`));
    assert.ok(!hit, `${name}: Korean in English render: ${hit && hit[0]}`);
    assert.strictEqual(r.lang, "en", `${name}: <html lang>`);
  }
});

test("P7 Korean render (lang absent or ko) equals the template at the base commit", async () => {
  const base = execFileSync("git", ["show", `${BASE_SHA}:${REL}`], { cwd: ROOT, encoding: "utf8" });
  for (const [name, v] of Object.entries(VARIANTS)) {
    const before = visible(await renderVariant(base, v, undefined));
    assert.strictEqual(visible(await renderVariant(current(), v, undefined)), before, `${name}: lang absent`);
    const ko = await renderVariant(current(), v, "ko");
    assert.strictEqual(visible(ko), before, `${name}: lang ko`);
    assert.strictEqual(ko.lang, "ko");
  }
});

test("Q2 an unknown lang renders in Korean", async () => {
  const ko = await renderVariant(current(), VARIANTS.full, "ko");
  const fr = await renderVariant(current(), VARIANTS.full, "fr");
  assert.strictEqual(visible(fr), visible(ko));
  assert.strictEqual(fr.lang, "ko");
});

test("N2 the ko and en tables have the same keys", async () => {
  const { table } = await renderVariant(current(), VARIANTS.full, "en");
  assert.ok(table && table.ko && table.en, "L10N = { ko, en } exists");
  const keys = o => Object.keys(o).sort();
  assert.deepStrictEqual(keys(table.en), keys(table.ko));
  for (const k of keys(table.ko)) {
    assert.strictEqual(typeof table.en[k], typeof table.ko[k], `type of ${k}`);
    if (typeof table.ko[k] === "object") assert.deepStrictEqual(keys(table.en[k]), keys(table.ko[k]), `keys of ${k}`);
  }
});

test("C5 the page script has no Korean literal outside the ko table", () => {
  const src = scriptOf(current());
  const start = src.indexOf("  ko: {"), end = src.indexOf("  en: {");
  assert.ok(start > 0 && end > start, "ko table precedes en table");
  const rest = (src.slice(0, start) + src.slice(end)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/ .*$/gm, "");
  const hit = rest.match(new RegExp(`.{0,40}${HANGUL.source}.{0,40}`));
  assert.ok(!hit, `Korean literal outside the table: ${hit && hit[0]}`);
});

test("F5 English headline counts to-dos in singular and plural", async () => {
  const base = { ...SAMPLE, lang: "en", ask: "", decisions: [], closed: false, lanes: [{ name: "b", countsAsPr: true, items: [item("H1", "todo")] }] };
  const h1 = async needs => (await render(current(), { states: [{ ...base, needs }], live: undefined })).html.match(/<h1>([\s\S]*?)<\/h1>/)[1];
  assert.strictEqual(await h1([]), "Notify: Dev has nothing to do right now");
  assert.strictEqual(await h1(["a"]), "Notify: Dev has 1 thing to do");
  assert.strictEqual(await h1(["a", "b", "c"]), "Notify: Dev has 3 things to do");
});
