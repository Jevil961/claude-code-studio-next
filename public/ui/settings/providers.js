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
        <div class="slist-sub">${escapeHtml(p.model || "")} · ${escapeHtml(p.baseUrl || "")}</div>
      </div>
      <div class="slist-actions">
        <button class="st-btn t-btn--link" data-act="test">测试</button>
        <button class="st-btn t-btn--link" data-act="switch">切换</button>
        <button class="st-btn t-btn--link" data-act="edit">编辑</button>
        <button class="st-btn t-btn--danger t-btn--sm" data-act="delete">删除</button>
      </div>
    `;
    card.querySelector('[data-act="test"]').addEventListener("click", () => testProvider(p));
    card.querySelector('[data-act="switch"]').addEventListener("click", () => switchProvider(p.id, { renderSettingsTab, updateFooter }));
    card.querySelector('[data-act="edit"]').addEventListener("click", () => editProviderDlg(p, { settingsBody, renderSettingsTab }));
    card.querySelector('[data-act="delete"]').addEventListener("click", () => deleteProviderDlg(p, { settingsBody, renderSettingsTab, updateFooter, populateModelDropdown }));
    settingsBody.append(card);
  }
}

async function createProviderDlg({ settingsBody, renderSettingsTab }) {
  const presetsR = await safeBridge("getProviderPresets", null);
  const presets = presetsR?.data?.presets || [];

  const result = await showModal("添加 Provider", [
    { key: "preset", label: "预设平台", type: "select", options: [{ value: "", label: "-- 选择预设 --" }, ...presets.map(p => ({ value: p.id, label: `${p.icon || ""} ${p.name}` }))], value: "" },
    { key: "name", label: "名称", value: "", placeholder: "Provider 名称", required: true },
    { key: "baseUrl", label: "Base URL", value: "", placeholder: "API 地址", required: false, pattern: "^https?://.*", patternMessage: "URL 必须以 http:// 或 https:// 开头" },
    { key: "authToken", label: "Auth Token", value: "", placeholder: "API Key", type: "password", required: true },
    { key: "apiFormat", label: "API 格式", type: "select", options: [{ value: "anthropic", label: "Anthropic 原生" }, { value: "openai", label: "OpenAI 兼容" }, { value: "gemini", label: "Google Gemini" }], value: "openai" },
    { key: "model", label: "默认模型", value: "", placeholder: "选择预设后自动填充，或手动输入" },
  ]);
  if (!result || !result.name) return;

  // If preset selected, fill missing fields
  if (result.preset) {
    const preset = presets.find(p => p.id === result.preset);
    if (preset) {
      if (!result.baseUrl) result.baseUrl = preset.baseUrl;
      if (!result.apiFormat) result.apiFormat = preset.apiFormat;
      if (!result.name) result.name = preset.name;
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
    updateFooter();
    populateModelDropdown();
  } else toast(r.error || "删除失败", "error");
}

export async function switchProvider(id, { renderSettingsTab, updateFooter }) {
  const r = await safeBridge("switchProvider", null, id);
  if (r.ok) { data.providers = data.providers.map(p => ({ ...p, current: p.id === id })); toast(`已切换：${r.data?.provider?.name || ""}`, "success"); renderSettingsTab(); updateFooter(); }
  else toast(r.error || "切换失败", "error");
}

async function testProvider(provider) {
  toast(`正在测试 ${provider.name}...`);
  const r = await safeBridge("testProvider", null, provider.id);
  const d = r.data || {};
  if (!r.ok) { toast(r.error || "测试失败", "error"); return; }
  const lines = [
    `Provider：${d.provider || provider.name}`,
    `模型：${d.model || "--"}`,
    `Base URL：${d.baseUrl || "--"}`,
    `结果：${d.message || (d.ok ? "配置可用" : "配置不完整")}`,
    `耗时：${d.durationMs || 0}ms`,
  ];
  await showModal("Provider 测试结果", [{ key: "result", label: "结果", value: lines.join("\n"), type: "textarea" }]);
}
