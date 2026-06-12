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
    baseUrl: base, baseHost: host, category: row.category || "",
    apiFormat: meta?.apiFormat || "", current: Boolean(row.is_current),
  };
}

function providerConfigFromRow(row) {
  const cfg = loadJson(row.settings_config, {});
  const meta = loadJson(row.meta, {});
  const env = cfg.env || {};
  return {
    id: row.id,
    name: row.name,
    apiFormat: meta.apiFormat || row.provider_type || "openai",
    baseUrl: env.ANTHROPIC_BASE_URL || "",
    authToken: env.ANTHROPIC_AUTH_TOKEN || "",
    model: env.ANTHROPIC_MODEL || env.ANTHROPIC_DEFAULT_SONNET_MODEL || env.ANTHROPIC_DEFAULT_OPUS_MODEL || env.ANTHROPIC_DEFAULT_HAIKU_MODEL || "",
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

export function resolveForRuntime(id = "") {
  const row = id
    ? queryOne(`SELECT id,name,settings_config,category,meta,is_current FROM providers WHERE app_type='claude' AND id=?`, [id])
    : queryOne(`SELECT id,name,settings_config,category,meta,is_current FROM providers WHERE app_type='claude' ORDER BY is_current DESC,name LIMIT 1`);
  if (!row) throw new Error("Provider not found");
  return providerConfigFromRow(row);
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
  const row = queryOne(`SELECT name,settings_config,meta FROM providers WHERE id=? AND app_type='claude'`, [id]);
  if (!row) throw new Error("Provider not found");
  const cfg = loadJson(row.settings_config, {}); const meta = loadJson(row.meta, {}); const env = cfg.env || {};
  const name = u.name !== undefined ? u.name : row.name;
  if (u.baseUrl !== undefined) env.ANTHROPIC_BASE_URL = u.baseUrl;
  if (u.authToken !== undefined) env.ANTHROPIC_AUTH_TOKEN = u.authToken;
  if (u.model !== undefined) env.ANTHROPIC_MODEL = u.model;
  if (u.apiFormat !== undefined) meta.apiFormat = u.apiFormat;
  cfg.env = env;
  run(`UPDATE providers SET name=?,settings_config=?,meta=? WHERE id=? AND app_type='claude'`, [name, JSON.stringify(cfg), JSON.stringify(meta), id]);
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

const MODEL_DISCOVERY_TIMEOUT_MS = 6500;
const MODEL_PROBE_TIMEOUT_MS = 9000;

function normalizeBaseUrl(baseUrl = "") {
  const raw = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  const url = new URL(raw);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Base URL must start with http:// or https://");
  return url.toString().replace(/\/+$/, "");
}

function appendApiPath(baseUrl, path) {
  const base = normalizeBaseUrl(baseUrl);
  const suffix = String(path || "").replace(/^\/+/, "");
  return `${base}/${suffix}`;
}

function versionedBaseUrl(provider = {}) {
  const base = normalizeBaseUrl(provider.baseUrl);
  if (provider.apiFormat === "anthropic" && !/\/v\d+(?:beta)?$/i.test(base)) return `${base}/v1`;
  return base;
}

function geminiModelPath(model = "") {
  const clean = String(model || "").trim().replace(/^models\//, "");
  return `models/${clean.split("/").map(part => encodeURIComponent(part)).join("/")}`;
}

function modelListRequest(provider = {}) {
  const apiFormat = provider.apiFormat || "openai";
  if (apiFormat === "gemini") {
    const url = new URL(appendApiPath(provider.baseUrl, "models"));
    if (provider.authToken) url.searchParams.set("key", provider.authToken);
    return { url: url.toString(), init: { method: "GET", headers: providerAuthHeaders(provider) } };
  }
  return {
    url: appendApiPath(versionedBaseUrl(provider), "models"),
    init: { method: "GET", headers: providerAuthHeaders(provider) },
  };
}

function modelProbeRequest(provider = {}) {
  const apiFormat = provider.apiFormat || "openai";
  const headers = providerAuthHeaders(provider, true);
  if (apiFormat === "anthropic") {
    return {
      url: appendApiPath(versionedBaseUrl(provider), "messages"),
      init: {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: provider.model,
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        }),
      },
    };
  }
  if (apiFormat === "gemini") {
    const url = new URL(appendApiPath(provider.baseUrl, `${geminiModelPath(provider.model)}:generateContent`));
    if (provider.authToken) url.searchParams.set("key", provider.authToken);
    return {
      url: url.toString(),
      init: {
        method: "POST",
        headers,
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "ping" }] }],
          generationConfig: { maxOutputTokens: 1 },
        }),
      },
    };
  }
  return {
    url: appendApiPath(provider.baseUrl, "chat/completions"),
    init: {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: provider.model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false,
      }),
    },
  };
}

