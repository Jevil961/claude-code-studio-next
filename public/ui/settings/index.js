import { save, state } from "../state.js";
import { $ } from "../helpers.js";
import { renderProvidersSettings } from "./providers.js";
import { renderIdentitiesSettings } from "./identities.js";
import { renderTeamsSettings } from "./teams.js";
import { renderTasksSettings } from "./tasks.js";
import { renderSkillsSettings } from "./skills.js";
import { renderMcpSettings } from "./mcp.js";
import { renderPluginsSettings } from "./plugins.js";
import { renderRunnersSettings } from "./runners.js";
import { renderUsageSettings } from "./usage.js";
import { renderDiagSettings } from "./diagnostics.js";
import { renderGeneralSettings } from "./general.js";

let deps = {};
export function configure(d) { deps = d; }

export const settingsPage = $("#settingsPage");
export const settingsBody = $("#settingsBody");
export const teamsPage = $("#teamsPage");
export const teamsBuilderBody = $("#teamsBuilderBody");

const PANEL_TITLES = {
  providers: "Provider 管理",
  teams: "Teams 工作流",
  tasks: "Agent Tasks",
  identities: "身份与协作",
  skills: "Skills 管理",
  mcp: "MCP 服务",
  plugins: "插件",
  runners: "Runner 管理",
  usage: "用量统计",
  diagnostics: "诊断",
  general: "通用设置",
};

const PANEL_GUIDES = {
  providers: ["先把模型服务接好。添加 Base URL、API Key 和默认模型后，点击测试确认可用。", "添加 Provider"],
  teams: ["用身份组成工作流。适合需求澄清、开发、测试、复核这类需要多轮交接的任务。", "打开工作台"],
  tasks: ["把复杂工作拆到独立分支或 worktree 里执行，便于查看 diff、测试结果和提交链路。", "新建任务"],
  identities: ["身份是一组规则和 Skills 的组合。你可以把项目经理、开发、测试、架构师做成不同工作角色。", "创建身份"],
  skills: ["Skills 是可复用能力说明。导入、预览、分类后再同步到 Claude Code。", "同步预览"],
  mcp: ["MCP 服务为 Claude 提供外部工具。添加后建议先校验配置，再启用并同步。", "添加 MCP"],
  plugins: ["插件扩展应用能力。优先安装可信插件，避免导入来源不明的本地目录。", "安装插件"],
  runners: ["Runner 管理当前 Claude Code 工作进程。任务卡住时可以在这里查看并停止进程。", "刷新"],
  usage: ["查看模型调用规模。后续可扩展为趋势图、预算提醒和 Provider 成本对比。", "查看诊断"],
  diagnostics: ["检查 Claude、项目、Skills、MCP、桥接和运行时状态。发布前建议先跑一遍。", "生成报告"],
  general: ["配置主题、密度、默认路径、数据导入导出和应用级偏好。", "打开帮助"],
};

const GUIDE_TITLES = {
  providers: "先配置模型服务",
  teams: "用身份组成工作流",
  tasks: "隔离任务与分支",
  identities: "把能力组织成身份",
  skills: "管理可复用能力",
  mcp: "连接外部工具",
  plugins: "安装扩展能力",
  runners: "查看运行进程",
  usage: "理解用量与成本",
  diagnostics: "排查应用状态",
  general: "应用级设置",
};

export function openSettings(tab) {
  teamsPage?.classList.remove("is-open");
  settingsPage.classList.add("is-open");
  state.panel = tab || "providers";
  save();
  renderSettingsTab();
}

export async function openTeamsBuilder() {
  settingsPage.classList.remove("is-open");
  teamsPage.classList.add("is-open");
  state.panel = "teams";
  save();
  await deps.loadTeams?.();
  renderTeamsBuilder();
}

