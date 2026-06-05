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
  const git = d.git || {};
  const items = [
    ["Claude 路径", d.claudePath || "未找到"],
    ["Claude 版本", d.claudeVersion || "--"],
    ["系统 Node", d.systemNodePath ? `${d.systemNodePath} · ${d.systemNodeVersion || ""}` : (d.hasSystemNode ? "已检测" : "未检测到")],
    ["npm", d.npmPath || "未检测到"],
    ["内置 Node", d.runtimeNodePath || d.backendNodePath || d.nodePath || "--"],
    ["内置 Node 版本", d.runtimeNodeVersion || d.backendNodeVersion || d.nodeVersion || "--"],
    ["后端 PID", d.backendPid || "--"],
    ["DB", d.ccSwitchDbExists ? "存在" : "不存在"],
    ["平台", d.platform || "--"],
    ["工作目录", state.cwd || "未设置"],
    ["Git", git.ok ? `${git.branch || "detached"} · ${git.dirty ? `${git.changedFiles} 个改动` : "clean"}` : (git.reason === "not-git-repo" ? "非 Git 项目" : "--")],
    ["策略", `${state.runnerStrategy} · ${state.permissionMode}`],
    ["数据", `项目 ${data.projects.length} · Skills ${data.skills.length} · MCP ${data.mcp.length}`],
  ];
  for (const [label, value] of items) {
    const card = document.createElement("div");
    card.className = "slist-item";
    card.innerHTML = `<div class="slist-body"><div class="slist-name">${label}</div><div class="slist-sub">${escapeHtml(value)}</div></div>`;
    settingsBody.append(card);
  }
  renderSecurityCenter(settingsBody, deps, d, git);
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

function securityFindings(d, git) {
  const findings = [];
  if (state.permissionMode === "bypass") {
    findings.push({ level: "high", title: "Bypass 正在启用", detail: "Claude Code 会跳过权限确认。只建议在干净分支、可信项目、明确任务范围内短时间使用。" });
  } else if (state.permissionMode === "plan") {
    findings.push({ level: "low", title: "Plan 模式", detail: "当前只产出计划，不直接改文件，是最保守的审查模式。" });
  } else {
    findings.push({ level: "medium", title: "Auto 模式", detail: "低风险操作自动执行，高风险操作仍需要确认，适合日常开发。" });
  }
  if (!state.cwd) findings.push({ level: "high", title: "未选择项目", detail: "运行前请选择项目目录，避免上下文漂移。" });
  if (git?.ok && git.counts?.conflicted) findings.push({ level: "high", title: "Git 存在冲突", detail: "冲突会让 Agent 的修改难以审查，建议先解决冲突。" });
  if (git?.ok && git.dirty) findings.push({ level: "medium", title: "工作区有未提交改动", detail: `当前有 ${git.changedFiles || 0} 个改动。建议先提交或使用 Agent Tasks 隔离 worktree。` });
  if (!d.hasNpm) findings.push({ level: "medium", title: "系统 npm 未确认", detail: "应用内置 Node 可运行后端，但安装或更新 Claude Code 需要系统 Node.js/npm。" });
  if (!d.claudePath && !state.claudePath) findings.push({ level: "medium", title: "Claude Code 未确认", detail: "诊断页还没有确认 Claude CLI 路径。已搜索 Homebrew、npm 全局目录和 ~/.local/bin 等常见位置。" });
  if (data.mcp.some(item => item.enabled !== false)) findings.push({ level: "medium", title: "MCP 已启用", detail: `当前启用 ${data.mcp.filter(item => item.enabled !== false).length} 个 MCP 服务。请只保留可信服务。` });
  if (data.plugins.length) findings.push({ level: "low", title: "插件目录可用", detail: `已安装 ${data.plugins.length} 个 Claude 插件。插件来自官方市场或本地目录时，仍建议定期审查清单。` });
  return findings;
}

function riskScore(findings) {
  return findings.reduce((score, item) => score + (item.level === "high" ? 35 : item.level === "medium" ? 18 : 6), 0);
}

function riskLabel(score) {
  if (score >= 70) return ["高风险", "danger"];
  if (score >= 35) return ["需要注意", "warn"];
  return ["可控", "ok"];
}

function renderSecurityCenter(settingsBody, deps, d, git) {
  const findings = securityFindings(d, git);
  const score = Math.min(100, riskScore(findings));
  const [label, tone] = riskLabel(score);
  const card = document.createElement("div");
  card.className = `security-center scard is-${tone}`;
  card.innerHTML = `
    <div class="security-head">
      <div>
        <span class="scard-title">权限与沙箱安全中心</span>
        <div class="slist-sub">面向本地 Claude Code GUI 的运行前安全雷达。</div>
      </div>
      <div class="security-score">
        <b>${score}</b>
        <span>${label}</span>
      </div>
    </div>
    <div class="security-actions">
      <button class="st-btn t-btn--primary t-btn--sm" data-perm="auto" type="button">切到 Auto</button>
      <button class="st-btn t-btn--link" data-perm="plan" type="button">切到 Plan</button>
      <button class="st-btn t-btn--danger t-btn--sm" data-perm="bypass" type="button">启用 Bypass</button>
      <button class="st-btn t-btn--link" id="openTasksIsolationBtn" type="button">用 Agent Tasks 隔离</button>
    </div>
    <div class="security-grid">
      ${findings.map(item => `
        <div class="security-finding is-${item.level}">
          <b>${escapeHtml(item.title)}</b>
          <span>${escapeHtml(item.detail)}</span>
        </div>
      `).join("")}
    </div>
  `;
  settingsBody.append(card);
  card.querySelectorAll("[data-perm]").forEach(btn => {
    btn.addEventListener("click", () => {
      deps.setPerm?.(btn.dataset.perm);
      toast(`权限模式已切换为 ${btn.dataset.perm}`, "success");
      deps.renderSettingsTab?.();
    });
  });
  card.querySelector("#openTasksIsolationBtn")?.addEventListener("click", () => deps.renderSettingsTab ? (state.panel = "tasks", save(), deps.renderSettingsTab()) : null);
}

async function copyDiagnosticReport() {
  const bridge = getBridge();
  const r = await safeBridge("diagnosticReport", null, { cwd: state.cwd, claudePath: state.claudePath, errors: data.loadErrors });
  if (!r.ok) { toast(r.error || "生成报告失败", "error"); return; }
  const text = JSON.stringify(r.data, null, 2);
  await bridge?.copyText?.(text);
  await showModal("诊断报告", [{ key: "report", label: "已复制，也可手动查看", value: text, type: "textarea" }]);
}
