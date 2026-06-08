import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";

const STORE_PATH = () => process.env.CCS_AGENT_TASKS_PATH || join(homedir(), ".claude-code-studio", "agent-tasks.json");
const WORKTREE_ROOT = () => process.env.CCS_AGENT_WORKTREE_ROOT || join(homedir(), ".claude-code-studio", "worktrees");

function now() { return Date.now(); }
function text(value, fallback = "") { return String(value ?? fallback).trim(); }
function boundedText(value, max = 100000) {
  const raw = String(value ?? "");
  if (raw.length <= max) return raw.trim();
  return `${raw.slice(0, max).trimEnd()}\n\n[truncated ${raw.length - max} chars]`;
}

function slug(value) {
  return text(value, "task")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "task";
}

function normalizeTask(task = {}) {
  return {
    id: text(task.id) || randomUUID(),
    title: text(task.title, "New Agent Task"),
    prompt: text(task.prompt),
    cwd: text(task.cwd),
    status: text(task.status, "draft") || "draft",
    branch: text(task.branch),
    worktreePath: text(task.worktreePath),
    baseBranch: text(task.baseBranch),
    error: text(task.error),
    notes: text(task.notes),
    runId: text(task.runId),
    output: text(task.output),
    diffSummary: text(task.diffSummary),
    diffPatch: boundedText(task.diffPatch),
    reviewStatus: text(task.reviewStatus, "pending") || "pending",
    reviewNotes: text(task.reviewNotes),
    changedFiles: Array.isArray(task.changedFiles) ? task.changedFiles.map(item => text(item)).filter(Boolean) : [],
    fileStatuses: Array.isArray(task.fileStatuses) ? task.fileStatuses.map(normalizeFileStatus).filter(item => item.path) : [],
    filePatches: Array.isArray(task.filePatches) ? task.filePatches.map(normalizeFilePatch).filter(item => item.path || item.patch) : [],
    dependencies: Array.isArray(task.dependencies) ? task.dependencies.map(item => text(item)).filter(Boolean) : [],
    queueOrder: Number(task.queueOrder || 0),
    commitHash: text(task.commitHash),
    createdAt: Number(task.createdAt || now()),
    updatedAt: Number(task.updatedAt || task.createdAt || now()),
    preparedAt: Number(task.preparedAt || 0),
    lastRunAt: Number(task.lastRunAt || 0),
    completedAt: Number(task.completedAt || 0),
    committedAt: Number(task.committedAt || 0),
    reviewedAt: Number(task.reviewedAt || 0),
  };
}

function normalizeFileStatus(item = {}) {
  if (typeof item === "string") return { path: text(item), status: "??" };
  return {
    path: text(item.path),
    status: text(item.status, "??").slice(0, 2),
  };
}

function normalizeFilePatch(item = {}) {
  return {
    path: text(item.path),
    status: text(item.status, "M").slice(0, 2),
    patch: boundedText(item.patch, 40000),
  };
}

function taskIsSatisfied(task) {
  return ["done", "committed"].includes(task?.status);
}

function decorateTasks(tasks) {
  const byId = new Map(tasks.map(task => [task.id, task]));
  return tasks.map(task => {
    const blockedBy = (task.dependencies || [])
      .map(id => byId.get(id))
      .filter(dep => dep && !taskIsSatisfied(dep))
      .map(dep => ({ id: dep.id, title: dep.title, status: dep.status }));
    const missingDependencies = (task.dependencies || []).filter(id => !byId.has(id));
    return {
      ...normalizeTask(task),
      blockedBy,
      missingDependencies,
      queueReady: blockedBy.length === 0 && missingDependencies.length === 0 && !["running", "done", "committed"].includes(task.status),
    };
  });
}

function decorateTaskFromStore(store, taskId) {
  return decorateTasks(store.tasks).find(task => task.id === taskId) || normalizeTask(findTask(store, taskId));
}

function readStore() {
  const file = STORE_PATH();
  if (!existsSync(file)) return { tasks: [] };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return { tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map(normalizeTask) : [] };
  } catch {
    return { tasks: [] };
  }
}

function saveStore(store) {
  const file = STORE_PATH();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ tasks: store.tasks.map(normalizeTask) }, null, 2), "utf8");
}

function findTask(store, taskId) {
  const task = store.tasks.find(item => item.id === taskId);
  if (!task) throw new Error("Agent task not found");
  return task;
}

function runGit(args, cwd) {
  return new Promise(resolve => {
    execFile("git", args, { cwd, windowsHide: true, timeout: 20000, encoding: "utf8" }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ""), stderr: String(stderr || ""), error: err?.message || "" });
    });
  });
}

