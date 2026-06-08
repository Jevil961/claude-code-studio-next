import { spawn, execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { buildArgs, promptForMode, streamInput } from "./claudeArgs.js";
import { emitRenderer } from "../event-bus.js";

const isWindows = process.platform === "win32";
const activeRuns = new Map();
const runners = new Map();
const RUNNER_IDLE_TTL_MS = 2500;

// Claude 路径缓存
const CACHE_DIR = join(homedir(), ".claude-code-studio");
const CACHE_FILE = join(CACHE_DIR, "claude-path-cache.json");
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24小时

function readCache() {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    const data = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
    if (!data.path || !data.ts || Date.now() - data.ts > CACHE_TTL) return null;
    if (!existsSync(data.path)) return null;
    return data.path;
  } catch { return null; }
}

function writeCache(path) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ path, ts: Date.now() }), "utf8");
  } catch {}
}

function execFileText(cmd, args = [], opts = {}) {
  return new Promise(r => {
    execFile(cmd, args, { windowsHide: true, timeout: 6000, env: toolEnv(), ...opts }, (e, so, se) => {
      r({ ok: !e, stdout: String(so || "").trim(), stderr: String(se || "").trim(), error: e?.message || "" });
    });
  });
}

function toolPathDirs() {
  const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
  const localAppData = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  if (!isWindows) {
    return [
      join(homedir(), ".local", "bin"),
      join(homedir(), ".npm-global", "bin"),
      join(homedir(), ".yarn", "bin"),
      join(homedir(), ".config", "yarn", "global", "node_modules", ".bin"),
      join(homedir(), ".bun", "bin"),
      ...versionedNodeBins(),
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
    ].filter(p => existsSync(p));
  }
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  return [
    join(appData, "npm"),
    join(localAppData, "Programs", "nodejs"),
    join(programFiles, "nodejs"),
    join(programFilesX86, "nodejs"),
    ...driveNodeRoots(),
    join(homedir(), ".local", "bin"),
  ].filter(p => existsSync(p));
}

function versionedNodeBins() {
  const bins = [];
  const nvmRoot = process.env.NVM_DIR || join(homedir(), ".nvm");
  const nvmVersions = join(nvmRoot, "versions", "node");
  try {
    if (existsSync(nvmVersions)) {
      for (const version of readdirSync(nvmVersions)) {
        bins.push(join(nvmVersions, version, "bin"));
      }
    }
  } catch {}
  bins.push(
    join(homedir(), ".asdf", "shims"),
    join(homedir(), ".volta", "bin"),
    join(homedir(), "Library", "pnpm"),
  );
  return bins.filter(p => existsSync(p));
}

let _cachedDriveRoots = null;
function driveNodeRoots() {
  if (!isWindows) return [];
  if (_cachedDriveRoots) return _cachedDriveRoots;
  const roots = [];
  for (let code = 67; code <= 90; code++) {
    roots.push(`${String.fromCharCode(code)}:\\Nodejs`);
    roots.push(`${String.fromCharCode(code)}:\\nodejs`);
    roots.push(`${String.fromCharCode(code)}:\\Node`);
    roots.push(`${String.fromCharCode(code)}:\\node`);
  }
  _cachedDriveRoots = roots;
  return roots;
}

function toolEnv(extra = {}) {
  const sep = isWindows ? ";" : ":";
  const path = [...toolPathDirs(), process.env.Path || process.env.PATH || ""].filter(Boolean).join(sep);
  return isWindows ? { ...process.env, Path: path, PATH: path, ...extra } : { ...process.env, PATH: path, ...extra };
}

async function whereAll(name) {
  const f = isWindows ? "where" : "which";
  const r = await execFileText(f, [name]);
  return r.ok ? r.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean) : [];
}

export async function findClaude() {
  // 先检查缓存
  const cached = readCache();
  if (cached) return cached;

  const candidates = [...findClaudeCandidates()];
  for (const n of ["claude.cmd", "claude.exe", "claude"]) {
    candidates.push(...await whereAll(n));
  }
  for (const c of candidates) {
    if (!c) continue;
    if (/[\\/]/.test(c) && !existsSync(c)) continue;
    writeCache(c);
    return c;
  }
  return "";
}

