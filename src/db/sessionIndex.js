import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";

export const DEFAULT_APP_DIR = join(homedir(), ".claude-code-studio");
export const DEFAULT_PROJECTS_ROOT = join(homedir(), ".claude", "projects");

function decodeProjectName(name) {
  if (name.length >= 3 && name[1] === "-" && name[2] === "-") return name[0] + ":\\" + name.slice(3).replace(/-/g, "\\");
  return name.replace(/-/g, "/");
}

function safeStat(path) {
  try { return statSync(path); } catch { return null; }
}

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
}

export function contentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter(part => part?.type === "text" || typeof part?.text === "string").map(part => part.text || "").join("\n\n");
}

export function readSessionTitle(filePath) {
  try {
    for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      if (obj?.type !== "user" || obj?.message?.role !== "user") continue;
      const text = contentToText(obj.message.content).replace(/[\r\n]+/g, " ").trim();
      if (text) return text.slice(0, 80);
    }
  } catch {}
  return "";
}

function indexPath(appDir = DEFAULT_APP_DIR) {
  return join(appDir, "session-index.json");
}

function projectIndexPath(appDir = DEFAULT_APP_DIR) {
  return join(appDir, "project-index.json");
}

export function loadSessionIndex(appDir = DEFAULT_APP_DIR) {
  const index = readJson(indexPath(appDir), { sessions: {} });
  index.sessions ||= {};
  return index;
}

export function saveSessionIndex(index, appDir = DEFAULT_APP_DIR) {
  writeJson(indexPath(appDir), { ...index, updatedAt: Date.now() });
}

export function loadProjectIndex(appDir = DEFAULT_APP_DIR) {
  const index = readJson(projectIndexPath(appDir), { projects: [], updatedAt: 0, stats: {} });
  index.projects ||= [];
  return index;
}

export function saveProjectIndex(projects, stats = {}, appDir = DEFAULT_APP_DIR) {
  writeJson(projectIndexPath(appDir), { projects, stats, updatedAt: Date.now() });
}

export function listCachedProjects(options = {}) {
  const appDir = options.appDir || DEFAULT_APP_DIR;
  const maxAgeMs = Number(options.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000);
  const index = loadProjectIndex(appDir);
  if (!index.projects.length) return [];
  if (maxAgeMs > 0 && index.updatedAt && Date.now() - index.updatedAt > maxAgeMs) return [];
  return index.projects;
}

function titleFromIndex(index, session) {
  const cached = index.sessions?.[session.id];
  if (cached?.mtimeMs === session.mtimeMs && cached.title) return cached.title;
  return cached?.title || session.id;
}

export function findSession(sessionId, options = {}) {
  const wanted = String(sessionId || "").replace(/\.jsonl$/, "");
  const root = options.projectsRoot || DEFAULT_PROJECTS_ROOT;
  if (!wanted || !existsSync(root)) return { exists: false, id: wanted, error: "No projects dir" };

  for (const projectId of readdirSync(root)) {
    const file = join(root, projectId, `${wanted}.jsonl`);
    const st = safeStat(file);
    if (!st?.isFile()) continue;
    return {
      exists: true,
      id: wanted,
      projectId,
      path: file,
      projectPath: decodeProjectName(projectId),
      updatedAt: Math.floor(st.mtimeMs / 1000),
      mtimeMs: Math.floor(st.mtimeMs),
      title: readSessionTitle(file) || wanted,
    };
  }

  return {
    exists: false,
    id: wanted,
    error: `No conversation found with session ID: ${wanted}`,
    recoverable: true,
  };
}

export function buildSessionIndex(options = {}) {
  const root = options.projectsRoot || DEFAULT_PROJECTS_ROOT;
  const appDir = options.appDir || DEFAULT_APP_DIR;
  const budgetMs = Number(options.budgetMs ?? 120);
  const maxProjects = Number(options.maxProjects ?? 80);
  const visibleSessionCount = Number(options.visibleSessionCount ?? 8);
  const titleScanCount = Number(options.titleScanCount ?? 2);
  const stopOnBudget = Boolean(options.stopOnBudget);
  const persistProjects = options.persistProjects !== false;
  const startedAt = Date.now();
  const index = loadSessionIndex(appDir);
  let changed = false;

  if (!existsSync(root)) return { projects: [], stats: { scannedProjects: 0, indexedTitles: 0, elapsedMs: 0 } };

  const projects = [];
  let scannedProjects = 0;
  let indexedTitles = 0;

  for (const name of readdirSync(root)) {
    if (stopOnBudget && Date.now() - startedAt > budgetMs) break;
    const projectDir = join(root, name);
    const projectStat = safeStat(projectDir);
    if (!projectStat?.isDirectory()) continue;
    scannedProjects++;

    const sessions = [];
    for (const fileName of readdirSync(projectDir)) {
      if (stopOnBudget && Date.now() - startedAt > budgetMs) break;
      if (!fileName.endsWith(".jsonl")) continue;
      const file = join(projectDir, fileName);
      const st = safeStat(file);
      if (!st?.isFile()) continue;
      const id = fileName.replace(/\.jsonl$/, "");
      sessions.push({
        id,
        file,
        updatedAt: Math.floor(st.mtimeMs / 1000),
        mtimeMs: Math.floor(st.mtimeMs),
        title: "",
      });
    }

    sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    const visibleSessions = sessions.slice(0, visibleSessionCount).map(session => ({
      ...session,
      title: titleFromIndex(index, session),
    }));

    for (const session of sessions.slice(0, titleScanCount)) {
      if (Date.now() - startedAt > budgetMs) break;
      const cached = index.sessions[session.id];
      if (cached?.mtimeMs === session.mtimeMs && cached.title) continue;
      const title = readSessionTitle(session.file) || session.id;
      index.sessions[session.id] = {
        title,
        mtimeMs: session.mtimeMs,
        projectId: name,
        file: session.file,
        updatedAt: session.updatedAt,
      };
      const visible = visibleSessions.find(item => item.id === session.id);
      if (visible) visible.title = title;
      changed = true;
      indexedTitles++;
    }

    projects.push({
      id: name,
      name,
      path: decodeProjectName(name),
      updatedAt: sessions[0]?.updatedAt || Math.floor(projectStat.mtimeMs / 1000),
      sessions: visibleSessions,
      sessionCount: sessions.length,
    });
  }

  if (changed) saveSessionIndex(index, appDir);

  const sortedProjects = projects.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, maxProjects);
  const stats = { scannedProjects, indexedTitles, elapsedMs: Date.now() - startedAt, partial: stopOnBudget && Date.now() - startedAt > budgetMs };
  if (persistProjects && sortedProjects.length) saveProjectIndex(sortedProjects, stats, appDir);
  return { projects: sortedProjects, stats };
}

export function readSessionMessages(sessionId, options = {}) {
  const found = findSession(sessionId, options);
  if (!found.exists) return { ...found, messages: [] };

  const messages = [];
  try {
    for (const line of readFileSync(found.path, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      const msg = obj?.message;
      if (!msg || (msg.role !== "user" && msg.role !== "assistant")) continue;
      const text = contentToText(msg.content).trim();
      if (!text) continue;
      const item = { role: msg.role, content: text, timestamp: obj.timestamp || "" };
      if (messages.length && messages[messages.length - 1].role === msg.role) messages[messages.length - 1].content += "\n\n" + text;
      else messages.push(item);
    }
  } catch (error) {
    return { ...found, exists: false, recoverable: true, messages: [], error: error.message };
  }

  return { ...found, messages };
}

export function projectNameFromPluginRoot(root) {
  return basename(dirname(root));
}
