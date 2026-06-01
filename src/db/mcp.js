import { existsSync, readFileSync } from "node:fs";
import { query, run, loadJson, getClaudeSettings, saveClaudeSettings } from "./connection.js";
import { randomUUID } from "node:crypto";

export function list() {
  return query(`SELECT id,name,server_config,description,tags,enabled_claude FROM mcp_servers ORDER BY enabled_claude DESC,LOWER(name)`).map(r => {
    const cfg = loadJson(r.server_config, {});
    return { id: r.id, name: r.name, description: r.description || "", config: cfg, command: cfg.command || cfg.url || cfg.type || "", tags: loadJson(r.tags, []), enabledClaude: Boolean(r.enabled_claude) };
  });
}

export function sync() {
  const rows = query(`SELECT name,server_config FROM mcp_servers WHERE enabled_claude=1`);
  const servers = {}; for (const r of rows) servers[r.name] = loadJson(r.server_config, {});
  const settings = getClaudeSettings(); settings.mcpServers = servers; saveClaudeSettings(settings);
  return { ok: true, count: Object.keys(servers).length };
}

export function previewSync() {
  const rows = query(`SELECT name,server_config,enabled_claude FROM mcp_servers ORDER BY LOWER(name)`);
  const settings = getClaudeSettings();
  const current = settings.mcpServers || {};
  const enabled = rows.filter(r => Boolean(r.enabled_claude)).map(r => ({ name: r.name, config: loadJson(r.server_config, {}) }));
  const enabledNames = new Set(enabled.map(r => r.name));
  const remove = Object.keys(current).filter(name => !enabledNames.has(name));
  const add = enabled.filter(r => !current[r.name]).map(r => r.name);
  const update = enabled.filter(r => current[r.name] && JSON.stringify(current[r.name]) !== JSON.stringify(r.config)).map(r => r.name);
  return { enabled: enabled.length, add, update, remove };
}

export function setEnabled(id, enabled) { run(`UPDATE mcp_servers SET enabled_claude=? WHERE id=?`, [enabled ? 1 : 0, id]); return sync(); }

export function add(name, configJson) {
  const cfg = loadJson(configJson, null); if (!cfg || typeof cfg !== "object") throw new Error("Invalid JSON");
  const mid = name.trim().toLowerCase().replace(/\s+/g, "-") || randomUUID();
  run(`INSERT OR REPLACE INTO mcp_servers (id,name,server_config,tags,enabled_claude) VALUES (?,?,?,'[]',1)`, [mid, name, JSON.stringify(cfg)]);
  return sync();
}

export function update(id, u) {
  if (u.name !== undefined) run(`UPDATE mcp_servers SET name=? WHERE id=?`, [u.name, id]);
  if (u.config !== undefined) run(`UPDATE mcp_servers SET server_config=? WHERE id=?`, [JSON.stringify(u.config), id]);
  return { ok: true };
}

export function remove(id) { run(`DELETE FROM mcp_servers WHERE id=?`, [id]); return sync(); }

export function importFile(path) {
  if (!existsSync(path)) throw new Error("File not found");
  const data = loadJson(readFileSync(path, "utf8"), null); if (!data) throw new Error("Invalid JSON");
  const servers = data.mcpServers || data; if (typeof servers !== "object") throw new Error("No mcpServers");
  for (const [name, cfg] of Object.entries(servers)) {
    if (typeof cfg !== "object") continue;
    const mid = name.trim().toLowerCase().replace(/\s+/g, "-") || randomUUID();
    run(`INSERT OR REPLACE INTO mcp_servers (id,name,server_config,tags,enabled_claude) VALUES (?,?,?,'[]',1)`, [mid, name, JSON.stringify(cfg)]);
  }
  return sync();
}
