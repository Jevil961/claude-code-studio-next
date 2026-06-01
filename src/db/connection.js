import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { backupClaudeSettings } from "./backup.js";

const require = createRequire(import.meta.url);
const initSqlJs = require("sql.js/dist/sql-asm.js");

const ROOT = join(homedir(), ".cc-switch");
const DB_PATH = join(ROOT, "cc-switch.db");
const CLAUDE_SETTINGS = join(homedir(), ".claude", "settings.json");

let db = null;
let dbPromise = null;
let dbPath = process.env.CCSWITCH_DB_PATH || DB_PATH;
let claudeSettingsPath = process.env.CLAUDE_SETTINGS_PATH || CLAUDE_SETTINGS;

// 写入锁，防止并发写入
let persistLock = false;
let persistQueued = false;

export async function getDb() {
  if (db) return db;
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
  const SQL = await initSqlJs();
  mkdirSync(dirname(dbPath), { recursive: true });
  db = existsSync(dbPath) ? new SQL.Database(readFileSync(dbPath)) : new SQL.Database();
  initializeSchema();
  persist();
  return db;
  })();
  return dbPromise;
}

function initializeSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      app_type TEXT NOT NULL DEFAULT 'claude',
      name TEXT NOT NULL,
      settings_config TEXT NOT NULL DEFAULT '{}',
      category TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0,
      meta TEXT NOT NULL DEFAULT '{}',
      is_current INTEGER NOT NULL DEFAULT 0,
      provider_type TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      directory TEXT NOT NULL UNIQUE,
      enabled_claude INTEGER NOT NULL DEFAULT 1,
      installed_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      server_config TEXT NOT NULL DEFAULT '{}',
      description TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      enabled_claude INTEGER NOT NULL DEFAULT 1
    );
  `);
}

export function setDbForTest(nextDb, nextPath = null, nextClaudeSettingsPath = null) {
  db = nextDb;
  dbPromise = nextDb ? Promise.resolve(nextDb) : null;
  if (nextPath) dbPath = nextPath;
  if (nextClaudeSettingsPath) claudeSettingsPath = nextClaudeSettingsPath;
}

export function query(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

export function queryOne(sql, params = []) {
  return query(sql, params)[0] || null;
}

export function persist() {
  if (!db) return;
  // 如果已有写入在进行中，标记为需要再次写入
  if (persistLock) { persistQueued = true; return; }
  persistLock = true;
  try {
    mkdirSync(dirname(dbPath), { recursive: true });
    // 直接写入目标文件，避免 Windows 上 rename 的 EPERM 问题
    writeFileSync(dbPath, Buffer.from(db.export()));
  } finally {
    persistLock = false;
    // 如果有排队的写入请求，执行之
    if (persistQueued) {
      persistQueued = false;
      persist();
    }
  }
}

export function run(sql, params = []) {
  db.run(sql, params);
  persist();
}

export function loadJson(v, def) { try { return JSON.parse(v || ""); } catch { return def; } }

export function deepMerge(a, b) {
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object") out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

export function getClaudeSettings() { return loadJson(existsSync(claudeSettingsPath) ? readFileSync(claudeSettingsPath, "utf8") : "{}", {}); }

export function saveClaudeSettings(data) {
  backupClaudeSettings();
  mkdirSync(dirname(claudeSettingsPath), { recursive: true });
  writeFileSync(claudeSettingsPath, JSON.stringify(data, null, 2), "utf8");
}

export const PATHS = { ROOT, DB_PATH, CLAUDE_SETTINGS, CC_SKILLS: join(ROOT, "skills"), CLAUDE_SKILLS: join(homedir(), ".claude", "skills") };