export function listAgentTasks() {
  const tasks = readStore().tasks.sort((a, b) => (a.queueOrder || 0) - (b.queueOrder || 0) || b.updatedAt - a.updatedAt);
  return decorateTasks(tasks);
}

export function createAgentTask(input = {}) {
  const store = readStore();
  const task = normalizeTask({
    title: input.title || "New Agent Task",
    prompt: input.prompt || "",
    cwd: input.cwd || "",
    dependencies: input.dependencies || [],
    queueOrder: Number(input.queueOrder || store.tasks.length + 1),
    status: "draft",
    createdAt: now(),
    updatedAt: now(),
  });
  store.tasks.unshift(task);
  saveStore(store);
  return decorateTaskFromStore(store, task.id);
}

export function updateAgentTask(taskId, updates = {}) {
  const store = readStore();
  const task = findTask(store, taskId);
  for (const key of ["title", "prompt", "cwd", "status", "branch", "worktreePath", "baseBranch", "error", "notes", "runId", "output", "diffSummary", "diffPatch", "commitHash", "reviewStatus", "reviewNotes"]) {
    if (updates[key] !== undefined) task[key] = text(updates[key]);
  }
  for (const key of ["preparedAt", "lastRunAt", "completedAt", "committedAt", "reviewedAt"]) {
    if (updates[key] !== undefined) task[key] = Number(updates[key] || 0);
  }
  if (Array.isArray(updates.changedFiles)) {
    task.changedFiles = updates.changedFiles.map(item => text(item)).filter(Boolean);
  }
  if (Array.isArray(updates.fileStatuses)) {
    task.fileStatuses = updates.fileStatuses.map(normalizeFileStatus).filter(item => item.path);
  }
  if (Array.isArray(updates.filePatches)) {
    task.filePatches = updates.filePatches.map(normalizeFilePatch).filter(item => item.path || item.patch);
  }
  if (Array.isArray(updates.dependencies)) {
    task.dependencies = updates.dependencies.map(item => text(item)).filter(Boolean).filter(id => id !== task.id);
    assertNoDependencyCycle(store.tasks, task.id, task.dependencies);
  }
  if (updates.queueOrder !== undefined) task.queueOrder = Number(updates.queueOrder || 0);
  task.updatedAt = now();
  saveStore(store);
  return decorateTaskFromStore(store, task.id);
}

export function deleteAgentTask(taskId) {
  const store = readStore();
  const before = store.tasks.length;
  store.tasks = store.tasks.filter(task => task.id !== taskId);
  if (before === store.tasks.length) throw new Error("Agent task not found");
  saveStore(store);
  return { ok: true };
}

export async function prepareAgentTask(taskId) {
  const store = readStore();
  const task = findTask(store, taskId);
  if (!task.cwd || !existsSync(task.cwd)) throw new Error("Task project path is missing");

  const root = await runGit(["rev-parse", "--show-toplevel"], task.cwd);
  if (!root.ok) throw new Error("Task project is not a Git repository");
  const repoRoot = root.stdout.trim();
  const currentBranch = await runGit(["branch", "--show-current"], repoRoot);
  const baseBranch = currentBranch.stdout.trim() || "HEAD";
  const branch = task.branch || `codex/task-${slug(task.title)}-${task.id.slice(0, 8)}`;
  const worktreePath = task.worktreePath || join(WORKTREE_ROOT(), slug(task.title), task.id.slice(0, 8));

  mkdirSync(dirname(worktreePath), { recursive: true });
  if (!existsSync(worktreePath)) {
    const add = await runGit(["worktree", "add", "-b", branch, worktreePath, "HEAD"], repoRoot);
    if (!add.ok) {
      const fallback = await runGit(["worktree", "add", worktreePath, branch], repoRoot);
      if (!fallback.ok) throw new Error((add.stderr || fallback.stderr || add.error || "git worktree add failed").slice(0, 500));
    }
  }

  task.status = "ready";
  task.branch = branch;
  task.worktreePath = worktreePath;
  task.baseBranch = baseBranch;
  task.error = "";
  task.preparedAt = now();
  task.updatedAt = now();
  saveStore(store);
  return decorateTaskFromStore(store, task.id);
}

function parseStatusRows(stdout) {
  return String(stdout || "")
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(Boolean)
    .map(line => ({
      status: line.slice(0, 2).trim() || "??",
      path: line.slice(3).trim(),
    }))
    .filter(item => item.path);
}

