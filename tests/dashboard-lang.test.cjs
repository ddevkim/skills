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
      item("A9", "active", { walkPending: true, after: ["A1"] }), item("A10", "active", { reviewPending: true }),
      item("A11", "active"), item("A12", "review"), item("A13", "pr", { pr: 8 })
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
    A5: { state: "working", at: ago(3), wait: "Allow push?" }, A6: { state: "idle", at: ago(0.5), wait: { source: "hook" } },
    A11: { state: "idle", at: ago(70) }, A12: { state: "working", at: ago(35) }
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

test("every label with a count or an age renders in the sample", async () => {
  const en = visible(await renderVariant(current(), VARIANTS.full, "en"));
  for (const s of ["CI failed: 2", "Same step for 35 min", "Worker stopped 70 min", "1 h 10 min ago"]) assert.ok(en.includes(s), s);
  const ko = visible(await renderVariant(current(), VARIANTS.full, undefined));
  for (const s of ["CI 실패 2건", "같은 단계 35분째", "작업자 멈춤 70분", "1시간 10분 전"]) assert.ok(ko.includes(s), s);
});

test("C5 the static <title> shown before the first render has no Korean", () => {
  const title = current().match(/<title>([^<]*)<\/title>/)[1];
  assert.ok(!HANGUL.test(title), `static title: ${title}`);
});

