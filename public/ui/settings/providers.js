import { data } from "../state.js";
import { safeBridge, curProvider } from "../bridge.js";
import { toast } from "../helpers.js";
import { showModal, showConfirm } from "../modal.js";
import { escapeHtml } from "../../markdown.js";
import { loadProviders } from "../data-loader.js";

export function renderProvidersSettings({ settingsBody, renderSettingsTab, updateFooter, populateModelDropdown }) {
  const header = document.createElement("div");
  header.className = "scard";
  header.innerHTML = `<div class="scard-head"><span class="scard-title">当前：${escapeHtml(curProvider()?.name || "未设置")}</span><div class="scard-actions"><button class="st-btn t-btn--primary t-btn--sm" id="addProviderBtn">添加 Provider</button></div></div>`;
  settingsBody.append(header);
  header.querySelector("#addProviderBtn").addEventListener("click", () => createProviderDlg({ settingsBody, renderSettingsTab }));
  renderProviderQuickStart(settingsBody, { renderSettingsTab, updateFooter, populateModelDropdown });

  if (!data.providers.length) {
    const empty = document.createElement("div");
    empty.className = "scard";
    empty.innerHTML = `
      <div class="slist-name">还没有 Provider</div>
      <div class="slist-sub" style="white-space:normal;">Provider 是模型 API 配置。添加一个可用 Provider 后，首页模型按钮和任务运行才会有可用模型。</div>
      <div class="scard-actions" style="margin-top:10px;"><button class="st-btn t-btn--primary t-btn--sm" id="emptyAddProviderBtn" type="button">添加 Provider</button></div>
    `;
    settingsBody.append(empty);
    empty.querySelector("#emptyAddProviderBtn").addEventListener("click", () => createProviderDlg({ settingsBody, renderSettingsTab }));
    return;
  }

  for (const p of data.providers) {
    const card = document.createElement("div");
    card.className = `slist-item${p.current ? " is-active" : ""}`;
    card.innerHTML = `
      <div class="slist-icon">${p.current ? "●" : "○"}</div>
      <div class="slist-body">
        <div class="slist-name">${escapeHtml(p.name)}</div>
        <div class="slist-sub">${escapeHtml(p.model || "")} · ${escapeHtml(p.baseHost || p.baseUrl || "")}</div>
      </div>
      <div class="slist-actions">
        <button class="st-btn t-btn--link" data-act="test">测试</button>
        <button class="st-btn t-btn--link" data-act="models">模型</button>
        <button class="st-btn t-btn--link" data-act="switch">切换</button>
        <button class="st-btn t-btn--link" data-act="edit">编辑</button>
        <button class="st-btn t-btn--danger t-btn--sm" data-act="delete">删除</button>
      </div>
    `;
    card.querySelector('[data-act="test"]').addEventListener("click", () => testProvider(p));
    card.querySelector('[data-act="models"]').addEventListener("click", () => showProviderModels(p));
    card.querySelector('[data-act="switch"]').addEventListener("click", () => switchProvider(p.id, { renderSettingsTab, updateFooter }));
    card.querySelector('[data-act="edit"]').addEventListener("click", () => editProviderDlg(p, { settingsBody, renderSettingsTab }));
    card.querySelector('[data-act="delete"]').addEventListener("click", () => deleteProviderDlg(p, { settingsBody, renderSettingsTab, updateFooter, populateModelDropdown }));
    settingsBody.append(card);
  }
}

function formatOptions(value = "openai") {
  return [{ value: "anthropic", label: "Anthropic 原生" }, { value: "openai", label: "OpenAI 兼容" }, { value: "gemini", label: "Google Gemini" }]
    .map(item => `<option value="${item.value}"${item.value === value ? " selected" : ""}>${item.label}</option>`)
    .join("");
}