function parsePatchFiles(patchText, fileStatuses = []) {
  const patch = String(patchText || "").trim();
  if (!patch) return [];
  const chunks = patch.split(/\n(?=diff --git )/g).filter(Boolean);
  return chunks.map(chunk => {
    const match = chunk.match(/^diff --git a\/(.+?) b\/(.+?)$/m);
    const path = match?.[2] || match?.[1] || "";
    const status = fileStatuses.find(item => item.path === path)?.status || "M";
    return normalizeFilePatch({ path, status, patch: chunk });
  }).filter(item => item.path || item.patch);
}

export async function collectAgentTaskEvidence(taskId) {
  const store = readStore();
  const task = findTask(store, taskId);
  const cwd = task.worktreePath || task.cwd;
  if (!cwd || !existsSync(cwd)) throw new Error("Task worktree path is missing");

  const status = await runGit(["status", "--porcelain"], cwd);
  if (!status.ok) throw new Error((status.stderr || status.error || "git status failed").slice(0, 500));

  const diff = await runGit(["diff", "--stat", "HEAD"], cwd);
  const patch = await runGit(["diff", "--patch", "HEAD"], cwd);
  const fileStatuses = parseStatusRows(status.stdout);
  const changedFiles = [...new Set(fileStatuses.map(item => item.path))];
  const untracked = changedFiles.filter(file => status.stdout.includes(`?? ${file}`));
  const trackedFilePatches = parsePatchFiles(patch.ok ? patch.stdout : "", fileStatuses);
  const untrackedPatches = untracked.map(file => normalizeFilePatch({ path: file, status: "??", patch: `# Untracked file: ${file}` }));
  const diffSummaryParts = [
    diff.ok ? diff.stdout.trim() : "",
    untracked.length ? `Untracked: ${untracked.slice(0, 20).join(", ")}${untracked.length > 20 ? ` +${untracked.length - 20}` : ""}` : "",
  ].filter(Boolean);

  task.changedFiles = changedFiles;
  task.fileStatuses = fileStatuses;
  task.filePatches = [...trackedFilePatches, ...untrackedPatches];
  task.diffSummary = diffSummaryParts.join("\n").trim();
  task.diffPatch = boundedText([
    patch.ok ? patch.stdout.trim() : "",
    untracked.length ? `\n# Untracked files\n${untracked.map(file => `#   ${file}`).join("\n")}` : "",
  ].filter(Boolean).join("\n"));
  task.error = "";
  if (changedFiles.length) {
    task.reviewStatus = "pending";
    task.reviewedAt = 0;
  }
  task.updatedAt = now();
  saveStore(store);
  return {
    task: normalizeTask(task),
    evidence: {
      dirty: changedFiles.length > 0,
      changedFiles,
      fileStatuses,
      filePatches: task.filePatches,
      changedFileCount: changedFiles.length,
      diffSummary: task.diffSummary,
      diffPatch: task.diffPatch,
      statusPorcelain: String(status.stdout || "").split(/\r?\n/).filter(Boolean),
    },
  };
}

export async function commitAgentTask(taskId, message = "") {
  const collected = await collectAgentTaskEvidence(taskId);
  const store = readStore();
  const task = findTask(store, taskId);
  const cwd = task.worktreePath || task.cwd;
  if (!collected.evidence.changedFiles.length) throw new Error("No changes to commit");

  const add = await runGit(["add", "-A"], cwd);
  if (!add.ok) throw new Error((add.stderr || add.error || "git add failed").slice(0, 500));

  const commitMessage = text(message, `Agent task: ${task.title}`).slice(0, 180) || `Agent task: ${task.id}`;
  const commit = await runGit([
    "-c", "user.name=Claude Code Studio",
    "-c", "user.email=claude-code-studio@example.local",
    "commit", "-m", commitMessage,
  ], cwd);
  if (!commit.ok) throw new Error((commit.stderr || commit.error || "git commit failed").slice(0, 500));

  const hash = await runGit(["rev-parse", "--short", "HEAD"], cwd);
  task.status = "committed";
  task.commitHash = hash.ok ? hash.stdout.trim() : "";
  task.error = "";
  task.changedFiles = [];
  task.fileStatuses = [];
  task.filePatches = [];
  task.diffSummary = "";
  task.diffPatch = "";
  task.reviewStatus = "approved";
  task.reviewedAt = task.reviewedAt || now();
  task.committedAt = now();
  task.updatedAt = now();
  saveStore(store);
  return {
    task: normalizeTask(task),
    commitHash: task.commitHash,
    stdout: commit.stdout,
  };
}

