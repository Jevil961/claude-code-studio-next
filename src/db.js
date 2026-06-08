// Legacy module - projects, sessions, plugins, usage, diagnostics
// Provider/skill/mcp operations moved to src/db/ modules

import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { buildSessionIndex, findSession, listCachedProjects, readSessionMessages, readSessionTitle } from "./db/sessionIndex.js";

const APP_CACHE_DIR = join(homedir(), ".claude-code-studio");
const USAGE_CACHE_FILE = join(APP_CACHE_DIR, "usage-cache.json");
const USAGE_CACHE_TTL_MS = 5 * 60 * 1000;

function tryStat(p) { try { return statSync(p); } catch { return null; } }

function decodeProjectName(name) {
  if (name.length >= 3 && name[1] === "-" && name[2] === "-") return name[0] + ":\\" + name.slice(3).replace(/-/g, "\\");
  return name.replace(/-/g, "/");
}

export function listProjects(options = {}) {
  const cached = listCachedProjects(options);
  if (cached.length) return cached;
  return buildSessionIndex({ ...options, budgetMs: 300, maxProjects: 40, visibleSessionCount: 6, titleScanCount: 2, stopOnBudget: true, persistProjects: true }).projects;
}

export function refreshProjects(options = {}) {
  return buildSessionIndex({
    budgetMs: Number(options.budgetMs ?? 280),
    visibleSessionCount: Number(options.visibleSessionCount ?? 12),
    titleScanCount: Number(options.titleScanCount ?? 4),
    maxProjects: Number(options.maxProjects ?? 100),
    stopOnBudget: options.stopOnBudget !== false,
  });
}

export function validateSession(sessionId) {
  return findSession(sessionId);
}

export function readSession(sessionId) {
  return readSessionMessages(sessionId);
}

export function listPlugins() {
  const roots = [join(homedir(), ".claude", "plugins"), join(homedir(), ".codex", "plugins")];
  const out = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      const p = join(root, name);
      if (!statSync(p).isDirectory()) continue;
      const manifest = readPluginManifest(p);
      out.push({
        name: manifest?.name || name,
        id: manifest?.id || manifest?.name || name,
        version: manifest?.version || "",
        description: manifest?.description || manifest?.summary || "",
        path: p,
        source: basename(dirname(root)),
        manifestPath: manifest?.manifestPath || "",
        updatedAt: Math.floor(statSync(p).mtimeMs / 1000),
      });
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

function readPluginManifest(pluginDir) {
  const candidates = [
    join(pluginDir, ".claude-plugin", "plugin.json"),
    join(pluginDir, ".codex-plugin", "plugin.json"),
    join(pluginDir, "plugin.json"),
    join(pluginDir, "package.json"),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      const manifest = JSON.parse(readFileSync(file, "utf8"));
      return { ...manifest, manifestPath: file };
    } catch {}
  }
  return null;
}

