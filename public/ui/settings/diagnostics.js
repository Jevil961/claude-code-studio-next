import { data, state, save } from "../state.js";
import { getBridge, safeBridge } from "../bridge.js";
import { toast } from "../helpers.js";
import { showModal } from "../modal.js";
import { escapeHtml } from "../../markdown.js";
import { loadDiag, refreshProjectIndex } from "../data-loader.js";

export async function renderDiagSettings(deps) {
  const { settingsBody, renderSettingsTab } = deps;
  settingsBody.innerHTML = `<div class="loading-msg">检测中...</div>`;
  await loadDiag();
  settingsBody.innerHTML = "";
  const d = data.diagnostics || {};
  const items = [
    ["Claude 路径", d.claudePath || "未找到"],
    ["Claude 版本", d.claudeVersion || "--"],
    ["Node 路径", d.nodePath || "--"],
    ["Node 版本", d.nodeVersion || "--"],
    ["后端 PID", d.backendPid || "--"],
    ["DB", d.ccSwitchDbExists ? "存在" : "不存在"],
    ["平台", d.platform || "--"],
    ["工作目录", state.cwd || "未设置"],
    ["策略", `${state.runnerStrategy} · ${state.permissionMode}`],
    ["数据", `项目 ${data.projects.length} · Skills ${data.skills.length} · MCP ${data.mcp.length}`],
  ];
  for (const [label, value] of items) {
    const card = document.createElement("div");
    card.className = "slist-item";
    card.innerHTML = `<div class="slist-body"><div class="slist-name">${label}</div><div class="slist-sub">${escapeHtml(value)}</div></div>`;
    settingsBody.append(card);
  }
  const actions = document.createElement("div");
  actions.className = "scard";
  actions.innerHTML = `<div class="scard-head"><span class="scard-title">诊断报告</span><div class="scard-actions"><button class="st-btn t-btn--link" id="rebuildIndexBtn">重建项目索引</button><button class="st-btn t-btn--link" id="checkClaudeBtn">检测 Claude</button><button class="st-btn t-btn--primary t-btn--sm" id="copyReportBtn">复制报告</button></div></div>`;
  settingsBody.append(actions);
  actions.querySelector("#rebuildIndexBtn").addEventListener("click", async () => {
    const r = await refreshProjectIndex();
    toast(r.ok ? "项目索引已重建" : (r.error || "项目索引重建失败"), r.ok ? "success" : "error");
    renderSettingsTab();
  });
  actions.querySelector("#checkClaudeBtn").addEventListener("click", async () => {
    const r = await safeBridge("checkClaude", null, state.claudePath);
    const d = r.data || {};
    if (d.claudePath) { state.claudePath = d.claudePath; save(); }
    toast(d.ok ? `Claude 可用：${d.version || d.claudePath}` : (d.error || "未找到 Claude"), d.ok ? "success" : "error");
    await loadDiag();
    renderSettingsTab();
  });
  actions.querySelector("#copyReportBtn").addEventListener("click", copyDiagnosticReport);
}

async function copyDiagnosticReport() {
  const bridge = getBridge();
  const r = await safeBridge("diagnosticReport", null, { cwd: state.cwd, claudePath: state.claudePath, errors: data.loadErrors });
  if (!r.ok) { toast(r.error || "生成报告失败", "error"); return; }
  const text = JSON.stringify(r.data, null, 2);
  await bridge?.copyText?.(text);
  await showModal("诊断报告", [{ key: "report", label: "已复制，也可手动查看", value: text, type: "textarea" }]);
}