function mergeModels(...groups) {
  const seen = new Set();
  const models = [];
  for (const group of groups) {
    for (const model of group || []) {
      const id = String(model?.id || model || "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      models.push(typeof model === "string" ? { id, name: id } : { ...model, id });
    }
  }
  return models;
}

function modelOptions(preset, value = "", remoteModels = []) {
  const models = mergeModels(remoteModels, preset?.models || [], value ? [{ id: value, name: value }] : []);
  if (!models.length) return `<option value="">手动输入模型名</option>`;
  return models.map(model => `<option value="${escapeHtml(model.id)}"${model.id === value ? " selected" : ""}>${escapeHtml(model.name || model.id)}</option>`).join("");
}

function providerIssueAdvice(result = {}) {
  const advice = result.advice || "";
  if (advice) return advice;
  const category = result.category || "";
  const map = {
    missing_base_url: "填写 Base URL，并确认以 http:// 或 https:// 开头。",
    missing_auth_token: "填写 API Key/Auth Token 后再测试。",
    missing_model: "选择预设模型，或填写服务商支持的模型 ID。",
    auth_failed: "API Key 无效或权限不足。重新生成 Key，并确认账号已开通该模型。",
    bad_base_url: "Base URL 路径可能不正确。使用服务商文档里的根 API 地址。",
    bad_request: "服务商拒绝了测试请求。核对 API 格式、Base URL 和模型调用方式。",
    model_not_found: "当前模型 ID 不存在或账号无权使用。先自动获取模型，再选择返回列表里的模型。",
    model_not_listed: "模型列表没有返回当前模型。优先选择自动获取到的模型，或确认它是隐藏/私有模型。",
    models_empty: "模型列表接口可访问，但没有返回模型。确认账号权限或换一个 API Key。",
    models_unavailable: "该服务商没有开放模型列表接口，已继续用轻量请求验证默认模型。",
    provider_unavailable: "服务商限流或异常。稍后重试，或切换 Provider/代理。",
    timeout: "连接超时。检查网络、代理、防火墙，或换一个可访问网络。",
    proxy_or_tls: "代理或证书校验失败。检查系统代理、公司证书或 HTTPS 拦截。",
    network: "网络不可达。检查 DNS、代理、VPN、防火墙或域名。",
  };
  return map[category] || "复制诊断摘要并查看服务商返回信息。";
}

function renderProviderQuickStart(settingsBody, { renderSettingsTab, updateFooter, populateModelDropdown }) {
  const card = document.createElement("div");
  card.className = "scard provider-quick-card";
  card.innerHTML = `
    <div class="scard-head">
      <span class="scard-title">快速配置 Provider</span>
      <div class="scard-actions"><button class="st-btn t-btn--link" id="manualProviderBtn" type="button">高级/手动配置</button></div>
    </div>
    <div class="slist-sub" style="white-space:normal;">选择常用预设后只需要补 API Key。连接测试会给出模型、接口和错误摘要。</div>
    <div class="provider-quick-grid" id="providerQuickGrid"><span class="slist-sub">正在读取预设...</span></div>
    <div class="provider-inline-form" id="providerInlineForm" hidden></div>
  `;
  settingsBody.append(card);
  card.querySelector("#manualProviderBtn")?.addEventListener("click", () => createProviderDlg({ settingsBody, renderSettingsTab }));
  safeBridge("getProviderPresets", null).then(r => {
    const presets = (r?.data?.presets || []).slice(0, 6);
    const grid = card.querySelector("#providerQuickGrid");
    const form = card.querySelector("#providerInlineForm");
    if (!grid) return;
    if (!presets.length) {
      grid.innerHTML = `<button class="st-btn t-btn--primary t-btn--sm" id="providerFallbackAddBtn" type="button">添加 Provider</button>`;
      grid.querySelector("#providerFallbackAddBtn")?.addEventListener("click", () => createProviderDlg({ settingsBody, renderSettingsTab }));
      return;
    }
    grid.innerHTML = presets.map(preset => `
      <button class="provider-preset-btn" data-preset="${escapeHtml(preset.id)}" type="button">
        <span>${escapeHtml(preset.icon || "API")}</span>
        <b>${escapeHtml(preset.name)}</b>
        <em>${escapeHtml(preset.models?.[0]?.id || preset.apiFormat || "")}</em>
      </button>
    `).join("");
    const paintForm = (preset) => {
      if (!form) return;
      const firstModel = preset?.models?.[0]?.id || "";
      form.hidden = false;
      form.innerHTML = `
        <div class="provider-inline-grid">
          <label>名称<input id="qProviderName" value="${escapeHtml(preset?.name || "")}" placeholder="Provider 名称"></label>
          <label>API 格式<select id="qProviderFormat">${formatOptions(preset?.apiFormat || "openai")}</select></label>
          <label>Base URL<input id="qProviderBaseUrl" value="${escapeHtml(preset?.baseUrl || "")}" placeholder="https://..."></label>
          <label>模型<select id="qProviderModel">${modelOptions(preset, firstModel)}</select></label>
          <label class="provider-inline-token">API Key<input id="qProviderToken" type="password" placeholder="粘贴 API Key"></label>
          <label>手动模型<input id="qProviderModelManual" value="" placeholder="下拉没有时填写"></label>
        </div>
        <div class="provider-inline-actions">
          <button class="st-btn t-btn--link" id="qProviderFetchModels" type="button">自动获取模型</button>
          <button class="st-btn t-btn--primary t-btn--sm" id="qProviderSaveTest" type="button">保存并测试</button>
          <button class="st-btn t-btn--link" id="qProviderSave" type="button">仅保存</button>
          <span id="qProviderResult" class="provider-inline-result"></span>
        </div>
      `;
      const status = form.querySelector("#qProviderResult");
      const readPayload = () => {
        const model = form.querySelector("#qProviderModelManual")?.value.trim() || form.querySelector("#qProviderModel")?.value.trim() || "";
        return {
          name: form.querySelector("#qProviderName")?.value.trim() || preset?.name || "",
          baseUrl: form.querySelector("#qProviderBaseUrl")?.value.trim() || "",
          authToken: form.querySelector("#qProviderToken")?.value.trim() || "",
          apiFormat: form.querySelector("#qProviderFormat")?.value || preset?.apiFormat || "openai",
          model,
        };
      };
      const paintFetchedModels = (models = [], selected = "") => {
        const select = form.querySelector("#qProviderModel");
        if (!select) return;
        const nextValue = selected || models[0]?.id || select.value || "";
        select.innerHTML = modelOptions(null, nextValue, models);
        select.value = nextValue;
      };
      const fetchQuickModels = async () => {
        const payload = readPayload();
        if (!payload.baseUrl || !payload.authToken) {
          status.textContent = "请先填写 Base URL 和 API Key。";
          status.className = "provider-inline-result is-error";
          return;
        }
        status.textContent = "正在获取模型列表...";
        status.className = "provider-inline-result";
        const r = await safeBridge("fetchModels", null, { ...payload, presetId: preset?.id || "" });
        const d = r.data || {};
        const models = d.models || [];
        if (models.length) {
          const current = payload.model && models.some(item => item.id === payload.model) ? payload.model : models[0].id;
          paintFetchedModels(models, current);
          const manual = form.querySelector("#qProviderModelManual");
          if (manual && current) manual.value = "";
          status.textContent = d.source === "preset-fallback"
            ? `远端未返回模型，已使用预设 ${models.length} 个。`
            : `已获取 ${models.length} 个模型。`;
          status.className = `provider-inline-result ${d.source === "preset-fallback" ? "is-warn" : "is-ok"}`;
          return;
        }
        status.textContent = d.message || r.error || "没有获取到模型。";
        status.className = "provider-inline-result is-error";
      };
      const saveQuickProvider = async (testAfter = false) => {
        const payload = readPayload();
        if (!payload.name || !payload.authToken || !payload.baseUrl || !payload.model) {
          status.textContent = "请补齐名称、Base URL、API Key 和模型。";
          status.className = "provider-inline-result is-error";
          return;
        }
        status.textContent = testAfter ? "正在保存并测试..." : "正在保存...";
        status.className = "provider-inline-result";
        const created = await safeBridge("createProvider", null, payload);
        if (!created.ok) {
          status.textContent = created.error || "保存失败";
          status.className = "provider-inline-result is-error";
          toast(created.error || "Provider 保存失败", "error");
          return;
        }
        const providerId = created.data?.id || "";
        if (providerId) await safeBridge("switchProvider", null, providerId);
        await loadProviders();
        updateFooter?.();
        populateModelDropdown?.();
        const provider = data.providers.find(p => p.id === providerId) || { id: providerId, ...payload };
        if (testAfter && provider.id) {
          const testResult = await safeBridge("testProvider", null, provider.id);
          const d = testResult.data || {};
          status.textContent = testResult.ok && d.ok ? `连接可用，模型 ${d.modelCount || 0} 个，耗时 ${d.durationMs || 0}ms` : `已保存，但需要检查：${providerIssueAdvice(d)}${d.message ? `（${d.message}）` : ""}`;
          status.className = `provider-inline-result ${testResult.ok && d.ok ? "is-ok" : "is-error"}`;
          toast(testResult.ok && d.ok ? "Provider 已保存并可用" : "Provider 已保存，请检查连接测试结果", testResult.ok && d.ok ? "success" : "error");
        } else {
          status.textContent = "已保存并切换为当前 Provider。";
          status.className = "provider-inline-result is-ok";
          toast("Provider 已保存", "success");
        }
        setTimeout(() => renderSettingsTab(), testAfter ? 1600 : 600);
      };
      form.querySelector("#qProviderFetchModels")?.addEventListener("click", fetchQuickModels);
      form.querySelector("#qProviderSaveTest")?.addEventListener("click", () => saveQuickProvider(true));
      form.querySelector("#qProviderSave")?.addEventListener("click", () => saveQuickProvider(false));
    };
    grid.querySelectorAll("[data-preset]").forEach((btn, index) => {
      btn.addEventListener("click", () => {
        grid.querySelectorAll("[data-preset]").forEach(item => item.classList.toggle("is-active", item === btn));
        const preset = presets.find(item => item.id === btn.dataset.preset) || presets[index];
        paintForm(preset);
      });
    });
    if (!data.providers.length && presets[0]) {
      grid.querySelector("[data-preset]")?.classList.add("is-active");
      paintForm(presets[0]);
    }
  });
}

async function createProviderDlg({ settingsBody, renderSettingsTab, presetId = "" }) {
  const presetsR = await safeBridge("getProviderPresets", null);
  const presets = presetsR?.data?.presets || [];
  const selectedPreset = presets.find(p => p.id === presetId);
  const defaultModel = selectedPreset?.models?.[0]?.id || "";

  const result = await showModal("添加 Provider", [
    { key: "preset", label: "预设平台", type: "select", options: [{ value: "", label: "-- 选择预设 --" }, ...presets.map(p => ({ value: p.id, label: `${p.icon || ""} ${p.name}` }))], value: selectedPreset?.id || "" },
    { key: "name", label: "名称", value: selectedPreset?.name || "", placeholder: "Provider 名称", required: true },
    { key: "baseUrl", label: "Base URL", value: selectedPreset?.baseUrl || "", placeholder: "API 地址", required: false, pattern: "^https?://.*", patternMessage: "URL 必须以 http:// 或 https:// 开头" },
    { key: "authToken", label: "Auth Token", value: "", placeholder: "API Key", type: "password", required: true },
    { key: "apiFormat", label: "API 格式", type: "select", options: [{ value: "anthropic", label: "Anthropic 原生" }, { value: "openai", label: "OpenAI 兼容" }, { value: "gemini", label: "Google Gemini" }], value: selectedPreset?.apiFormat || "openai" },
    { key: "model", label: "默认模型", value: defaultModel, placeholder: "选择预设后自动填充，或手动输入" },
  ]);
  if (!result || !result.name) return;

  // If preset selected, fill missing fields
  if (result.preset) {
    const preset = presets.find(p => p.id === result.preset);
    if (preset) {
      if (!result.baseUrl) result.baseUrl = preset.baseUrl;
      if (!result.apiFormat) result.apiFormat = preset.apiFormat;
      if (!result.name) result.name = preset.name;
      if (!result.model) result.model = preset.models?.[0]?.id || "";
    }
  }

  const r = await safeBridge("createProvider", null, {
    name: result.name.trim(), baseUrl: result.baseUrl?.trim() || "", authToken: result.authToken?.trim() || "",
    model: result.model?.trim() || "", apiFormat: result.apiFormat || "openai",
  });
  if (r.ok) { toast(`已创建：${result.name}`, "success"); await loadProviders(); renderSettingsTab(); }
  else toast(r.error || "创建失败", "error");
}

async function editProviderDlg(item, { settingsBody, renderSettingsTab }) {
  const result = await showModal("编辑 Provider", [
    { key: "name", label: "名称", value: item.name },
    { key: "baseUrl", label: "Base URL", value: item.baseUrl || "" },
    { key: "authToken", label: "Auth Token (留空不修改)", value: "", type: "password" },
    { key: "apiFormat", label: "API 格式", type: "select", options: [{ value: "anthropic", label: "Anthropic 原生" }, { value: "openai", label: "OpenAI 兼容" }, { value: "gemini", label: "Google Gemini" }], value: item.apiFormat || "openai" },
    { key: "model", label: "默认模型", value: item.model || "" },
  ]);
  if (!result) return;
  const updates = { name: result.name?.trim() || item.name, model: result.model?.trim() || "", baseUrl: result.baseUrl?.trim() || "", apiFormat: result.apiFormat || item.apiFormat || "openai" };
  if (result.authToken?.trim()) updates.authToken = result.authToken.trim();
  const r = await safeBridge("updateProvider", null, item.id, updates);
  if (r.ok) { toast("已更新", "success"); await loadProviders(); renderSettingsTab(); }
  else toast(r.error || "更新失败", "error");
}

async function deleteProviderDlg(item, { settingsBody, renderSettingsTab, updateFooter, populateModelDropdown }) {
  if (!await showConfirm("删除", `确定删除「${item.name}」？`)) return;
  const wasCurrent = item.current;
  const r = await safeBridge("deleteProvider", null, item.id);
  if (r.ok) {
    toast("已删除", "success");
    await loadProviders();
    // If the deleted provider was current, switch to the first available
    if (wasCurrent && data.providers.length) {
      await switchProvider(data.providers[0].id, { renderSettingsTab, updateFooter });
    }
    renderSettingsTab();
    updateFooter?.();
    populateModelDropdown?.();
  } else toast(r.error || "删除失败", "error");
}

export async function switchProvider(id, { renderSettingsTab, updateFooter }) {
  const r = await safeBridge("switchProvider", null, id);
  if (r.ok) { data.providers = data.providers.map(p => ({ ...p, current: p.id === id })); toast(`已切换：${r.data?.provider?.name || ""}`, "success"); renderSettingsTab(); updateFooter?.(); }
  else toast(r.error || "切换失败", "error");
}

async function showProviderModels(provider) {
  toast(`正在获取 ${provider.name} 的模型列表...`);
  const r = await safeBridge("fetchModels", null, { providerId: provider.id });
  const d = r.data || {};
  const models = d.models || [];
  const lines = [
    `Provider：${provider.name}`,
    `来源：${d.source || "--"}${d.fallback ? "（预设兜底）" : ""}`,
    `Base URL：${d.baseUrl || provider.baseUrl || "--"}`,
    `结果：${d.message || (models.length ? "已获取模型" : "未获取到模型")}`,
    `分类：${d.category || "--"}`,
    `建议：${providerIssueAdvice(d) || "--"}`,
    `模型数：${models.length}`,
    "",
    ...models.slice(0, 80).map(model => `- ${model.id}${model.name && model.name !== model.id ? ` · ${model.name}` : ""}`),
  ];
  if (!models.length) lines.push("- 无");
  toast(models.length ? "模型列表已更新" : "没有获取到模型", models.length ? "success" : "info");
  await showModal("Provider 模型列表", [{ key: "result", label: "结果", value: lines.join("\n"), type: "textarea" }]);
}

async function testProvider(provider) {
  toast(`正在测试 ${provider.name}...`);
  const r = await safeBridge("testProvider", null, provider.id);
  const d = r.data || {};
  if (!r.ok) {
    const lines = [
      `Provider：${provider.name}`,
      `Base URL：${provider.baseUrl || "--"}`,
      "结果：连接失败",
      "下一步：检查 API Key、Base URL、API 格式和网络代理。",
      "",
      `错误：${r.error || d.message || "未知错误"}`,
    ];
    toast(r.error || "Provider 测试失败", "error");
    await showModal("Provider 测试结果", [{ key: "result", label: "结果", value: lines.join("\n"), type: "textarea" }]);
    return;
  }
  const lines = [
    `Provider：${d.provider || provider.name}`,
    `模型：${d.model || "--"}`,
    `Base URL：${d.baseUrl || "--"}`,
    `结果：${d.message || (d.ok ? "配置可用" : "配置不完整")}`,
    `模型发现：${d.modelDiscovery?.message || "--"}`,
    `检查：模型列表 ${d.checks?.modelsEndpoint ? "通过" : "未通过"} / 当前模型 ${d.checks?.modelListed ? "在列表中" : "未确认"} / 轻量请求 ${d.checks?.liveRequest ? "通过" : "未通过"}`,
    `分类：${d.category || "--"}`,
    `建议：${providerIssueAdvice(d) || "--"}`,
    d.warning ? `提示：${d.warning}` : "",
    `耗时：${d.durationMs || 0}ms`,
  ].filter(Boolean);
  toast(d.ok ? "Provider 连接可用" : "Provider 测试完成，请检查结果", d.ok ? "success" : "info");
  await showModal("Provider 测试结果", [{ key: "result", label: "结果", value: lines.join("\n"), type: "textarea" }]);
}