export function listAutomations() {
  const roots = [join(homedir(), ".codex", "automations"), join(homedir(), ".agents", "automations")];
  const out = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    walk(root, out);
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p, out); continue; }
    if (name !== "automation.toml") continue;
    const text = readFileSync(p, "utf8");
    let n = basename(dirname(p));
    for (const line of text.split(/\r?\n/)) { if (line.trim().startsWith("name")) { n = line.split("=")[1]?.trim().replace(/"/g, "") || n; break; } }
    out.push({ name: n, path: p, updatedAt: Math.floor(statSync(p).mtimeMs / 1000), summary: text.split(/\r?\n/).find(l => l.trim().startsWith("status") || l.trim().startsWith("rrule"))?.trim() || "" });
  }
}

export function listUsage(options = {}) {
  const cached = readUsageCache(Number(options.maxAgeMs ?? USAGE_CACHE_TTL_MS));
  if (cached) return cached;
  const usage = computeUsage();
  writeUsageCache(usage);
  return usage;
}

function computeUsage() {
  const root = join(homedir(), ".claude", "projects");
  const zeroes = () => ({ requests: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 0 });
  const totals = zeroes();
  const byModel = {}, byProject = {}, daily = {}, sessions = {};
  if (!existsSync(root)) return { totals, byModel: [], byProject: [], daily: [], sessions: [] };
  const MAX_FILES_PER_PROJECT = 6;
  const MAX_PROJECTS = 12;
  let projectCount = 0;
  for (const pn of readdirSync(root)) {
    if (projectCount++ >= MAX_PROJECTS) break;
    const pdir = join(root, pn);
    if (!statSync(pdir).isDirectory()) continue;
    const pb = byProject[pn] || (byProject[pn] = { ...zeroes(), id: pn, name: pn, path: decodeProjectName(pn), updatedAt: Math.floor(statSync(pdir).mtimeMs / 1000) });
    const files = readdirSync(pdir).filter(f => f.endsWith(".jsonl")).sort((a, b) => {
      const sa = tryStat(join(pdir, a)), sb = tryStat(join(pdir, b));
      return (sb?.mtimeMs || 0) - (sa?.mtimeMs || 0);
    });
    for (const file of files.slice(0, MAX_FILES_PER_PROJECT)) {
      const fp = join(pdir, file), st = tryStat(fp);
      if (!st) continue;
      const sid = file.replace(/\.jsonl$/, "");
      const sb = sessions[sid] || (sessions[sid] = { ...zeroes(), id: sid, projectId: pn, projectPath: decodeProjectName(pn), title: readSessionTitle(fp) || sid, updatedAt: Math.floor(st.mtimeMs / 1000), models: {} });
      try {
        for (const line of readFileSync(fp, "utf8").split(/\r?\n/)) {
          if (!line.trim()) continue;
          let obj; try { obj = JSON.parse(line); } catch { continue; }
          const u = obj?.message?.usage; if (!u) continue;
          const model = obj.message.model || "unknown";
          const ts = obj.timestamp ? Math.floor(new Date(obj.timestamp).getTime() / 1000) : Math.floor(st.mtimeMs / 1000);
          const day = new Date(ts * 1000).toISOString().slice(0, 10);
          const mb = byModel[model] || (byModel[model] = { ...zeroes(), model });
          const db = daily[day] || (daily[day] = { ...zeroes(), date: day });
          const inp = Number(u.input_tokens || 0), out = Number(u.output_tokens || 0), cc = Number(u.cache_creation_input_tokens || 0), cr = Number(u.cache_read_input_tokens || 0);
          for (const t of [totals, pb, sb, mb, db]) { t.requests++; t.inputTokens += inp; t.outputTokens += out; t.cacheCreationTokens += cc; t.cacheReadTokens += cr; t.totalTokens += inp + out + cc + cr; }
          sb.updatedAt = Math.max(sb.updatedAt, ts); pb.updatedAt = Math.max(pb.updatedAt, ts);
          sb.models[model] = (sb.models[model] || 0) + 1;
        }
      } catch {}
    }
  }
  const sl = Object.values(sessions).map(s => { const m = Object.entries(s.models).sort((a, b) => b[1] - a[1]); s.model = m[0]?.[0] || "unknown"; delete s.models; return s; });
  return { totals, byModel: Object.values(byModel).sort((a, b) => b.totalTokens - a.totalTokens), byProject: Object.values(byProject).sort((a, b) => b.totalTokens - a.totalTokens), daily: Object.values(daily).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30), sessions: sl.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 40) };
}

function readUsageCache(maxAgeMs) {
  if (!maxAgeMs || maxAgeMs < 1) return null;
  try {
    if (!existsSync(USAGE_CACHE_FILE)) return null;
    const cached = JSON.parse(readFileSync(USAGE_CACHE_FILE, "utf8"));
    if (!cached?.data || !cached.updatedAt || Date.now() - cached.updatedAt > maxAgeMs) return null;
    return cached.data;
  } catch {
    return null;
  }
}

function writeUsageCache(data) {
  try {
    mkdirSync(APP_CACHE_DIR, { recursive: true });
    writeFileSync(USAGE_CACHE_FILE, JSON.stringify({ updatedAt: Date.now(), data }), "utf8");
  } catch {}
}

export async function getDiagnostics(payload = {}) {
  const { findClaude, findClaudeSync } = await import("./runner/ClaudeRunner.js");
  const setup = await import("./claude-setup.js").then(m => m.detectClaude(payload.claudePath || ""));
  const claudePath = payload.claudePath || findClaudeSync() || await findClaude();
  const ccSwitchDb = join(homedir(), ".cc-switch", "cc-switch.db");
  const git = await getGitStatus(payload.cwd || process.cwd());
  return {
    platform: process.platform, cwd: payload.cwd || process.cwd(),
    ...setup,
    claudePath: claudePath || setup.claudePath,
    claudeVersion: setup.version || "",
    ccSwitchPath: "(integrated)", ccSwitchDb,
    ccSwitchDbExists: existsSync(ccSwitchDb), pythonPath: "(not needed)",
    nodePath: setup.nodePath || process.execPath,
    nodeVersion: setup.nodeVersion || process.version,
    backendNodePath: process.execPath,
    backendNodeVersion: process.version,
    backendPid: process.pid,
    runnerStrategy: payload.runnerStrategy || "", permissionMode: payload.permissionMode || "", git, ok: Boolean(claudePath),
  };
}

function execFileText(command, args = [], options = {}) {
  return new Promise(resolve => {
    execFile(command, args, { windowsHide: true, timeout: 5000, encoding: "utf8", ...options }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ""), stderr: String(stderr || ""), error: err?.message || "" });
    });
  });
}

