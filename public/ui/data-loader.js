import { withTimeout } from "./api.js";
import { data, save, state } from "./state.js";
import { getBridge, safeBridge } from "./bridge.js";
import { toast } from "./helpers.js";

// Module-local state
export let projectIndexState = { status: "idle", stats: null, updatedAt: 0, error: "" };
export let skillCategoriesLoaded = false;
let lastRefresh = 0;

// Dependency injection
let deps = {};
export function configure(d) { deps = d; }

export function setProjectIndexState(v) { projectIndexState = v; }
export function setSkillCategoriesLoaded(v) { skillCategoriesLoaded = v; }
export function setLastRefresh(v) { lastRefresh = v; }
export function getLastRefresh() { return lastRefresh; }

export function mergeCustomProjects() {
  if (!state.customProjects?.length) return;
  const existingPaths = new Set(data.projects.map(p => (p.path || "").toLowerCase()));
  for (const cp of state.customProjects) {
    if (existingPaths.has((cp.path || "").toLowerCase())) continue;
    data.projects.push(cp);
  }
}

export function refreshSettingsIfOpen(panel = state.panel) {
  if (deps.settingsPage?.classList.contains("is-open") && state.panel === panel) deps.renderSettingsTab?.();
}

export function recordLoadResult(key, result, label) {
  if (result?.ok) { delete data.loadErrors[key]; return; }
  const message = result?.error || `${label} 加载失败`;
  data.loadErrors[key] = message;
  toast(message, "error");
}

export async function loadProviders() {
  const r = await safeBridge("listProviders", []);
  recordLoadResult("providers", r, "Provider");
  if (r.ok) data.providers = r.data || [];
  deps.updateFooter?.();
  deps.populateModelDropdown?.();
  refreshSettingsIfOpen("providers");
  return r;
}

export async function loadSkills() {
  const r = await safeBridge("listSkills", []);
  recordLoadResult("skills", r, "Skills");
  if (r.ok) data.skills = r.data || [];
  refreshSettingsIfOpen("skills");
  return r;
}

export async function loadSkillCategories() {
  const r = await safeBridge("listSkillCategories", []);
  recordLoadResult("skills", r, "Skills");
  if (r.ok && r.data) {
    data.categorizedSkills = r.data.skills || [];
    data.categoryInfo = r.data.categoryInfo || {};
    data.skills = data.categorizedSkills;
    skillCategoriesLoaded = true;
  }
  refreshSettingsIfOpen("skills");
  refreshSettingsIfOpen("identities");
  return r;
}

export async function loadIdentities() {
  const r = await safeBridge("listIdentities", []);
  recordLoadResult("identities", r, "身份");
  if (r.ok) data.identities = r.data || [];
  deps.updateFooter?.();
  deps.populateIdentitiesSubmenu?.();
  refreshSettingsIfOpen("identities");
  return r;
}

export async function loadTeams() {
  const r = await safeBridge("listTeams", []);
  recordLoadResult("teams", r, "Teams");
  if (r.ok) data.teams = r.data || [];
  refreshSettingsIfOpen("teams");
  return r;
}

export async function loadAgentTasks() {
  const r = await safeBridge("listAgentTasks", []);
  recordLoadResult("agentTasks", r, "Agent Tasks");
  if (r.ok) data.agentTasks = r.data || [];
  refreshSettingsIfOpen("tasks");
  return r;
}

export async function loadMcp() {
  const r = await safeBridge("listMcp", []);
  recordLoadResult("mcp", r, "MCP");
  if (r.ok) data.mcp = r.data || [];
  refreshSettingsIfOpen("mcp");
  return r;
}

export async function loadPlugins() {
  const r = await safeBridge("listPlugins", []);
  if (r.ok) data.plugins = r.data || [];
  refreshSettingsIfOpen("plugins");
  return r;
}

export async function loadAutomations() {
  const r = await safeBridge("listAutomations", []);
  if (r.ok) data.automations = r.data || [];
  return r;
}

export async function loadUsage() {
  const r = await safeBridge("listUsage", null);
  if (r.ok) data.usage = r.data || null;
  refreshSettingsIfOpen("usage");
  return r;
}

export async function loadRunners() {
  const r = await safeBridge("listRunners", []);
  if (r.ok) data.runners = r.data || [];
  refreshSettingsIfOpen("runners");
  return r;
}

export async function loadDiag() {
  const r = await safeBridge("diagnostics", null, { cwd: state.cwd, claudePath: state.claudePath, runnerStrategy: state.runnerStrategy, permissionMode: state.permissionMode });
  data.diagnostics = r?.data || r || null;
  if (data.diagnostics?.claudePath && !state.claudePath) { state.claudePath = data.diagnostics.claudePath; save(); }
  refreshSettingsIfOpen("diagnostics");
  return r;
}

export async function loadProjects() {
  const r = await safeBridge("listProjects", []);
  if (r.ok) {
    delete data.loadErrors.projects;
    data.projects = r.data || [];
    mergeCustomProjects();
    projectIndexState = { status: "done", stats: { scannedProjects: data.projects.length }, updatedAt: Date.now(), error: "" };
    lastRefresh = Date.now();
    await deps.validateActiveSession?.();
    deps.renderContextStack?.();
  }
  if (!r.ok) {
    const message = r.error || "项目索引加载失败";
    data.loadErrors.projects = message;
    projectIndexState = { status: "error", stats: null, updatedAt: Date.now(), error: message };
    deps.renderProjects?.();
    deps.renderConvs?.();
    deps.renderContextStack?.();
    toast(message, "error");
  }
  return r;
}

export async function refreshProjectIndex() {
  projectIndexState = { ...projectIndexState, status: "scanning", error: "" };
  deps.renderContextStack?.();
  const bridge = getBridge();
  if (bridge?.refreshProjectsBackground) {
    const bg = await safeBridge("refreshProjectsBackground", null, { budgetMs: 500, visibleSessionCount: 16, titleScanCount: 6, maxProjects: 120 });
    if (bg.ok) return bg;
  }
  const r = await safeBridge("refreshProjects", null);
  if (r.ok && r.data) {
    data.projects = r.data.projects || r.data || [];
    mergeCustomProjects();
    projectIndexState = { status: "done", stats: r.data.stats || null, updatedAt: Date.now(), error: "" };
    deps.renderProjects?.();
    deps.renderConvs?.();
    deps.renderContextStack?.();
    await deps.validateActiveSession?.();
    return r;
  }
  if (r?.error) {
    data.loadErrors.projects = r.error;
    projectIndexState = { status: "error", stats: null, updatedAt: Date.now(), error: r.error };
    deps.renderContextStack?.();
  }
  return r;
}

export async function checkEnv() {
  const bridge = getBridge();
  if (!bridge) { return; }
  const env = await withTimeout(bridge.checkEnv(), 8000, { ok: false });
  if (env?.claudePath) state.claudePath = env.claudePath;
  if (env?.claudePath) data.diagnostics = { ...(data.diagnostics || {}), claudePath: env.claudePath, ok: true };
  save();
}

export async function syncActiveIdentity() {
  const active = data.identities.find(i => i.active);
  if (!active) { toast("请先选择身份", "error"); return; }
  const r = await safeBridge("syncIdentitySkills", null, active.id);
  if (r.ok) toast(`已同步 ${r.data?.copied?.length || 0} 个`, "success");
  else toast(r.error || "同步失败", "error");
}