// The Korean render of every variant, frozen from the template at BASE_SHA ("as today"). To change it on purpose:
//   KO_FIXTURE_FROM=<git ref> node --test tests/dashboard-lang.test.cjs   (renders that ref's template and rewrites the file)
const FIXTURE = path.join(__dirname, "fixtures", "dashboard-ko.json");
test("P7 Korean render (lang absent or ko) equals the frozen render of the base template", async () => {
  if (process.env.KO_FIXTURE_FROM) {
    const base = execFileSync("git", ["show", `${process.env.KO_FIXTURE_FROM}:${REL}`], { cwd: ROOT, encoding: "utf8" });
    const out = {};
    for (const [name, v] of Object.entries(VARIANTS)) out[name] = visible(await renderVariant(base, v, undefined));
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
    fs.writeFileSync(FIXTURE, JSON.stringify(out, null, 1) + "\n");
  }
  assert.ok(fs.existsSync(FIXTURE), `missing ${FIXTURE}`);
  const frozen = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  assert.deepStrictEqual(Object.keys(frozen).sort(), Object.keys(VARIANTS).sort());
  for (const [name, v] of Object.entries(VARIANTS)) {
    const before = frozen[name];
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

// P8 / C11: the to-do list follows state.js `autonomy` ("low" | "medium" | "high"; absent or unknown = "low").
const AUTO = {
  title: "Auto", owner: "Dev", updatedAt: "2026-11-13 11:50", baseSha: "a1b2c3d", workerCap: 2, ask: "", summary: ["One fact."],
  needs: ["Log in to the staging DB."], refs: [], log: [],
  workers: [{ lane: "b", item: "P1", worktree: "wt-p1", state: "coding", tone: "active" }],
  lanes: [{ name: "b", countsAsPr: true, items: [
    item("P1", "active"), item("W1", "walk", { walkthrough: "W1-w1", phases: 4 }),
    item("R1", "ready", { base: "main", pr: 9, prUrl: "https://github.com/o/r/pull/9", phases: 7, walkthrough: "R1-w1" }),
    item("B1", "blocked", { ext: "needs a key" }),
    // Guards: never merge to-dos at any level (stacked, walkthrough or review missing); shown exactly as at low.
    item("R2", "ready", { pr: 10, phases: 7 }), item("R3", "ready", { base: "main", pr: 11, phases: 7, walkPending: true }),
    item("R4", "ready", { base: "main", pr: 12, phases: 7, reviewPending: true })] },
    { name: "other", countsAsPr: false, items: [item("X1", "blocked", { ext: "their PR is red" })] }],
  decisions: [{ id: "Q1", status: "open", text: "Default off?", options: ["off", "on"], recommend: "off" },
    { id: "H1", status: "answered", by: "hub", text: "Label wording?", answer: "short" },
    { id: "D1", status: "answered", text: "Who merges?", answer: "dev" },
    { id: "Q2", status: "watching", text: "Checking it." }]
};
const AUTO_LIVE = { at: ago(0.2), workers: { P1: { state: "working", at: ago(1), wait: "Allow push?" } } };
const LEVELS = ["low", "medium", "high"];
const renderAuto = (autonomy, lang, s = AUTO) =>
  render(current(), { states: [{ ...s, lang, ...(autonomy === undefined ? {} : { autonomy }) }], live: AUTO_LIVE });
// Each to-do row as "<kind> <item id or ->".
const todoRows = html => [...((html.match(/<ol class="todo">([\s\S]*?)<\/ol>/) || [])[1] || "").matchAll(/<li><span class="pill bad">([^<]*)<\/span> ([\s\S]*?)<div class="how">/g)]
  .map(m => `${m[1]} ${(m[2].match(/#i-([\w-]+)/) || [])[1] || "-"}`);
// A card's classes, then the tone and label of its status pill.
const card = (html, id) => { const m = html.match(new RegExp(`<div class="(node[^"]*)" id="i-${id}">[\\s\\S]*?<div class="pills"><span class="pill (\\w+)">([^<]*)</span>`)); return m && m.slice(1); };
const stageCls = (html, label) => (html.match(new RegExp(`<div class="stage ([^"]*)"><div class="n">\\d+</div><div class="lbl">${label}<`)) || [])[1];

test("C11 the to-do list holds exactly what each level leaves to the developer", async () => {
  for (const lang of ["ko", "en"]) {
    const t = (await renderAuto("low", lang)).table[lang];
    const want = {
      low: [`${t.kWait} P1`, `${t.kNeed} -`, `${t.kDec} -`, `${t.kWalk} W1`, `${t.kMerge} R1`, `${t.kBlocked} B1`, `${t.kBlocked} X1`],
      medium: [`${t.kWait} P1`, `${t.kNeed} -`, `${t.kDec} -`, `${t.kMerge} R1`, `${t.kBlocked} B1`, `${t.kBlocked} X1`],
      high: [`${t.kWait} P1`, `${t.kNeed} -`, `${t.kDec} -`, `${t.kBlocked} B1`, `${t.kBlocked} X1`]
    };
    for (const level of LEVELS) {
      const r = await renderAuto(level, lang);
      assert.deepStrictEqual(todoRows(r.html), want[level], `${lang} ${level}: rows`);
      assert.strictEqual(r.html.match(/<h1>([\s\S]*?)<\/h1>/)[1], t.headTodo("Auto", "Dev", want[level].length), `${lang} ${level}: headline`);
      if (lang === "en") assert.ok(!HANGUL.test(visible(r)), `${level}: Korean in English render`);
    }
  }
});

test("P8 absent, low, and unknown autonomy render the same", async () => {
  for (const lang of ["ko", "en"]) {
    const base = visible(await renderAuto(undefined, lang));
    for (const a of ["low", "max", 3]) assert.strictEqual(visible(await renderAuto(a, lang)), base, `${lang} autonomy ${a}`);
    for (const [name, v] of Object.entries(VARIANTS))
      assert.strictEqual(visible(await renderVariant(current(), { ...v, states: v.states.map(s => s && { ...s, autonomy: "low" }) }, lang)),
        visible(await renderVariant(current(), v, lang)), `${lang} ${name}`);
  }
});

test("C11 a card the hub carries on does not ask the developer to act", async () => {
  for (const lang of ["ko", "en"]) {
    const low = (await renderAuto("low", lang)), t = low.table[lang];
    assert.ok(t.hubGoes, "hubGoes label exists");
    assert.deepStrictEqual(card(low.html, "W1"), ["node s-walk", "bad", t.st.walk]);
    assert.deepStrictEqual(card(low.html, "R1"), ["node s-ready s-you", "bad", t.waitsMerge]);
    assert.strictEqual(stageCls(low.html, t.stage.walk), "you");
    const med = (await renderAuto("medium", lang)).html, high = (await renderAuto("high", lang)).html;
    assert.deepStrictEqual(card(med, "W1"), ["node s-hub", "clay", t.hubGoes], `${lang} medium walk`);
    assert.deepStrictEqual(card(med, "R1"), ["node s-ready s-you", "bad", t.waitsMerge], `${lang} medium ready`);
    assert.strictEqual(stageCls(med, t.stage.walk), "", `${lang} medium stage`);
    assert.deepStrictEqual(card(high, "W1"), ["node s-hub", "clay", t.hubGoes], `${lang} high walk`);
    assert.deepStrictEqual(card(high, "R1"), ["node s-hub", "clay", t.hubGoes], `${lang} high ready`);
    assert.strictEqual(stageCls(high, t.stage.ready), "", `${lang} high ready stage`);
    for (const id of ["R2", "R3", "R4", "X1"]) for (const html of [med, high]) assert.deepStrictEqual(card(html, id), card(low.html, id), `${lang} ${id} as at low`);
  }
});

test("C11 the header names the level at medium and high only", async () => {
  for (const lang of ["ko", "en"]) {
    const t = (await renderAuto("low", lang)).table[lang];
    assert.ok(t.level && t.levelTip, "level labels exist");
    const meta = async a => (await renderAuto(a, lang)).html.match(/<div class="meta">([\s\S]*?)<\/div>/)[1];
    for (const level of ["medium", "high"])
      assert.ok((await meta(level)).includes(` · <span title="${t.levelTip[level]}">${t.level[level]}</span>`), `${lang} ${level}`);
    const low = (await renderAuto("low", lang)).html;
    for (const level of ["medium", "high"]) assert.ok(!low.includes(t.level[level]) && !low.includes(t.levelTip[level]), `${lang} low shows ${level}`);
  }
});

test("C11 decisions the hub took alone are listed under their own heading", async () => {
  for (const lang of ["ko", "en"]) {
    const t = (await renderAuto("low", lang)).table[lang];
    assert.ok(t.hubDecH && t.hubDecLine, "hub decision labels exist");
    for (const level of LEVELS) {
      const html = (await renderAuto(level, lang)).html;
      const h = html.indexOf(`<h3>${t.hubDecH}</h3>`), hub = html.indexOf("Label wording? → <b>short</b>"), dev = html.indexOf("Who merges?");
      assert.ok(h > 0 && h < hub && hub < dev, `${lang} ${level}: heading, hub decision, then the developer's`);
      assert.strictEqual(html.split("Label wording?").length, 2, `${lang} ${level}: listed once`);
      const line = `<a href="#decided">${t.hubDecLine(1)}</a>`;
      assert.strictEqual(html.includes(line), level === "high", `${lang} ${level}: count line`);
      if (level === "high") assert.ok(html.includes('<div class="card" id="decided">'), `${lang}: the line's target`);
    }
    const none = { ...AUTO, decisions: AUTO.decisions.filter(d => d.by !== "hub") };
    const html = (await renderAuto("high", lang, none)).html;
    assert.ok(!html.includes(t.hubDecH), `${lang}: heading without hub decisions`);
    assert.ok(!html.includes('href="#decided"'), `${lang}: count line without hub decisions`);
    // Under the developer's heading only what they answered; a watching row makes no claim about who decided.
    const full = (await renderAuto("high", lang)).html, mine = full.indexOf(`<h3>${t.yourDecH("Dev")}</h3>`);
    const mineList = full.slice(mine, full.indexOf("</ul>", mine));
    assert.ok(mine > 0 && mineList.includes("Who merges?") && !mineList.includes("Checking it."), `${lang}: developer heading holds only their answers`);
    assert.ok(full.indexOf("Checking it.") > mine, `${lang}: the watching row still renders`);
    const hubOnly = (await renderAuto("high", lang, { ...AUTO, decisions: AUTO.decisions.filter(d => d.by === "hub" || d.status === "open") })).html;
    assert.ok(!hubOnly.includes(t.yourDecH("Dev")) && !hubOnly.includes(t.decidedNone), `${lang}: nothing under an empty developer heading`);
  }
});

test("C11 the template state.js starts at low and shows a decision the hub took alone", () => {
  const src = fs.readFileSync(path.join(ROOT, "skills/orca-hub/templates/state.js"), "utf8");
  const ctx = {}; ctx.window = ctx;
  vm.runInNewContext(src, ctx);
  assert.strictEqual(ctx.HUB_STATE.autonomy, "low");
  assert.match(src, /\/\/.*by: "hub", status: "answered"/, "a commented example decision with by: \"hub\"");
});

// C12: one bar on top: checkpoints reached over 8 per PR of the lanes with countsAsPr, floored; merged counts 8.
const PROG = { ...AUTO, needs: [], decisions: [], workers: [] };
const renderProg = (items, lang = "ko") =>
  render(current(), { states: [{ ...PROG, lang, lanes: [{ name: "b", countsAsPr: true, items }, { name: "o", countsAsPr: false, items: [item("O1", "merged", { phases: 8 })] }] }], live: undefined });
const prog = html => {
  const m = html.match(/<div class="prog" role="progressbar" aria-valuenow="(\d+)" aria-valuemin="0" aria-valuemax="100" aria-label="([^"]*)" aria-valuetext="([^"]*)" title="([^"]*)">[\s\S]*?class="prog-done" style="width:([\d.]+)%"[\s\S]*?class="prog-move" style="width:([\d.]+)%"[\s\S]*?<span class="prog-text">([\s\S]*?)<\/span><\/div>/);
  assert.ok(m, "the progressbar markup is on the page");
  return { now: +m[1], label: m[2], valuetext: m[3], title: m[4], green: +m[5], clay: +m[6], text: m[7] };
};
const merged = n => Array.from({ length: n }, (_, k) => item(`M${k}`, "merged", { phases: k % 2 ? 8 : 3 }));

test("C12 the bar is the page's first element and counts checkpoints of the owner's PRs", async () => {
  // 0 + 3 + 6 + merged (8, whatever phases says) = 17 of 32 = 53.1 %; the countsAsPr: false lane is ignored.
  const mixed = [item("A", "todo", { phases: 0 }), item("B", "active", { phases: 3 }), item("C", "pr", { phases: 6 }), item("D", "merged", { phases: 2 })];
  for (const lang of ["ko", "en"]) {
    const r = await renderProg(mixed, lang), t = r.table[lang], p = prog(r.html);
    assert.ok(r.html.trimStart().startsWith('<div class="prog"'), `${lang}: bar comes first`);
    assert.strictEqual(p.now, 53);
    assert.strictEqual(p.label, t.progLabel);
    assert.strictEqual(p.text, `<b>53%</b> · ${t.progMerged(1, 4)}`);
    assert.strictEqual(p.title, t.progMerged(1, 4));
    assert.ok(Math.abs(p.green - 25) < 0.01 && Math.abs(p.clay - 28.125) < 0.01, `${lang}: green merged share, clay the rest`);
  }
  const { table } = await renderProg(mixed);
  assert.deepStrictEqual([table.ko.progMerged(1, 4), table.en.progMerged(1, 4)], ["병합 1/4", "Merged 1/4"]);
});

test("C12 phases above 8 or below 0 are clamped", async () => {
  assert.strictEqual(prog((await renderProg([item("A", "active", { phases: 12 }), item("B", "todo", { phases: -3 })])).html).now, 50);
});

test("C12 the bar floors: 99.5 % shows 99, and 100 only when every PR is merged", async () => {
  assert.strictEqual(prog((await renderProg([...merged(24), item("Z", "ready", { phases: 7 })])).html).now, 99);
  for (const lang of ["ko", "en"]) {
    const r = await renderProg(merged(3), lang), t = r.table[lang], p = prog(r.html);
    assert.strictEqual(p.now, 100);
    assert.ok(Math.abs(p.green - 100) < 0.01 && p.clay < 0.01, `${lang}: all green`);
    // The headline already says every PR is merged, so the bar shows the percentage alone and keeps the count in its title.
    assert.ok(r.html.includes(t.headAllMerged(PROG.title, 3)), `${lang}: headline carries the count`);
    assert.strictEqual(p.text, "<b>100%</b>");
    assert.strictEqual(p.title, t.progMerged(3, 3));
  }
});

test("C12 no countable PR, no bar", async () => {
  for (const items of [[], undefined]) {
    const lanes = [{ name: "o", countsAsPr: false, items: [item("O1", "active", { phases: 4 })] }, ...(items ? [{ name: "b", countsAsPr: true, items }] : [])];
    const html = (await render(current(), { states: [{ ...PROG, lanes }], live: undefined })).html;
    assert.ok(!html.includes('role="progressbar"') && !html.includes("NaN"), "no bar");
  }
  assert.strictEqual(prog((await renderProg([item("A", "todo", { phases: 0 })])).html).now, 0, "one countable PR at 0 still has its bar");
});

test("C12 a missing or non-numeric phases counts as 0, never NaN", async () => {
  // 0 + 0 + 4 = 4 of 24 = 16.7 %.
  const html = (await renderProg([item("A", "active", { phases: undefined }), item("B", "active", { phases: "x" }), item("C", "active", { phases: 4 })])).html;
  const p = prog(html);
  assert.strictEqual(p.now, 16);
  assert.ok(!html.includes("NaN"), "no NaN anywhere");
  assert.ok(Math.abs(p.clay - 100 / 6) < 0.01 && p.green === 0, "widths are numbers");
});

test("C12 aria-valuetext says what the visible label says, with the merged count", async () => {
  for (const lang of ["ko", "en"]) {
    const t = (await renderProg([item("A", "active", { phases: 4 }), item("B", "merged")], lang)).table[lang];
    const p = prog((await renderProg([item("A", "active", { phases: 4 }), item("B", "merged")], lang)).html);
    assert.strictEqual(p.valuetext, `75% · ${t.progMerged(1, 2)}`, `${lang}: partial`);
    const all = prog((await renderProg(merged(2), lang)).html);
    assert.strictEqual(all.valuetext, `100% · ${t.progMerged(2, 2)}`, `${lang}: all merged keeps the count for screen readers`);
  }
});

test("C11 watching decisions sit under their own heading, and an empty answer draws no arrow", async () => {
  for (const lang of ["ko", "en"]) {
    const s = { ...AUTO, decisions: [...AUTO.decisions, { id: "H2", status: "answered", by: "hub", text: "Blank?", answer: "" }] };
    const r = await renderAuto("high", lang, s), t = r.table[lang], html = r.html;
    assert.ok(t.watchDecH, "watching heading label exists");
    const h = html.indexOf(`<h3>${t.watchDecH}</h3>`);
    assert.ok(h > 0 && h < html.indexOf("Checking it."), `${lang}: heading above the watching row`);
    const li = html.slice(html.indexOf("Blank?"), html.indexOf("</li>", html.indexOf("Blank?")));
    assert.ok(!li.includes("→"), `${lang}: no dangling arrow: ${li}`);
    const noWatch = (await renderAuto("high", lang, { ...AUTO, decisions: AUTO.decisions.filter(d => d.status !== "watching") })).html;
    assert.ok(!noWatch.includes(t.watchDecH), `${lang}: no heading without watching rows`);
  }
});