export function findClaudeCandidates() {
  const candidates = [];
  if (isWindows) {
    candidates.push(
      join(homedir(), ".local", "bin", "claude.exe"),
      join(homedir(), ".local", "bin", "claude.cmd"),
      join(homedir(), "AppData", "Roaming", "npm", "claude.cmd"),
      join(homedir(), "AppData", "Roaming", "npm", "claude.exe"),
    );
  } else {
    candidates.push(
      join(homedir(), ".local", "bin", "claude"),
      join(homedir(), ".npm-global", "bin", "claude"),
      join(homedir(), ".yarn", "bin", "claude"),
      join(homedir(), ".config", "yarn", "global", "node_modules", ".bin", "claude"),
      join(homedir(), ".bun", "bin", "claude"),
      ...versionedNodeBins().map(dir => join(dir, "claude")),
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude",
      "/usr/bin/claude",
    );
  }
  return candidates;
}

export function findClaudeSync() {
  // 先检查缓存
  const cached = readCache();
  if (cached) return cached;

  for (const c of findClaudeCandidates()) {
    if (c && existsSync(c)) { writeCache(c); return c; }
  }
  for (const n of ["claude.cmd", "claude.exe", "claude"]) {
    try {
      const out = execFileSync(isWindows ? "where" : "which", [n], { windowsHide: true, timeout: 1000, encoding: "utf8", env: toolEnv() });
      const hit = String(out || "").split(/\r?\n/).map(l => l.trim()).find(Boolean);
      if (hit) { writeCache(hit); return hit; }
    } catch {}
  }
  return "";
}

export async function checkClaude(preferred = "") {
  const claudePath = preferred && existsSync(preferred) ? preferred : findClaudeSync() || await findClaude();
  const result = { ok: Boolean(claudePath), claudePath, version: "", error: "" };
  if (!claudePath) { result.error = "未找到 Claude Code"; return result; }
  const version = await execFileText(claudePath, ["--version"], { timeout: 3500 });
  result.version = version.stdout || version.stderr || "";
  result.ok = version.ok || Boolean(result.version);
  result.error = version.ok ? "" : version.error || version.stderr;
  return result;
}

export async function resolveClaude(preferred) {
  if (preferred && (!/[\\/]/.test(preferred) || existsSync(preferred))) return preferred;
  return await findClaude() || "claude";
}

function resolveCwd(cwd) {
  return [cwd, homedir(), process.env.USERPROFILE].find(c => c && existsSync(c)) || process.cwd();
}

function sendToRenderer(runId, channel, payload = {}) {
  emitRenderer(channel, { runId, ...payload });
}

function killProcessTree(pid, child = null) {
  if (!pid && !child) return;
  if (isWindows && pid) execFileText("taskkill", ["/PID", String(pid), "/T", "/F"]);
  else child?.kill?.("SIGTERM");
}

function contentFromEvent(e) {
  if (!e) return "";
  if (e.type === "assistant") {
    const c = e.message?.content || e.content || [];
    if (Array.isArray(c)) return c.map(p => p.text || "").filter(Boolean).join("");
  }
  if (e.type === "text" && typeof e.text === "string") return e.text;
  if (e.delta?.text) return e.delta.text;
  return "";
}

function isPartial(e) {
  if (!e || e.type !== "assistant") return false;
  return contentFromEvent(e) && (e.partial === true || e.isPartial === true || e.message?.stop_reason == null);
}

function activityFromEvent(e) {
  if (!e || e.type !== "assistant") return "";
  const c = e.message?.content || e.content || [];
  if (!Array.isArray(c)) return "";
  const tool = c.find(p => p?.type === "tool_use");
  if (tool) return `工具：${tool.name || "?"}`;
  const thought = thinkingFromEvent(e);
  if (thought) return `思考：${thought}`;
  if (c.some(p => p?.type === "thinking")) return "正在梳理上下文与下一步";
  return "";
}

