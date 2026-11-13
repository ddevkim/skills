// walkthrough.html renders its own labels in the language state.js names (lang: "ko" | "en", Korean by default).
// The page script runs in node:vm with a minimal document stub, once per step; no browser, no files written.
const test = require("node:test");
const assert = require("node:assert");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const REL = "skills/hub/templates/walkthrough.html";
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;
const NOW = Date.parse("2026-11-13T12:00:00Z");

const current = () => fs.readFileSync(path.join(ROOT, REL), "utf8");
const scriptOf = html => html.match(/<script>([\s\S]*?)<\/script>/)[1];
const staticTitle = html => html.match(/<title>([^<]*)<\/title>/)[1];

// Runs the page at walkthrough.html?w=<w>#<hash>. files: { "<src>": [value per tick] } (undefined = file missing,
// null = the file loaded but assigned nothing, a syntax error). Returns what the page shows after the last tick.
async function render(html, { w, files, hash }) {
  const app = { innerHTML: "", querySelectorAll: () => [] };
  const ticks = Math.max(1, ...Object.values(files).map(v => v.length));
  let tickFn = null, n = 0;
  const ctx = { console, queueMicrotask, URLSearchParams, structuredClone, setInterval: fn => { tickFn = fn; }, addEventListener() {} };
  ctx.window = ctx;
  ctx.location = { search: w === undefined ? "" : `?w=${w}`, hash: `#${hash}` };
  const globals = { "state.js": "HUB_STATE" };
  ctx.document = {
    title: staticTitle(html), documentElement: { lang: "ko" }, addEventListener() {},
    getElementById: k => k === "app" ? app : k === "prev" || k === "next" ? {} : null,
    createElement: () => ({ remove() {} }),
    head: { appendChild(el) {
      const file = el.src.split("?")[0];
      const seq = files[file] || [undefined];
      const v = seq[Math.min(n, seq.length - 1)];
      const g = globals[file] || (file.endsWith(".diff.js") ? "HUB_DIFF" : "HUB_WALK");
      queueMicrotask(() => { if (v === undefined) return el.onerror(); if (v !== null) ctx[g] = structuredClone(v); el.onload(); });
    } }
  };
  vm.createContext(ctx);
  vm.runInContext(`Date.now = () => ${NOW};`, ctx);
  vm.runInContext(scriptOf(html) + "\n;globalThis.__L10N = typeof L10N === 'undefined' ? undefined : L10N;", ctx);
  const settle = async () => { for (let k = 0; k < 20; k++) await new Promise(r => setImmediate(r)); };
  await settle();
  for (n = 1; n < ticks; n++) { tickFn(); await settle(); }
  return { html: app.innerHTML, title: ctx.document.title, lang: ctx.document.documentElement.lang, table: ctx.__L10N };
}

// Sample data is ASCII, so any Hangul in an English render came from the template.
const ID = "A4-w2";
const FULL = {
  item: "A4", round: 2, title: "Night hours are detected", owner: "Dev", worker: "Worker A4", date: "2026-11-13",
  head: "abc1234", base: "main", baseSha: "a1b2c3d", branch: "feat/night", kind: "behaviour", afterApproval: false,
  changes: [{ what: "Renamed a helper", why: "clearer", file: "src/night.js", line: 3 }, { what: "Dropped old file", why: "unused", file: "src/old.js", removed: true }, "A plain note"],
  purpose: { why: "Nights need a rate.", after: "Ops can set it.", spec: [{ id: "C1", text: "Night is 22-06." }], notHere: [{ item: "A5", what: "UI" }] },
  map: { layers: ["service", "store"], nodes: [{ id: "night", label: "night check", layer: "service", file: "src/night.js", state: "new" },
    { id: "rate", label: "rate table", layer: "store", state: "changed" }, { id: "db", label: "db", layer: "store", state: "existing" }],
    links: [{ from: "night", to: "rate", label: "reads" }, { from: "rate", to: "db" }] },
  flow: [{ title: "Checks the hour", file: "src/night.js", line: 1, code: "const h = d.getHours();\nreturn h >= 22;", note: "Local time." },
    { title: "Reads the rate", file: "src/rate.js", line: 4 }],
  edges: [{ name: "Midnight", steps: [{ title: "Wraps", file: "src/night.js", line: 2 }] }],
  design: [{ decision: "Hours in config", why: "Ops change them", rejected: "Hard code: needs deploy", rule: "docs/rules.md" }],
  data: [{ table: "rates", column: "night", stores: "the rate", safe: "nullable" }],
  tests: [{ spec: "C1", test: "night at 23", file: "test/night.test.js", line: 5, asserts: "true", red: "false !== true" }],
  injections: [{ broke: "returned false", red: ["night at 23", "night at 2"] }],
  verify: { command: "npm test", summary: "12 pass" },
  risks: [{ area: "money", guard: "rate capped" }], unverified: ["DST days"], followups: ["Holiday rates"],
  files: [{ path: "src/night.js", added: 10, removed: 2, role: "check" }, { path: "src/old.js", added: 0, removed: 5, role: "gone" }],
  qa: [{ q: "Why 22?", a: "Law.", refs: ["src/night.js:1"] }],
  review: [{ round: 1, verdict: "CHANGES", head: "abc0000", findings: [{ level: "blocking", file: "src/night.js", line: 2, what: "Off by one", fix: "Fixed" }, { level: "note", what: "Name it" }] },
    { round: 2, verdict: "PASS", head: "abc1234", findings: [] }]
};
const DIFF = { head: "abc1234", base: "main", files: [{ path: "src/night.js", lines: ["@@ -1,2 +1,3 @@", " a", "-b", "+c", "+d", "\\ No newline at end of file"] }] };
const EMPTY = { item: "A4", round: 1, title: "Empty", owner: "Dev", worker: "W", date: "d", head: "abc1234", base: "main", baseSha: "a1b2c3d", branch: "b",
  map: {}, flow: [], files: [{ path: "src/x.bin", added: 0, removed: 0, role: "blob" }], purpose: {}, verify: {} };
