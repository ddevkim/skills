// Keeps the install manifests valid: Claude Code and Codex both read
// .claude-plugin/marketplace.json and .claude-plugin/plugin.json;
// `npx skills` scans skills/*/SKILL.md.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function readJson(rel) {
  const file = path.join(root, rel);
  assert.ok(fs.existsSync(file), `${rel} is missing`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function nonEmpty(value, label) {
  assert.ok(typeof value === "string" && value.trim() !== "", `${label} must be a non-empty string`);
}

function assertSkillDir(dir, label) {
  const skill = path.join(root, dir, "SKILL.md");
  assert.ok(fs.existsSync(skill), `${label}: ${dir}/SKILL.md does not exist`);
  const front = fs.readFileSync(skill, "utf8").match(/^---\n([\s\S]*?)\n---/);
  assert.ok(front, `${label}: ${dir}/SKILL.md has no frontmatter`);
  assert.match(front[1], /^name: \S/m, `${label}: ${dir}/SKILL.md frontmatter lacks name`);
  assert.match(front[1], /^description: \S/m, `${label}: ${dir}/SKILL.md frontmatter lacks description`);
}

// Skill folders a plugin root serves: its default skills/ dir plus any `skills` paths.
function pluginSkillDirs(pluginRoot, manifest) {
  const extra = [].concat(manifest.skills || []);
  const scan = ["skills", ...extra].map((p) => path.join(pluginRoot, p));
  return scan.flatMap((dir) => {
    if (fs.existsSync(path.join(root, dir, "SKILL.md"))) return [dir];
    if (!fs.existsSync(path.join(root, dir))) return [];
    return fs.readdirSync(path.join(root, dir))
      .filter((n) => fs.existsSync(path.join(root, dir, n, "SKILL.md")))
      .map((n) => path.join(dir, n));
  });
}

test("marketplace manifest has its required fields", () => {
  const m = readJson(".claude-plugin/marketplace.json");
  nonEmpty(m.name, "marketplace name");
  assert.match(m.name, KEBAB, "marketplace name must be lowercase-hyphen");
  nonEmpty(m.owner && m.owner.name, "marketplace owner.name");
  assert.ok(Array.isArray(m.plugins) && m.plugins.length > 0, "marketplace lists no plugins");
  for (const p of m.plugins) {
    nonEmpty(p.name, "plugin entry name");
    assert.match(p.name, KEBAB, `plugin name ${p.name} must be lowercase-hyphen`);
    nonEmpty(p.description, `plugin ${p.name} description`);
    nonEmpty(p.source, `plugin ${p.name} source`);
  }
});

test("every marketplace source holds a plugin manifest and the hub skill", () => {
  const m = readJson(".claude-plugin/marketplace.json");
  const served = [];
  for (const p of m.plugins) {
    assert.ok(fs.existsSync(path.join(root, p.source)), `plugin ${p.name} source ${p.source} does not exist`);
    const manifest = readJson(path.join(p.source, ".claude-plugin/plugin.json"));
    assert.strictEqual(manifest.name, p.name, "plugin.json name must match the marketplace entry");
    const dirs = pluginSkillDirs(p.source, manifest);
    assert.ok(dirs.length > 0, `plugin ${p.name} serves no skills`);
    dirs.forEach((d) => assertSkillDir(d, `plugin ${p.name}`));
    served.push(...dirs.map((d) => path.basename(d)));
  }
  assert.ok(served.includes("hub"), "no plugin serves the hub skill");
});

test("plugin manifest has its required fields", () => {
  const p = readJson(".claude-plugin/plugin.json");
  nonEmpty(p.name, "plugin name");
  assert.match(p.name, KEBAB, "plugin name must be lowercase-hyphen");
  nonEmpty(p.description, "plugin description");
  nonEmpty(p.version, "plugin version");
  nonEmpty(p.author && p.author.name, "plugin author.name");
  assert.strictEqual(p.license, "MIT");
});

test("the marketplace and its plugin are both named vera, at the vera repo", () => {
  const m = readJson(".claude-plugin/marketplace.json");
  const p = readJson(".claude-plugin/plugin.json");
  assert.strictEqual(m.name, "vera");
  assert.deepStrictEqual(m.plugins.map((e) => e.name), ["vera"]);
  assert.match(m.metadata.description, /Vera/);
  assert.strictEqual(p.name, "vera");
  assert.strictEqual(p.homepage, "https://github.com/ddevkim/vera");
  assert.strictEqual(p.repository, "https://github.com/ddevkim/vera");
});

test("the repo states an MIT license", () => {
  const file = path.join(root, "LICENSE");
  assert.ok(fs.existsSync(file), "LICENSE is missing");
  const text = fs.readFileSync(file, "utf8");
  assert.match(text, /^MIT License/);
  assert.match(text, /Copyright \(c\) 2026 ddevkim/);
});

test("hub stays direct-invocation only on Codex", () => {
  const yaml = fs.readFileSync(path.join(root, "skills/hub/agents/openai.yaml"), "utf8");
  assert.match(yaml, /^\s*allow_implicit_invocation: false\s*$/m);
  assert.match(yaml, /^\s*display_name: "Vera Hub"\s*$/m);
  assert.match(yaml, /^\s*default_prompt: "Use \$vera:hub to /m);
});