function summaryFromEvent(e) {
  if (!e) return "";
  if (e.type === "system" && e.subtype === "init") return "已进入工作区";
  if (e.type === "assistant") {
    const c = e.message?.content || e.content || [];
    if (!Array.isArray(c)) return "";
    if (c.some(p => p?.type === "tool_use")) return "调用工具";
    const thought = thinkingFromEvent(e);
    if (thought) return `思考：${thought}`;
    if (c.some(p => p?.type === "thinking")) return "正在梳理上下文与下一步";
    if (c.some(p => p?.type === "text")) return "输出中";
  }
  if (e.type === "result") return `完成${e.duration_ms ? ` · ${(e.duration_ms / 1000).toFixed(1)}s` : ""}`;
  return "";
}

function thinkingFromEvent(e) {
  const c = e?.message?.content || e?.content || [];
  if (!Array.isArray(c)) return "";
  const part = c.find(p => p?.type === "thinking");
  const text = part?.thinking || part?.text || part?.content || part?.summary || "";
  return String(text || "").trim().replace(/\s+/g, " ").slice(0, 180);
}

class Runner {
  constructor(key, payload) {
    this.key = key; this.payload = payload; this.child = null;
    this.currentRunId = ""; this.busy = false; this.stdoutBuf = ""; this.stderrBuf = "";
    this.startedAt = 0; this.lastUsedAt = Date.now();
    this.status = "idle"; this.lastError = "";
    this.retryCount = 0; this.maxRetries = 3; this.retryDelay = 1000;
    this.finished = false; // 防止重复发送 done
    this.idleTimer = null;
  }

  emitStatus(status, progress, extra = {}) {
    this.status = status;
    if (this.currentRunId) sendToRenderer(this.currentRunId, "claude:event", { event: { type: "status", status }, status, progress, ...extra });
  }