const lane = (status, more = {}) => ({ title: "Night", lanes: [{ name: "base", items: [{ id: "A3", title: "Before", status: "merged", walkthrough: "A3-w1" },
  { id: "A4", title: "This", status, pr: 5, prUrl: "https://github.com/o/r/pull/5", ...more }, { id: "A5", title: "After", status: "todo" }] }] });
const at = (walk, diff, state, w = ID) => ({ w, files: { [`walkthroughs/${w}.js`]: walk, [`walkthroughs/${w}.diff.js`]: diff, "state.js": state } });
const VARIANTS = {
  walk: at([FULL], [DIFF], [lane("walk", { walkthrough: ID })]),
  walkNoPr: at([FULL], [DIFF], [lane("walk", { pr: undefined, walkthrough: ID })]),
  approved: at([{ ...FULL, afterApproval: true }], [DIFF], [lane("merged", { walkApproved: ID, walkthrough: "A4-w3" })]),
  approvedOpen: at([{ ...FULL, review: [...FULL.review].reverse() }], [DIFF], [lane("pr", { walkApproved: ID, walkthrough: ID })]),
  afterOpen: at([{ ...FULL, afterApproval: true }], [DIFF], [lane("pr", { walkthrough: ID })]),
  afterMerged: at([{ ...FULL, afterApproval: true }], [DIFF], [lane("merged", { walkthrough: ID })]),
  older: at([FULL], [DIFF], [lane("review", { walkthrough: "A4-w3" })]),
  noState: at([FULL], [{ ...DIFF, files: [{ path: "src/night.js", omitted: 900 }] }], [undefined]),
  empty: at([EMPTY], [{ head: "abc1234", files: [{ path: "src/x.bin", note: "binary" }] }], [lane("active")]),
  mode: at([EMPTY], [{ head: "abc1234", files: [{ path: "src/x.bin", note: "mode" }] }], [lane("active")]),
  noDiffYet: at([EMPTY], [undefined], [lane("active")]),
  oldFormat: at([{ ...EMPTY, map: undefined }], [undefined], [lane("active")]),
  broken: at([FULL, null], [DIFF], [lane("review", { walkthrough: ID })]),
  noParam: { w: undefined, files: { "state.js": [lane("active")] } },
  missing: at([undefined], [undefined], [lane("active")])
};
const withLang = (s, lang) => lang === undefined ? s : { ...(s || {}), lang };
// Every step of a variant, joined: what the developer can see on the page.
async function show(html, v, lang) {
  const files = { ...v.files, "state.js": v.files["state.js"].map(s => withLang(s, lang)) };
  const out = [];
  let last;
  for (let hash = 1; hash <= 7; hash++) {
    last = await render(html, { w: v.w, files, hash });
    out.push(last.title + "\n" + last.html);
  }
  return { text: out.join("\n----\n"), lang: last.lang, table: last.table };
}

