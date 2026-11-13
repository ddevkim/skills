// README.md tells an Orca user, in English, how to install, run, update, and remove the skills.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const readme = () => fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;

const INSTALL = [
  "claude plugin marketplace add ddevkim/skills",
  "claude plugin install orca-hub@ddevkim-skills",
  "/plugin marketplace add ddevkim/skills",
  "/plugin install orca-hub@ddevkim-skills",
  "codex plugin marketplace add ddevkim/skills",
  "codex plugin add orca-hub@ddevkim-skills",
  "npx skills add ddevkim/skills"
];

test("README contains each install command", () => {
  const text = readme();
  for (const cmd of INSTALL) assert.ok(text.includes(cmd), `missing install command: ${cmd}`);
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