  start() {
    if (this.child && !this.child.killed) return;
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    const cmd = this.payload.claudePath || "claude";
    const args = buildArgs({ ...this.payload, persistent: true });
    this.startedAt = Date.now();
    this.finished = false;
    this._exiting = false;
    const cwd = resolveCwd(this.payload.cwd);
    this.payload.effectiveCwd = cwd;
    const opts = { cwd, env: toolEnv({ ComSpec: process.env.ComSpec || join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe") }), windowsHide: true };
    if (isWindows && !/\.(exe|com)$/i.test(cmd)) opts.shell = true;
    this.child = spawn(cmd, args, opts);
    this.status = "starting";
    this.child.stdout.on("data", c => this.onStdout(c));
    this.child.stderr.on("data", c => this.onStderr(c));
    this.child.on("error", e => this.onExit(-1, e));
    this.child.on("close", c => this.onExit(c, null));
  }

  send(newPayload) {
    if (this.busy) return { ok: false, error: "当前 Runner 正忙，请等当前任务结束后再发送。", busy: true };
    this.payload = { ...this.payload, ...newPayload };
    const { runId, prompt } = this.payload;
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    this.start();
    if (!this.child?.stdin?.writable) return { ok: false, error: "Runner not writable", fallback: true };
    this.busy = true; this.currentRunId = runId; this.stderrBuf = ""; this.lastUsedAt = Date.now();
    this.finished = false; this._exiting = false;
    activeRuns.set(runId, this);
    this.emitStatus(Date.now() - this.startedAt < 1500 ? "starting" : "running", Date.now() - this.startedAt < 1500 ? "准备上下文" : "继续处理");
    this.child.stdin.write(streamInput(prompt, this.payload.permissionMode));
    return { ok: true };
  }

  stop() {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    this.finished = true;
    if (this.child?.pid) {
      killProcessTree(this.child.pid, this.child);
    }
    if (this.currentRunId) activeRuns.delete(this.currentRunId);
    this.status = "stopped";
    this.busy = false; this.currentRunId = ""; runners.delete(this.key);
  }

  onStdout(chunk) {
    this.stdoutBuf += chunk.toString("utf8");
    const lines = this.stdoutBuf.split(/\r?\n/); this.stdoutBuf = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let event; try { event = JSON.parse(line); } catch { continue; }
      const rid = this.currentRunId; if (!rid) continue;
      // 检测 AskUserQuestion 工具调用（auto 模式权限确认）
      if (event.type === "assistant") {
        const content = event.message?.content || [];
        const askTool = content.find(p => p.type === "tool_use" && p.name === "AskUserQuestion");
        if (askTool) {
          sendToRenderer(rid, "claude:askUser", { toolUseId: askTool.id, questions: askTool.input?.questions || [] });
          continue;
        }
      }
      const text = contentFromEvent(event);
      if (text && this.status !== "streaming") this.status = "streaming";
      sendToRenderer(rid, "claude:event", { raw: line, event, text, partial: isPartial(event), activity: activityFromEvent(event), progress: summaryFromEvent(event), status: this.status });
      if (event?.type === "result") this.finishRun();
    }
  }

  sendToolResult(toolUseId, content) {
    if (!this.child?.stdin?.writable) return false;
    const msg = JSON.stringify({
      type: "user", message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: toolUseId, content: [{ type: "text", text: content }] }]
      }
    }) + "\n";
    this.child.stdin.write(msg);
    return true;
  }

  onStderr(chunk) { this.stderrBuf += chunk.toString("utf8"); if (this.currentRunId) sendToRenderer(this.currentRunId, "claude:stderr", { text: chunk.toString("utf8") }); }

  finishRun() {
    if (!this.currentRunId || this.finished) return;
    this.finished = true;
    const rid = this.currentRunId; this.busy = false; this.currentRunId = ""; this.lastUsedAt = Date.now();
    this.status = "idle";
    this.retryCount = 0;
    activeRuns.delete(rid);
    sendToRenderer(rid, "claude:done", { ok: true, code: 0, stderr: this.stderrBuf, keptAlive: false });
    this.scheduleIdleStop();
  }

  scheduleIdleStop() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (!this.busy && !this.currentRunId) this.stop();
    }, RUNNER_IDLE_TTL_MS);
  }

  onExit(code, error) {
    if (this.finished || this._exiting) {
      if (this.finished) {
        this.status = "idle";
        this.busy = false; this.currentRunId = ""; runners.delete(this.key);
      }
      return;
    }
    this._exiting = true;

    // 检查是否需要重试（非正常退出且有待处理的请求）
    const shouldRetry = this.currentRunId && code !== 0 && this.retryCount < this.maxRetries;

    if (this.currentRunId) {
      if (shouldRetry) {
        this.retryCount++;
        this.status = "retrying";
        sendToRenderer(this.currentRunId, "claude:event", {
          event: { type: "retry" },
          status: "retrying",
          progress: `连接中断，正在重试 (${this.retryCount}/${this.maxRetries})...`
        });
        // 延迟后重试
        const retryRunId = this.currentRunId;
        setTimeout(() => {
          if (this.currentRunId === retryRunId && this.status === "retrying") {
            this.child = null;
            this.start();
            if (this.child?.stdin?.writable) {
              this.child.stdin.write(streamInput(this.payload.prompt, this.payload.permissionMode));
            }
          }
        }, this.retryDelay * this.retryCount);
        return;
      }

      activeRuns.delete(this.currentRunId);
      this.status = "failed";
      this.lastError = error?.message || this.stderrBuf || "";
      sendToRenderer(this.currentRunId, "claude:done", {
        ok: false, code, error: error?.message || "",
        stderr: this.stderrBuf, keptAlive: false,
        retried: this.retryCount > 0
      });
    }
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    this.busy = false; this.currentRunId = ""; runners.delete(this.key);
  }
}

function runnerKey(p) {
  return [resolveCwd(p.cwd || "").toLowerCase(), p.providerId || "", p.claudePath || "", p.sessionId || p.clientSessionKey || ""].join("::");
}

function stopIdleRunners(exceptKey = "") {
  for (const [key, runner] of runners.entries()) {
    if (key === exceptKey || runner.busy || runner.currentRunId) continue;
    runner.stop();
  }
}