function providerAuthHeaders(provider = {}, hasBody = false) {
  const apiFormat = provider.apiFormat || "openai";
  const headers = { accept: "application/json" };
  if (hasBody) headers["content-type"] = "application/json";
  if (!provider.authToken) return headers;
  if (apiFormat === "anthropic") {
    headers["x-api-key"] = provider.authToken;
    headers["anthropic-version"] = "2023-06-01";
  } else if (apiFormat === "gemini") {
    headers["x-goog-api-key"] = provider.authToken;
  } else {
    headers.authorization = `Bearer ${provider.authToken}`;
  }
  return headers;
}

function responseMessage(data, text = "") {
  const raw = data?.error?.message || data?.message || data?.error || text || "";
  if (typeof raw === "object") return JSON.stringify(raw).slice(0, 400);
  return String(raw).slice(0, 400);
}

function normalizeModelId(value = "") {
  return String(value || "").trim().replace(/^models\//, "");
}

function normalizeModelItems(data, apiFormat = "openai") {
  const source = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.models) ? data.models : (Array.isArray(data) ? data : []));
  const seen = new Set();
  const models = [];
  for (const item of source) {
    if (apiFormat === "gemini" && Array.isArray(item?.supportedGenerationMethods) && !item.supportedGenerationMethods.includes("generateContent")) continue;
    const rawId = typeof item === "string" ? item : (item?.id || item?.name || item?.model || item?.displayName || "");
    const id = normalizeModelId(rawId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name = typeof item === "string"
      ? id
      : (item.display_name || item.displayName || normalizeModelId(item.name) || item.id || id);
    models.push({
      id,
      name,
      ownedBy: item?.owned_by || item?.owner || "",
      inputTokenLimit: item?.inputTokenLimit || item?.input_token_limit || null,
      outputTokenLimit: item?.outputTokenLimit || item?.output_token_limit || null,
    });
  }
  return models;
}

async function fetchJsonWithTimeout(url, init = {}, timeoutMs = MODEL_DISCOVERY_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const status = Number(res?.status || 0);
    const ok = typeof res?.ok === "boolean" ? res.ok : (status >= 200 && status < 300);
    let text = "";
    let data = null;
    try {
      if (typeof res?.text === "function") text = await res.text();
      else if (typeof res?.json === "function") data = await res.json();
    } catch {}
    if (!data && text) {
      try { data = JSON.parse(text); } catch {}
    }
    return { ok, status, data, text };
  } finally {
    clearTimeout(timer);
  }
}

function providerIssueCategory({ baseUrl, authToken, model, status, error = "", aborted = false }) {
  const msg = String(error || "").toLowerCase();
  if (!baseUrl) return "missing_base_url";
  if (!authToken) return "missing_auth_token";
  if (!model) return "missing_model";
  if (status === 401 || status === 403) return "auth_failed";
  if (status === 400 && /model|does not exist|not found|invalid_model|unsupported/.test(msg)) return "model_not_found";
  if (status === 400) return "bad_request";
  if (status === 404 && /model|does not exist|not found|invalid_model/.test(msg)) return "model_not_found";
  if (status === 404) return "bad_base_url";
  if (status === 405 || status === 501) return "models_unavailable";
  if (status === 408 || status === 429 || status >= 500) return "provider_unavailable";
  if (aborted || /abort|timeout|timed out/.test(msg)) return "timeout";
  if (/proxy|tunnel|certificate|cert|self-signed|unable to verify/.test(msg)) return "proxy_or_tls";
  if (/enotfound|getaddrinfo|econnrefused|econnreset|network|fetch failed/.test(msg)) return "network";
  if (/invalid url|base url|url must|unsupported protocol/.test(msg)) return "bad_base_url";
  if (status >= 200 && status < 500) return "";
  return msg ? "unknown" : "";
}

