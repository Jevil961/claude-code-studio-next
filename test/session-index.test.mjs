import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildSessionIndex, findSession, listCachedProjects, readSessionMessages } from "../src/db/sessionIndex.js";

function makeFixture() {
  const root = mkdtempSync(join(process.cwd(), ".tmp-session-index-"));
  const appDir = join(root, "app");
  const projectsRoot = join(root, "projects");
  const projectDir = join(projectsRoot, "C--work-demo");
  mkdirSync(projectDir, { recursive: true });
  const sessionFile = join(projectDir, "s-1.jsonl");
  writeFileSync(sessionFile, [
    JSON.stringify({ type: "user", message: { role: "user", content: "Build the feature" }, timestamp: "2026-05-31T00:00:00Z" }),
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Done" }] }, timestamp: "2026-05-31T00:01:00Z" }),
    "",
  ].join("\n"), "utf8");
  return { root, appDir, projectsRoot, sessionFile };
}

test("session index builds project list and validates sessions", () => {
  const fx = makeFixture();
  try {
    const result = buildSessionIndex({ appDir: fx.appDir, projectsRoot: fx.projectsRoot, budgetMs: 1000 });
    assert.equal(result.projects.length, 1);
    assert.equal(result.projects[0].sessions[0].title, "Build the feature");
    assert.equal(listCachedProjects({ appDir: fx.appDir }).length, 1);

    const found = findSession("s-1", { projectsRoot: fx.projectsRoot });
    assert.equal(found.exists, true);
    assert.equal(found.path, fx.sessionFile);

    const missing = findSession("missing", { projectsRoot: fx.projectsRoot });
    assert.equal(missing.exists, false);
    assert.equal(missing.recoverable, true);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("readSessionMessages returns recoverable missing state", () => {
  const fx = makeFixture();
  try {
    const session = readSessionMessages("s-1", { projectsRoot: fx.projectsRoot });
    assert.equal(session.exists, true);
    assert.equal(session.messages.length, 2);

    const missing = readSessionMessages("missing", { projectsRoot: fx.projectsRoot });
    assert.equal(missing.exists, false);
    assert.deepEqual(missing.messages, []);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});
