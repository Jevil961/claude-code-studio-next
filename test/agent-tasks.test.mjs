import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const tempDir = mkdtempSync(join(tmpdir(), "ccs-agent-tasks-"));
process.env.CCS_AGENT_TASKS_PATH = join(tempDir, "tasks.json");
process.env.CCS_AGENT_WORKTREE_ROOT = join(tempDir, "worktrees");

test.after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function git(args, cwd) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function gitOut(args, cwd) {
  return String(execFileSync("git", args, { cwd, encoding: "utf8" }) || "");
}

test("agent tasks persist and prepare an isolated git worktree", async () => {
  const repo = join(tempDir, "repo");
  git(["init", repo], tempDir);
  writeFileSync(join(repo, "README.md"), "hello\n", "utf8");
  git(["add", "README.md"], repo);
  git(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"], repo);

  const tasks = await import("../src/agent-tasks.js");
  const task = tasks.createAgentTask({
    title: "Fix Startup Flow",
    prompt: "Make startup reliable.",
    cwd: repo,
  });

  assert.equal(tasks.listAgentTasks().length, 1);
  assert.equal(task.status, "draft");

  const prepared = await tasks.prepareAgentTask(task.id);
  assert.equal(prepared.status, "ready");
  assert.match(prepared.branch, /^codex\/task-fix-startup-flow-/);
  assert.match(prepared.worktreePath, /worktrees/);
  assert.equal(tasks.listAgentTasks()[0].worktreePath, prepared.worktreePath);

  writeFileSync(join(prepared.worktreePath, "README.md"), "hello\nupdated\n", "utf8");
  writeFileSync(join(prepared.worktreePath, "notes.txt"), "new evidence\n", "utf8");
  const collected = await tasks.collectAgentTaskEvidence(task.id);
  assert.equal(collected.evidence.dirty, true);
  assert.deepEqual(collected.evidence.changedFiles.sort(), ["README.md", "notes.txt"]);
  assert.match(collected.evidence.diffSummary, /README\.md/);
  assert.match(collected.evidence.diffSummary, /Untracked: notes\.txt/);
  assert.match(collected.evidence.diffPatch, /updated/);
  assert.deepEqual(collected.evidence.fileStatuses.map(item => item.path).sort(), ["README.md", "notes.txt"]);
  assert.equal(collected.evidence.filePatches.length, 2);
  assert.match(tasks.exportAgentTaskAudit(task.id), /Agent Task Audit/);

  const committed = await tasks.commitAgentTask(task.id, "Agent task test commit");
  assert.equal(committed.task.status, "committed");
  assert.match(committed.commitHash, /^[a-f0-9]+$/);
  assert.equal(committed.task.changedFiles.length, 0);
  assert.equal(gitOut(["status", "--porcelain"], prepared.worktreePath).trim(), "");
});

test("agent tasks support batch creation, dependencies, queue planning, audit export, and discard", async () => {
  const repo = join(tempDir, "repo-queue");
  git(["init", repo], tempDir);
  writeFileSync(join(repo, "app.txt"), "base\n", "utf8");
  git(["add", "app.txt"], repo);
  git(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"], repo);

  const tasks = await import("../src/agent-tasks.js");
  const batch = tasks.createAgentTaskBatch({
    cwd: repo,
    tasks: [
      { title: "Foundation", prompt: "Prepare base." },
      { title: "Dependent", prompt: "Use foundation." },
    ],
  });
  assert.equal(batch.length, 2);

  const foundation = tasks.listAgentTasks().find(task => task.title === "Foundation");
  const dependent = tasks.listAgentTasks().find(task => task.title === "Dependent");
  tasks.updateAgentTask(dependent.id, { dependencies: [foundation.id] });

  let plan = tasks.planAgentTaskQueue();
  assert.equal(plan.runnable.some(task => task.id === foundation.id), true);
  assert.equal(plan.blocked.some(task => task.id === dependent.id), true);
  assert.throws(() => tasks.updateAgentTask(foundation.id, { dependencies: [dependent.id] }), /cycle/i);

  tasks.updateAgentTask(foundation.id, { status: "done" });
  plan = tasks.planAgentTaskQueue();
  assert.equal(plan.runnable.some(task => task.id === dependent.id), true);

  const prepared = await tasks.prepareAgentTask(dependent.id);
  writeFileSync(join(prepared.worktreePath, "app.txt"), "base\nchanged\n", "utf8");
  const evidence = await tasks.collectAgentTaskEvidence(dependent.id);
  assert.equal(evidence.evidence.dirty, true);
  assert.match(tasks.exportAgentTaskAudit(dependent.id, "json"), /Dependent/);

  const discarded = await tasks.discardAgentTaskChanges(dependent.id);
  assert.equal(discarded.discarded, 1);
  assert.equal(gitOut(["status", "--porcelain"], prepared.worktreePath).trim(), "");
  assert.equal(tasks.listAgentTasks().find(task => task.id === dependent.id).changedFiles.length, 0);
});