test("C5 English render has no Hangul in any variant", async () => {
  for (const [name, v] of Object.entries(VARIANTS)) {
    const r = await show(current(), v, "en");
    const hit = r.text.match(new RegExp(`.{0,40}${HANGUL.source}.{0,40}`));
    assert.ok(!hit, `${name}: Korean in English render: ${hit && hit[0]}`);
    assert.strictEqual(r.lang, "en", `${name}: <html lang>`);
  }
});

test("F5 English labels with a number or a name render", async () => {
  const en = (await show(current(), VARIANTS.walk, "en")).text;
  for (const s of ["A4 walkthrough round 2", "Changed since round 1", "2 files changed", "Round 1 changes requested", "Next: Structure"]) assert.ok(en.includes(s), s);
  const err = (await show(current(), VARIANTS.missing, "en")).text;
  assert.ok(err.includes(`Could not read walkthroughs/${ID}.js`), "missing file error");
  assert.ok((await show(current(), VARIANTS.noParam, "en")).text.includes("This address is not valid"), "no ?w= error");
});

test("C5 the static <title> shown before the first render has no Korean", () => {
  const title = staticTitle(current());
  assert.ok(!HANGUL.test(title), `static title: ${title}`);
});

// The Korean render of every variant, frozen from the template at 5226eb4 (origin/main, "as today"). To change it on purpose:
//   KO_FIXTURE_FROM=<git ref> node --test tests/walkthrough-lang.test.cjs   (renders that ref's template and rewrites the file)
const FIXTURE = path.join(__dirname, "fixtures", "walkthrough-ko.json");
test("P7 Korean render (no state.js, lang absent or ko) equals the frozen render of the base template", async () => {
  if (process.env.KO_FIXTURE_FROM) {
    const base = execFileSync("git", ["show", `${process.env.KO_FIXTURE_FROM}:${REL}`], { cwd: ROOT, encoding: "utf8" });
    const out = {};
    for (const [name, v] of Object.entries(VARIANTS)) out[name] = (await show(base, v, undefined)).text;
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
    fs.writeFileSync(FIXTURE, JSON.stringify(out, null, 1) + "\n");
  }
  assert.ok(fs.existsSync(FIXTURE), `missing ${FIXTURE}`);
  const frozen = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  assert.deepStrictEqual(Object.keys(frozen).sort(), Object.keys(VARIANTS).sort());
  for (const [name, v] of Object.entries(VARIANTS)) {
    assert.strictEqual((await show(current(), v, undefined)).text, frozen[name], `${name}: lang absent`);
    const ko = await show(current(), v, "ko");
    assert.strictEqual(ko.text, frozen[name], `${name}: lang ko`);
    assert.strictEqual(ko.lang, "ko");
  }
});

test("Q2 an unknown lang renders in Korean", async () => {
  const ko = await show(current(), VARIANTS.walk, "ko");
  const fr = await show(current(), VARIANTS.walk, "fr");
  assert.strictEqual(fr.text, ko.text);
  assert.strictEqual(fr.lang, "ko");
});

test("N2 the ko and en tables have the same keys", async () => {
  const { table } = await show(current(), VARIANTS.walk, "en");
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

test("the PR stage label matches the dashboard's stage strip in both languages", async () => {
  const dash = fs.readFileSync(path.join(ROOT, "skills/hub/templates/dashboard.html"), "utf8");
  const ctx = { document: { getElementById: () => ({}) } };
  vm.createContext(ctx);
  const src = scriptOf(dash);
  const dl = vm.runInContext(src.slice(src.indexOf("const L10N"), src.indexOf("let T = ")) + ";L10N", ctx);
  const wl = (await show(current(), VARIANTS.walk, "en")).table;
  for (const lang of ["ko", "en"]) assert.strictEqual(wl[lang].st.pr, dl[lang].stage.pr, lang);
});

test("changing only lang in state.js redraws the open page", async () => {
  const s = lane("walk", { walkthrough: ID });
  const r = await render(current(), { w: ID, hash: 1, files: { [`walkthroughs/${ID}.js`]: [FULL], [`walkthroughs/${ID}.diff.js`]: [DIFF], "state.js": [{ ...s, lang: "ko" }, { ...s, lang: "en" }] } });
  assert.strictEqual(r.lang, "en");
  assert.strictEqual(r.title, "A4 walkthrough round 2");
});
