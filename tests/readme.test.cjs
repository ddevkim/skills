// README.md tells an Orca user, in English, how to install, run, update, and remove the skills.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const readme = () => fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;

const INSTALL = [
  "claude plugin marketplace add ddevkim/vera",
  "claude plugin install vera@vera",
  "/plugin marketplace add ddevkim/vera",
  "/plugin install vera@vera",
  "codex plugin marketplace add ddevkim/vera",
  "codex plugin add vera@vera",
  "npx skills add ddevkim/vera --skill hub"
];

const RUN_UPDATE_REMOVE = [
  "/vera:hub",
  "$vera:hub",
  "claude plugin marketplace update vera",
  "claude plugin update vera@vera",
  "codex plugin marketplace upgrade vera",
  "npx skills update hub",
  "claude plugin uninstall vera@vera",
  "claude plugin marketplace remove vera",
  "codex plugin remove vera@vera",
  "codex plugin marketplace remove vera",
  "npx skills remove hub"
];

test("README contains each install command", () => {
  const text = readme();
  for (const cmd of INSTALL) assert.ok(text.includes(cmd), `missing install command: ${cmd}`);
});

test("README is titled Vera and gives the invoke, update, and uninstall commands", () => {
  const text = readme();
  assert.match(text, /^# Vera$/m);
  for (const cmd of RUN_UPDATE_REMOVE) assert.ok(text.includes(cmd), `missing command: ${cmd}`);
});

test("every relative link and image path in README exists", () => {
  const text = readme();
  const targets = [...text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)].map(m => m[1])
    .filter(t => !/^[a-z]+:/i.test(t) && !t.startsWith("#"));
  assert.ok(targets.length > 0, "README has no relative links");
  for (const t of targets) {
    const file = t.split("#")[0];
    assert.ok(fs.existsSync(path.join(ROOT, file)), `broken link: ${t}`);
  }
});

test("README shows the dashboard screenshot", () => {
  assert.match(readme(), /!\[[^\]]*\]\(docs\/dashboard\.png\)/);
});

test("README contains no Hangul", () => {
  const line = readme().split("\n").find(l => HANGUL.test(l));
  assert.strictEqual(line, undefined, `Hangul in README: ${line}`);
});

test("LICENSE exists and README links it", () => {
  assert.ok(fs.existsSync(path.join(ROOT, "LICENSE")), "LICENSE missing");
  assert.match(readme(), /\]\(LICENSE\)/, "README does not link LICENSE");
});

test("README names the three autonomy levels and that the walkthrough page follows lang", () => {
  const text = readme();
  for (const level of ["Low", "Medium", "High"]) assert.match(text, new RegExp(`\\*\\*${level}\\*\\*`));
  assert.match(text, /walkthrough page[^.\n]*`lang`|`lang`[^.\n]*walkthrough page/);
});
