import { save, state } from "../state.js";
import { $ } from "../helpers.js";
import { renderProvidersSettings } from "./providers.js";
import { renderIdentitiesSettings } from "./identities.js";
import { renderTeamsSettings } from "./teams.js";
import { renderSkillsSettings } from "./skills.js";
import { renderMcpSettings } from "./mcp.js";
import { renderPluginsSettings } from "./plugins.js";
import { renderRunnersSettings } from "./runners.js";
import { renderUsageSettings } from "./usage.js";
import { renderDiagSettings } from "./diagnostics.js";
import { renderGeneralSettings } from "./general.js";

// Dependency injection
let deps = {};
export function configure(d) { deps = d; }

export const settingsPage = $("#settingsPage");
export const settingsBody = $("#settingsBody");

export function openSettings(tab) {
  settingsPage.classList.add("is-open");
  state.panel = tab || "providers";
  save();
  renderSettingsTab();
}

export function renderSettingsTab() {
  $("#settingsTabs").querySelectorAll(".stab").forEach(b => b.classList.toggle("is-active", b.dataset.tab === state.panel));
  settingsBody.innerHTML = "";
  settingsBody.classList.toggle("is-teams-builder", state.panel === "teams");
  const titles = { providers: "Provider 管理", teams: "Teams 工作流", identities: "身份与协作", skills: "Skills 管理", mcp: "MCP 服务", plugins: "插件", runners: "Runner 管理", usage: "用量统计", diagnostics: "诊断", general: "通用设置" };
  $("#settingsTitle").textContent = titles[state.panel] || "设置";

  const panelDeps = { settingsBody, renderSettingsTab, ...deps };

  if (state.panel === "providers") renderProvidersSettings(panelDeps);
  if (state.panel === "teams") renderTeamsSettings(panelDeps);
  if (state.panel === "identities") renderIdentitiesSettings(panelDeps);
  if (state.panel === "skills") renderSkillsSettings(panelDeps);
  if (state.panel === "mcp") renderMcpSettings(panelDeps);
  if (state.panel === "plugins") { deps.loadPlugins?.().then(() => renderPluginsSettings(panelDeps)); }
  if (state.panel === "runners") renderRunnersSettings(panelDeps);
  if (state.panel === "usage") renderUsageSettings(panelDeps);
  if (state.panel === "diagnostics") renderDiagSettings(panelDeps);
  if (state.panel === "general") renderGeneralSettings(panelDeps);
}

export function initSettings() {
  $("#settingsBack").addEventListener("click", () => settingsPage.classList.remove("is-open"));
  $("#settingsTabs").addEventListener("click", e => {
    const btn = e.target.closest(".stab[data-tab]");
    if (!btn) return;
    state.panel = btn.dataset.tab;
    save();
    renderSettingsTab();
  });
}