export function createAgentTaskBatch(input = {}) {
  const items = Array.isArray(input.tasks) ? input.tasks : [];
  if (!items.length) return [];
  const store = readStore();
  const created = [];
  let queueOrder = store.tasks.reduce((max, task) => Math.max(max, Number(task.queueOrder || 0)), 0);
  for (const item of items) {
    queueOrder += 1;
    const task = normalizeTask({
      title: item.title || "New Agent Task",
      prompt: item.prompt || "",
      cwd: item.cwd || input.cwd || "",
      dependencies: item.dependencies || [],
      queueOrder,
      status: "draft",
      createdAt: now(),
      updatedAt: now(),
    });
    store.tasks.push(task);
    created.push(task);
  }
  saveStore(store);
  return decorateTasks(created);
}

export function planAgentTaskQueue() {
  const tasks = listAgentTasks();
  const runnable = tasks.filter(task => task.queueReady);
  const blocked = tasks.filter(task => !task.queueReady && !["done", "committed"].includes(task.status));
  return {
    tasks,
    runnable,
    blocked,
    counts: {
      total: tasks.length,
      runnable: runnable.length,
      blocked: blocked.length,
      done: tasks.filter(task => task.status === "done").length,
      committed: tasks.filter(task => task.status === "committed").length,
      error: tasks.filter(task => task.status === "error").length,
    },
  };
}

export async function discardAgentTaskChanges(taskId) {
  const collected = await collectAgentTaskEvidence(taskId);
  const store = readStore();
  const task = findTask(store, taskId);
  const cwd = task.worktreePath || task.cwd;
  if (!collected.evidence.changedFiles.length) return { task: decorateTaskFromStore(store, task.id), discarded: 0 };

  const reset = await runGit(["reset", "--hard", "HEAD"], cwd);
  if (!reset.ok) throw new Error((reset.stderr || reset.error || "git reset failed").slice(0, 500));
  const clean = await runGit(["clean", "-fd"], cwd);
  if (!clean.ok) throw new Error((clean.stderr || clean.error || "git clean failed").slice(0, 500));

  task.status = task.status === "running" ? "ready" : (task.worktreePath ? "ready" : "draft");
  task.error = "";
  task.changedFiles = [];
  task.fileStatuses = [];
  task.filePatches = [];
  task.diffSummary = "";
  task.diffPatch = "";
  task.reviewStatus = "pending";
  task.reviewNotes = "";
  task.reviewedAt = 0;
  task.updatedAt = now();
  saveStore(store);
  return { task: decorateTaskFromStore(store, task.id), discarded: collected.evidence.changedFiles.length };
}

export function exportAgentTaskAudit(taskId, format = "md") {
  const task = listAgentTasks().find(item => item.id === taskId);
  if (!task) throw new Error("Agent task not found");
  if (format === "json") return JSON.stringify(task, null, 2);

  const lines = [
    `# Agent Task Audit: ${task.title}`,
    "",
    `- Status: ${task.status}`,
    `- Branch: ${task.branch || "-"}`,
    `- Worktree: ${task.worktreePath || "-"}`,
    `- Commit: ${task.commitHash || "-"}`,
    `- Review: ${task.reviewStatus || "pending"}${task.reviewedAt ? ` (${new Date(task.reviewedAt).toISOString()})` : ""}`,
    `- Dependencies: ${(task.dependencies || []).join(", ") || "-"}`,
    `- Updated: ${task.updatedAt ? new Date(task.updatedAt).toISOString() : "-"}`,
    "",
    "## Prompt",
    "",
    task.prompt || "-",
    "",
    "## Output",
    "",
    task.output || "-",
    "",
    "## Review Notes",
    "",
    task.reviewNotes || "-",
    "",
    "## Diff Summary",
    "",
    "```",
    task.diffSummary || "-",
    "```",
    "",
    "## Changed Files",
    "",
    ...(task.fileStatuses?.length ? task.fileStatuses.map(file => `- ${file.status} ${file.path}`) : ["- none"]),
  ];
  if (task.diffPatch) {
    lines.push("", "## Patch", "", "```diff", task.diffPatch, "```");
  }
  return lines.join("\n");
}

function assertNoDependencyCycle(tasks, taskId, dependencies) {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const seen = new Set();
  const visit = id => {
    if (id === taskId) throw new Error("Task dependency cycle detected");
    if (seen.has(id)) return;
    seen.add(id);
    const next = byId.get(id);
    for (const depId of (next?.dependencies || [])) visit(depId);
  };
  for (const depId of dependencies) visit(depId);
}
