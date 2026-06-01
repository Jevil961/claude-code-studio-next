import { query, queryOne, run, loadJson, getClaudeSettings, saveClaudeSettings } from "./connection.js";
import { randomUUID } from "node:crypto";

function sanitize(row) {
  const cfg = loadJson(row.settings_config, {});
  const env = cfg.env || {};
  const meta = loadJson(row.meta, {});
  const base = env.ANTHROPIC_BASE_URL || "";
  let host = base;
  try { host = new URL(base).host || base; } catch {}
  return {
    id: row.id, name: row.name,
    model: env.ANTHROPIC_MODEL || env.ANTHROPIC_DEFAULT_SONNET_MODEL || env.ANTHROPIC_DEFAULT_OPUS_MODEL || "",
    baseUrl: host, category: row.category || "",
    apiFormat: meta?.apiFormat || "", current: Boolean(row.is_current),
  };
}

function applyProviderToClaudeSettings(row) {
  const cfg = loadJson(row.settings_config, {});
  const settings = getClaudeSettings();
  settings.env = { ...(settings.env || {}), ...(cfg.env || {}) };
  if (cfg.skipDangerousModePermissionPrompt !== undefined) {
    settings.skipDangerousModePermissionPrompt = cfg.skipDangerousModePermissionPrompt;
  }
  saveClaudeSettings(settings);
}

export function list() {
  return query(`SELECT id,name,settings_config,category,meta,is_current FROM providers WHERE app_type='claude' ORDER BY is_current DESC,name`).map(sanitize);
}

export function switchTo(id) {
  const row = queryOne(`SELECT id,name,settings_config,category,meta,is_current FROM providers WHERE app_type='claude' AND id=?`, [id]);
  if (!row) throw new Error("Provider not found");
  run(`UPDATE providers SET is_current=CASE WHEN id=? AND app_type='claude' THEN 1 ELSE 0 END WHERE app_type='claude'`, [id]);
  applyProviderToClaudeSettings(row);
  return { ok: true, provider: sanitize({ ...row, is_current: 1 }) };
}

export function create({ name, baseUrl, authToken, model, apiFormat, sonnetModel, opusModel, haikuModel }) {
  const id = randomUUID();
  const env = {};
  if (baseUrl) env.ANTHROPIC_BASE_URL = baseUrl;
  if (authToken) env.ANTHROPIC_AUTH_TOKEN = authToken;
  if (model) env.ANTHROPIC_MODEL = model;
  if (sonnetModel) env.ANTHROPIC_DEFAULT_SONNET_MODEL = sonnetModel;
  if (opusModel) env.ANTHROPIC_DEFAULT_OPUS_MODEL = opusModel;
  if (haikuModel) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = haikuModel;
  run(`INSERT INTO providers (id,app_type,name,settings_config,category,created_at,meta,is_current,provider_type) VALUES (?,'claude',?,?,?,?,?,0,?)`,
    [id, name, JSON.stringify({ env, skipDangerousModePermissionPrompt: true }), "", Date.now(), JSON.stringify({ apiFormat: apiFormat || "openai", commonConfigEnabled: true }), apiFormat || "openai"]);
  return { ok: true, id };
}

export function update(id, u) {
  const row = queryOne(`SELECT settings_config,meta FROM providers WHERE id=? AND app_type='claude'`, [id]);
  if (!row) throw new Error("Provider not found");
  const cfg = loadJson(row.settings_config, {}); const meta = loadJson(row.meta, {}); const env = cfg.env || {};
  if (u.name !== undefined) run(`UPDATE providers SET name=? WHERE id=? AND app_type='claude'`, [u.name, id]);
  if (u.baseUrl !== undefined) env.ANTHROPIC_BASE_URL = u.baseUrl;
  if (u.authToken !== undefined) env.ANTHROPIC_AUTH_TOKEN = u.authToken;
  if (u.model !== undefined) env.ANTHROPIC_MODEL = u.model;
  if (u.apiFormat !== undefined) meta.apiFormat = u.apiFormat;
  cfg.env = env;
  run(`UPDATE providers SET settings_config=?,meta=? WHERE id=? AND app_type='claude'`, [JSON.stringify(cfg), JSON.stringify(meta), id]);
  const current = queryOne(`SELECT is_current FROM providers WHERE id=? AND app_type='claude'`, [id]);
  if (current?.is_current) applyProviderToClaudeSettings({ settings_config: JSON.stringify(cfg) });
  return { ok: true };
}

export function remove(id) {
  const row = queryOne(`SELECT is_current FROM providers WHERE id=? AND app_type='claude'`, [id]);
  if (!row) throw new Error("Provider not found");
  run(`DELETE FROM providers WHERE id=? AND app_type='claude'`, [id]);
  if (row.is_current) { const next = queryOne(`SELECT id FROM providers WHERE app_type='claude' ORDER BY name LIMIT 1`); if (next) switchTo(next.id); }
  return { ok: true };
}

export async function testConnection(id) {
  const row = queryOne(`SELECT id,name,settings_config,meta FROM providers WHERE id=? AND app_type='claude'`, [id]);
  if (!row) throw new Error("Provider not found");
  const provider = sanitize({ ...row, is_current: 0, category: "" });
  const cfg = loadJson(row.settings_config, {});
  const env = cfg.env || {};
  const baseUrl = env.ANTHROPIC_BASE_URL || "";
  const authToken = env.ANTHROPIC_AUTH_TOKEN || "";
  const model = provider.model || "";
  const result = {
    ok: Boolean(baseUrl && authToken && model),
    provider: provider.name,
    baseUrl,
    model,
    checks: {
      baseUrl: Boolean(baseUrl),
      authToken: Boolean(authToken),
      model: Boolean(model),
      reachable: false,
    },
    status: 0,
    message: "",
  };
  if (!baseUrl) result.message = "缺少 Base URL";
  else if (!authToken) result.message = "缺少 Auth Token";
  else if (!model) result.message = "缺少模型";
  if (!baseUrl) return result;
  const startedAt = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(baseUrl, { method: "HEAD", signal: controller.signal });
    clearTimeout(timer);
    result.status = res.status;
    result.checks.reachable = true;
    result.message = result.message || `网络可达，HTTP ${res.status}`;
  } catch (e) {
    result.message = result.message || `网络探测失败：${e.message}`;
  }
  result.durationMs = Date.now() - startedAt;
  return result;
}