async function getGitStatus(cwd) {
  const dir = String(cwd || "").trim();
  if (!dir || !existsSync(dir)) return { ok: false, reason: "no-project" };
  const root = await execFileText("git", ["rev-parse", "--show-toplevel"], { cwd: dir });
  if (!root.ok) return { ok: false, reason: "not-git-repo" };
  const branch = await execFileText("git", ["branch", "--show-current"], { cwd: dir });
  const head = await execFileText("git", ["rev-parse", "--short", "HEAD"], { cwd: dir });
  const status = await execFileText("git", ["status", "--porcelain"], { cwd: dir });
  const rows = status.stdout.split(/\r?\n/).filter(Boolean);
  const counts = { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 };
  for (const row of rows) {
    const code = row.slice(0, 2);
    if (code.includes("U") || code === "AA" || code === "DD") counts.conflicted++;
    else if (code.includes("?")) counts.untracked++;
    else if (code.includes("R")) counts.renamed++;
    else if (code.includes("D")) counts.deleted++;
    else if (code.includes("A")) counts.added++;
    else if (code.trim()) counts.modified++;
  }
  return {
    ok: true,
    root: root.stdout.trim(),
    branch: branch.stdout.trim() || "detached",
    head: head.stdout.trim(),
    dirty: rows.length > 0,
    changedFiles: rows.length,
    counts,
  };
}

export async function getDiagnosticReport(payload = {}) {
  const { getDb } = await import("./db/connection.js");
  const providers = await import("./db/providers.js");
  const skills = await import("./db/skills.js");
  const mcp = await import("./db/mcp.js");
  const identities = await import("./identities.js");
  let dbOk = false;
  let dbError = "";
  try { await getDb(); dbOk = true; } catch (e) { dbError = e.message; }
  const diag = await getDiagnostics(payload);
  const processes = await listRelevantProcesses();
  return {
    generatedAt: new Date().toISOString(),
    diagnostics: diag,
    runtime: {
      nodePath: process.execPath,
      nodeVersion: process.version,
      backendPid: process.pid,
      versions: process.versions,
    },
    db: { ok: dbOk, error: dbError, path: join(homedir(), ".cc-switch", "cc-switch.db") },
    paths: {
      claudeSettings: join(homedir(), ".claude", "settings.json"),
      claudeSkills: join(homedir(), ".claude", "skills"),
      backupRoot: join(homedir(), ".claude-code-studio", "backups"),
      usageCache: USAGE_CACHE_FILE,
    },
    counts: {
      providers: dbOk ? providers.list().length : 0,
      skills: dbOk ? skills.list().length : 0,
      mcp: dbOk ? mcp.list().length : 0,
      identities: identities.getIdentities().length,
      projects: listProjects().length,
      nodeProcesses: processes.filter(p => /node/i.test(p.name || "")).length,
      claudeProcesses: processes.filter(p => /claude/i.test(`${p.name || ""} ${p.commandLine || ""}`)).length,
    },
    processes,
    performanceBudgets: {
      coldStartInteractiveMs: 3000,
      warmStartInteractiveMs: 1500,
      projectIndexBudgetMs: 500,
      usageCacheTtlMs: USAGE_CACHE_TTL_MS,
      idleRunnerTtlMs: 2500,
      expectedClaudeProcessesAfterRun: 0,
    },
    recentErrors: payload.errors || {},
  };
}

function execFileJson(command, args = [], timeoutMs = 6000) {
  return new Promise(resolve => {
    execFile(command, args, { windowsHide: true, timeout: timeoutMs, encoding: "utf8" }, (_err, stdout) => {
      try {
        const parsed = JSON.parse(String(stdout || "[]"));
        resolve(Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []));
      } catch {
        resolve([]);
      }
    });
  });
}

async function listRelevantProcesses() {
  if (process.platform !== "win32") return [];
  const script = [
    "Get-CimInstance Win32_Process",
    "| Where-Object { $_.Name -match 'node|claude|msedgewebview2|claude-code-studio' -or $_.CommandLine -match 'backend-host|claude-code' }",
    "| Select-Object ProcessId,ParentProcessId,Name,CommandLine,WorkingSetSize",
    "| ConvertTo-Json -Depth 3",
  ].join(" ");
  const rows = await execFileJson("powershell", ["-NoProfile", "-Command", script]);
  return rows.map(row => ({
    pid: Number(row.ProcessId || 0),
    parentPid: Number(row.ParentProcessId || 0),
    name: row.Name || "",
    commandLine: sanitizeCommandLine(row.CommandLine || ""),
    workingSetMb: Math.round(Number(row.WorkingSetSize || 0) / 1024 / 1024),
  })).filter(row => row.pid);
}

function sanitizeCommandLine(value) {
  return String(value || "")
    .replace(/(api[_-]?key|token|authorization|password|secret)=\S+/ig, "$1=<redacted>")
    .slice(0, 500);
}