export function runPersistent(payload) {
  const key = runnerKey(payload);
  stopIdleRunners(key);
  let runner = runners.get(key);
  if (!runner) { runner = new Runner(key, payload); runners.set(key, runner); }
  return runner.send(payload);
}

export function stopRun(runId) {
  const a = activeRuns.get(runId); if (!a) return { ok: false };
  if (typeof a.stop === "function") { a.stop(); return { ok: true }; }
  killProcessTree(a.pid, a);
  activeRuns.delete(runId); return { ok: true };
}

export function stopAll() {
  for (const r of runners.values()) r.stop();
  for (const a of activeRuns.values()) {
    if (typeof a.stop === "function") a.stop();
    else killProcessTree(a.pid, a);
  }
  runners.clear();
  activeRuns.clear();
  return { ok: true };
}

export function answerQuestion(runId, toolUseId, answer) {
  const r = activeRuns.get(runId);
  if (!r || typeof r.sendToolResult !== "function") return { ok: false, error: "Runner not found" };
  return { ok: r.sendToolResult(toolUseId, answer) };
}

export function listRunners() {
  return [...runners.values()].map(r => ({
    key: r.key, pid: r.child?.pid || 0, cwd: r.payload.cwd || "", effectiveCwd: r.payload.effectiveCwd || "",
    providerId: r.payload.providerId || "", claudePath: r.payload.claudePath || "claude",
    permissionMode: r.payload.permissionMode || "auto", runnerStrategy: r.payload.runnerStrategy || "seamless",
    sessionId: r.payload.sessionId || "", busy: r.busy, status: r.status, lastError: r.lastError,
    startedAt: r.startedAt, lastUsedAt: r.lastUsedAt, currentRunId: r.currentRunId,
  }));
}

export function stopByKey(key) { const r = runners.get(key); if (!r) return { ok: false }; r.stop(); return { ok: true }; }

export function spawnOnce({ runId, prompt, cwd, claudePath, mode, permissionMode, sessionId, extraArgs }) {
  const cmd = claudePath || "claude";
  const args = buildArgs({ prompt, mode, permissionMode, sessionId, extraArgs, persistent: false });
  const child = spawn(cmd, args, { cwd: resolveCwd(cwd), env: toolEnv(), windowsHide: true });
  activeRuns.set(runId, child);
  let stdoutBuf = "", stderrBuf = "";
  let finished = false;
  let resultExitTimer = null;
  const hardTimeout = setTimeout(() => {
    if (!finished) {
      killProcessTree(child.pid, child);
      complete({ ok: false, code: -1, error: "Claude process timed out", stderr: stderrBuf, keptAlive: false });
    }
  }, 30 * 60 * 1000);
  function complete(payload) {
    if (finished) return;
    finished = true;
    clearTimeout(hardTimeout);
    if (resultExitTimer) clearTimeout(resultExitTimer);
    activeRuns.delete(runId);
    sendToRenderer(runId, "claude:done", payload);
  }
  child.stdout.on("data", c => {
    stdoutBuf += c.toString("utf8"); const lines = stdoutBuf.split(/\r?\n/); stdoutBuf = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      sendToRenderer(runId, "claude:event", { raw: line, event: e, text: contentFromEvent(e), partial: isPartial(e), activity: activityFromEvent(e), progress: summaryFromEvent(e) });
      if (e?.type === "result" && !resultExitTimer) {
        resultExitTimer = setTimeout(() => {
          killProcessTree(child.pid, child);
          complete({ ok: true, code: 0, stderr: stderrBuf, keptAlive: false });
        }, 1500);
      }
    }
  });
  child.stderr.on("data", c => { stderrBuf += c.toString("utf8"); sendToRenderer(runId, "claude:stderr", { text: c.toString("utf8") }); });
  child.on("error", e => complete({ ok: false, code: -1, error: e.message, stderr: stderrBuf, keptAlive: false }));
  child.on("close", c => complete({ ok: c === 0, code: c, stderr: stderrBuf, keptAlive: false }));
}

export const testExports = { buildArgs, promptForMode, contentFromEvent };
