import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { categorizeAllSkills } from "../src/skill-categories.js";

const skillRows = [
  { directory: "a", category: "coding", inCcSwitch: true },
  { directory: "b", category: "coding", inCcSwitch: true },
  { directory: "c", category: "coding", inCcSwitch: true },
  { directory: "missing", category: "coding", inCcSwitch: false },
];

test("identity skill resolver treats false-only maps as exclusions", async () => {
  const mod = await import("../src/identities.js");
  const identity = { categories: { coding: { enabled: true, skills: { b: false } } } };
  assert.deepEqual(mod.resolveIdentitySkillDirectories(identity, skillRows), ["a", "c"]);
});

test("identity skill resolver treats true maps as explicit includes", async () => {
  const mod = await import("../src/identities.js");
  const identity = { categories: { coding: { enabled: true, skills: { b: true, c: false } } } };
  assert.deepEqual(mod.resolveIdentitySkillDirectories(identity, skillRows), ["b"]);
});

test("identity reconciliation removes stale skill directories", async () => {
  const dir = mkdtempSync(join(process.cwd(), ".tmp-test-identities-"));
  process.env.CCS_IDENTITIES_PATH = join(dir, "identities.json");
  const mod = await import("../src/identities.js");

  try {
    const created = mod.createIdentity({ name: "test", icon: "T", description: "" }).identity;
    mod.updateIdentity(created.id, {
      categories: {
        coding: { enabled: true, skills: { stale: false, a: false } },
      },
    });

    const result = mod.reconcileWithSkills(skillRows);
    const identity = result.identities.find(i => i.id === created.id);
    assert.equal(identity.categories.coding.skills.stale, undefined);
    assert.equal(identity.categories.coding.skills.a, false);
  } finally {
    delete process.env.CCS_IDENTITIES_PATH;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("analyzed skill categories are applied as identity capability sets", async () => {
  const dir = mkdtempSync(join(process.cwd(), ".tmp-test-analysis-"));
  process.env.CCS_IDENTITIES_PATH = join(dir, "identities.json");
  const mod = await import("../src/identities.js");
  const analysisRows = [
    { directory: "tdd", name: "tdd", description: "test-driven development", inCcSwitch: true },
    { directory: "prototype", name: "prototype", description: "prototype workflow", inCcSwitch: true },
    { directory: "missing", name: "missing", description: "missing", inCcSwitch: false },
  ];

  try {
    const result = mod.applyAnalyzedIdentities({
      categories: [{
        name: "Development Workflow",
        icon: "UI",
        description: "Classified development skills",
        skills: ["tdd", "prototype", "missing"],
      }],
    }, analysisRows, "test-analysis");

    assert.equal(result.generated, 1);
    const identity = result.identities.at(-1);
    assert.equal(identity.generatedBy, "test-analysis");
    assert.equal(identity.generatedKind, "skill-category");
    assert.equal(identity.name, "Development Workflow");
    assert.equal(identity.categories.coding.enabled, true);
    assert.deepEqual(Object.keys(identity.categories.coding.skills).sort(), ["prototype", "tdd"]);
    assert.deepEqual(mod.resolveIdentitySkillDirectories(identity, categorizeAllSkills(analysisRows)), ["tdd", "prototype"]);
  } finally {
    delete process.env.CCS_IDENTITIES_PATH;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("local analysis creates dynamic identities from available groups", async () => {
  const mod = await import("../src/identities.js");
  const analysis = mod.localSkillAnalysis([
    { directory: "tdd", name: "tdd", description: "test-driven development", inCcSwitch: true },
    { directory: "xss-helper", name: "xss-helper", description: "web xss testing", inCcSwitch: true },
  ]);

  assert.equal(analysis.source, "local-analysis");
  assert.ok(analysis.categories.length >= 2);
  assert.ok(analysis.categories.some(i => i.skills.includes("tdd")));
  assert.ok(analysis.categories.some(i => i.skills.includes("xss-helper")));
});