export function renderTeamsBuilder() {
  if (!teamsBuilderBody) return;
  teamsBuilderBody.innerHTML = "";
  renderTeamsSettings({ settingsBody: teamsBuilderBody, renderSettingsTab: renderTeamsBuilder, ...deps });
}

export function renderSettingsTab() {
  $("#settingsTabs").querySelectorAll(".stab").forEach(b => b.classList.toggle("is-active", b.dataset.tab === state.panel));
  settingsBody.innerHTML = "";
  settingsBody.classList.toggle("is-teams-builder", state.panel === "teams");
  $("#settingsTitle").textContent = PANEL_TITLES[state.panel] || "设置";

  const panelDeps = { settingsBody, renderSettingsTab, ...deps };
  renderSettingsGuide(state.panel, settingsBody);

  if (state.panel === "providers") renderProvidersSettings(panelDeps);
  if (state.panel === "teams") renderTeamsSettings(panelDeps);
  if (state.panel === "tasks") renderTasksSettings(panelDeps);
  if (state.panel === "identities") renderIdentitiesSettings(panelDeps);
  if (state.panel === "skills") renderSkillsSettings(panelDeps);
  if (state.panel === "mcp") renderMcpSettings(panelDeps);
  if (state.panel === "plugins") { deps.loadPlugins?.().then(() => renderPluginsSettings(panelDeps)); }
  if (state.panel === "runners") renderRunnersSettings(panelDeps);
  if (state.panel === "usage") renderUsageSettings(panelDeps);
  if (state.panel === "diagnostics") renderDiagSettings(panelDeps);
  if (state.panel === "general") renderGeneralSettings(panelDeps);
}

function renderSettingsGuide(tab, body) {
  const copy = PANEL_GUIDES[tab];
  if (!copy) return;
  const guide = document.createElement("div");
  guide.className = "settings-guide";
  guide.innerHTML = `
    <b>${GUIDE_TITLES[tab] || "设置说明"}</b>
    <span>${copy[0]}</span>
    <div class="scard-actions"><button class="st-btn t-btn--link" data-guide-action="${tab}" type="button">${copy[1]}</button></div>
  `;
  body.append(guide);
  guide.querySelector("[data-guide-action]")?.addEventListener("click", () => {
    const action = guide.querySelector("[data-guide-action]").dataset.guideAction;
    if (action === "teams") openTeamsBuilder();
    else if (action === "general") import("../onboarding.js").then(m => m.openHelp());
    else if (action === "usage") openSettings("diagnostics");
    else {
      const targetId = {
        providers: "addProviderBtn",
        identities: "addIdBtn",
        skills: "previewSkillsBtn",
        mcp: "addMcpBtn",
        plugins: "installPluginBtn",
        tasks: "createTaskBtn",
        runners: "refreshRunnersBtn",
        diagnostics: "copyReportBtn",
      }[action];
      if (targetId) document.querySelector(`#${targetId}`)?.click();
    }
  });
}

export function initSettings() {
  $("#settingsBack").addEventListener("click", () => settingsPage.classList.remove("is-open"));
  $("#teamsBack")?.addEventListener("click", () => teamsPage.classList.remove("is-open"));
  $("#settingsTabs").addEventListener("click", e => {
    const btn = e.target.closest(".stab[data-tab]");
    if (!btn) return;
    state.panel = btn.dataset.tab;
    save();
    renderSettingsTab();
  });
  $("#settingsTabs").addEventListener("keydown", e => {
    const tabs = [...$("#settingsTabs").querySelectorAll(".stab[data-tab]")];
    const curIdx = tabs.indexOf(document.activeElement);
    if (e.key === "ArrowRight") {
      e.preventDefault();
      const next = curIdx < tabs.length - 1 ? curIdx + 1 : 0;
      tabs[next].focus();
      tabs[next].click();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const prev = curIdx > 0 ? curIdx - 1 : tabs.length - 1;
      tabs[prev].focus();
      tabs[prev].click();
    }
  });
}