function providerIssueAdvice(category) {
  const map = {
    missing_base_url: "填写 Provider 的 Base URL，必须以 http:// 或 https:// 开头。",
    missing_auth_token: "填写 API Key/Auth Token 后再测试。",
    missing_model: "选择预设模型，或在手动模型里填写服务商支持的模型 ID。",
    auth_failed: "API Key 无效或权限不足。请重新生成 Key，并确认账号已开通该模型。",
    bad_base_url: "Base URL 路径可能不正确。请使用服务商文档里的根 API 地址。",
    bad_request: "服务商拒绝了测试请求。请核对 API 格式、Base URL 路径和该模型的调用方式。",
    model_not_found: "当前模型 ID 不存在或账号无权使用。请先自动获取模型，再选择返回列表里的模型。",
    model_not_listed: "模型列表没有返回当前模型。请优先选择自动获取到的模型，或确认它是隐藏/私有模型。",
    models_empty: "模型列表接口可访问，但没有返回可用模型。请确认账号权限或换一个 API Key。",
    models_unavailable: "该服务商没有开放模型列表接口，已继续用轻量请求验证默认模型。",
    provider_unavailable: "服务商返回限流或服务异常。稍后重试，或切换 Provider/代理。",
    timeout: "连接超时。请检查网络、代理或防火墙，并确认服务商在当前网络可访问。",
    proxy_or_tls: "代理或证书校验失败。请检查系统代理、公司证书或 HTTPS 拦截设置。",
    network: "网络不可达。请检查 DNS、代理、VPN、防火墙或 Base URL 域名。",
    unknown: "连接测试没有得到明确分类。请复制诊断摘要并查看服务商返回信息。",
  };
  return map[category] || "";
}

function invalidConfigResult(provider, requireModel = false) {
  const category = !provider.baseUrl
    ? "missing_base_url"
    : (!provider.authToken ? "missing_auth_token" : (requireModel && !provider.model ? "missing_model" : ""));
  if (!category) return null;
  return {
    ok: false,
    status: 0,
    message: category === "missing_base_url" ? "缺少 Base URL" : (category === "missing_auth_token" ? "缺少 Auth Token" : "缺少模型"),
    category,
    advice: providerIssueAdvice(category),
  };
}

export async function discoverModels(input = {}) {
  const provider = {
    name: input.name || "Provider",
    baseUrl: input.baseUrl || "",
    authToken: input.authToken || "",
    apiFormat: input.apiFormat || "openai",
    model: input.model || "__model_discovery__",
  };
  const startedAt = Date.now();
  const result = {
    ok: false,
    source: "remote",
    provider: provider.name,
    baseUrl: provider.baseUrl,
    apiFormat: provider.apiFormat,
    endpoint: "",
    models: [],
    modelCount: 0,
    status: 0,
    message: "",
    category: "",
    advice: "",
    durationMs: 0,
  };
  const invalid = invalidConfigResult(provider, false);
  if (invalid) return { ...result, ...invalid, durationMs: Date.now() - startedAt };

  try {
    const request = modelListRequest(provider);
    result.endpoint = request.url;
    const res = await fetchJsonWithTimeout(request.url, request.init, MODEL_DISCOVERY_TIMEOUT_MS);
    const message = responseMessage(res.data, res.text);
    result.status = res.status;
    if (!res.ok) {
      result.category = providerIssueCategory({ ...provider, status: res.status, error: message });
      if (result.category === "bad_base_url" && (res.status === 404 || res.status === 405 || res.status === 501)) result.category = "models_unavailable";
      result.advice = providerIssueAdvice(result.category);
      result.message = message || `模型列表获取失败，HTTP ${res.status || 0}`;
      return result;
    }
    const models = normalizeModelItems(res.data, provider.apiFormat);
    result.models = models;
    result.modelCount = models.length;
    result.ok = models.length > 0;
    result.category = result.ok ? "" : "models_empty";
    result.advice = providerIssueAdvice(result.category);
    result.message = result.ok ? `已获取 ${models.length} 个模型` : "模型列表为空";
    return result;
  } catch (e) {
    result.category = providerIssueCategory({ ...provider, error: e?.message || String(e), aborted: e?.name === "AbortError" });
    if (result.category === "missing_model") result.category = "unknown";
    result.advice = providerIssueAdvice(result.category);
    result.message = `模型列表获取失败：${e?.message || String(e)}`;
    return result;
  } finally {
    result.durationMs = Date.now() - startedAt;
  }
}

export async function probeProviderModel(input = {}) {
  const provider = {
    name: input.name || "Provider",
    baseUrl: input.baseUrl || "",
    authToken: input.authToken || "",
    apiFormat: input.apiFormat || "openai",
    model: input.model || "",
  };
  const startedAt = Date.now();
  const result = {
    ok: false,
    provider: provider.name,
    baseUrl: provider.baseUrl,
    apiFormat: provider.apiFormat,
    model: provider.model,
    endpoint: "",
    status: 0,
    message: "",
    category: "",
    advice: "",
    durationMs: 0,
  };
  const invalid = invalidConfigResult(provider, true);
  if (invalid) return { ...result, ...invalid, durationMs: Date.now() - startedAt };

  try {
    const request = modelProbeRequest(provider);
    result.endpoint = request.url;
    const res = await fetchJsonWithTimeout(request.url, request.init, MODEL_PROBE_TIMEOUT_MS);
    const message = responseMessage(res.data, res.text);
    result.status = res.status;
    result.ok = res.ok;
    result.category = res.ok ? "" : providerIssueCategory({ ...provider, status: res.status, error: message });
    result.advice = providerIssueAdvice(result.category);
    result.message = res.ok ? `模型轻量请求通过，HTTP ${res.status || 200}` : (message || `模型轻量请求失败，HTTP ${res.status || 0}`);
    return result;
  } catch (e) {
    result.category = providerIssueCategory({ ...provider, error: e?.message || String(e), aborted: e?.name === "AbortError" });
    result.advice = providerIssueAdvice(result.category);
    result.message = `模型轻量请求失败：${e?.message || String(e)}`;
    return result;
  } finally {
    result.durationMs = Date.now() - startedAt;
  }
}

export async function fetchModels(input = {}) {
  const provider = input.providerId || input.id ? resolveForRuntime(input.providerId || input.id) : input;
  return discoverModels(provider);
}

export async function testConnection(id) {
  const row = queryOne(`SELECT id,name,settings_config,meta FROM providers WHERE id=? AND app_type='claude'`, [id]);
  if (!row) throw new Error("Provider not found");
  const provider = sanitize({ ...row, is_current: 0, category: "" });
  const runtimeProvider = providerConfigFromRow(row);
  const baseUrl = runtimeProvider.baseUrl || "";
  const authToken = runtimeProvider.authToken || "";
  const model = runtimeProvider.model || "";
  const result = {
    ok: Boolean(baseUrl && authToken && model),
    provider: provider.name,
    baseUrl,
    model,
    checks: {
      baseUrl: Boolean(baseUrl),
      authToken: Boolean(authToken),
      model: Boolean(model),
      modelsEndpoint: false,
      modelListed: false,
      liveRequest: false,
    },
    models: [],
    modelCount: 0,
    modelDiscovery: null,
    status: 0,
    message: "",
    category: "",
    advice: "",
  };
  if (!baseUrl) result.message = "缺少 Base URL";
  else if (!authToken) result.message = "缺少 Auth Token";
  else if (!model) result.message = "缺少模型";
  result.category = providerIssueCategory({ baseUrl, authToken, model });
  result.advice = providerIssueAdvice(result.category);
  if (!baseUrl || !authToken || !model) return result;
  const startedAt = Date.now();
  const discovery = await discoverModels(runtimeProvider);
  result.modelDiscovery = {
    ok: discovery.ok,
    source: discovery.source,
    endpoint: discovery.endpoint,
    count: discovery.modelCount,
    message: discovery.message,
  };
  result.models = discovery.models.slice(0, 50);
  result.modelCount = discovery.modelCount || 0;
  result.checks.modelsEndpoint = Boolean(discovery.ok);
  if (discovery.status) result.status = discovery.status;

  const normalizedModel = normalizeModelId(model);
  result.checks.modelListed = discovery.ok
    ? discovery.models.some(item => normalizeModelId(item.id) === normalizedModel)
    : false;

  const fatalDiscoveryCategories = new Set(["auth_failed", "network", "timeout", "proxy_or_tls", "provider_unavailable"]);
  if (!discovery.ok && fatalDiscoveryCategories.has(discovery.category)) {
    result.ok = false;
    result.category = discovery.category;
    result.advice = discovery.advice;
    result.message = discovery.message;
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  const probe = await probeProviderModel(runtimeProvider);
  result.checks.liveRequest = Boolean(probe.ok);
  if (probe.status) result.status = probe.status;
  result.durationMs = Date.now() - startedAt;

  if (probe.ok) {
    result.ok = true;
    result.category = "";
    result.advice = "";
    result.message = discovery.ok && result.checks.modelListed
      ? `模型列表和轻量请求均通过，耗时 ${result.durationMs}ms`
      : `模型轻量请求通过${discovery.ok ? "；当前模型未出现在列表中" : "；模型列表接口不可用或为空"}`;
    if (discovery.ok && !result.checks.modelListed) result.warning = providerIssueAdvice("model_not_listed");
    return result;
  }

  result.ok = false;
  result.category = discovery.ok && !result.checks.modelListed ? "model_not_listed" : probe.category;
  result.advice = providerIssueAdvice(result.category) || probe.advice;
  result.message = probe.message || discovery.message || "Provider 测试失败";
  return result;
}
