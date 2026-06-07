import { data, save, state } from "./state.js";
import { getBridge, safeBridge, runtimeAction } from "./bridge.js";
import { $, basename, toast } from "./helpers.js";
import { configure as configureDataLoader, loadProviders, loadSkills, loadSkillCategories, loadIdentities, loadTeams, loadAgentTasks, loadMcp, loadPlugins, loadAutomations, loadUsage, loadRunners, loadDiag, loadProjects, refreshProjectIndex, checkEnv, syncActiveIdentity, mergeCustomProjects, projectIndexState, setProjectIndexState, skillCategoriesLoaded, setSkillCategoriesLoaded, getLastRefresh, setLastRefresh, refreshSettingsIfOpen } from "./data-loader.js";
import { configure as configureContextFooter, updateFooter, renderContextStack, addTimeline, timelineFromClaudeEvent, setRunTimeline, setRunTouchedFiles, setLastTimelineKey } from "./context-footer.js";
import { configure as configureMessages, renderMessages, addAttachments, renderAttachments, promptWithAttachments, setAttachedFiles, getAttachedFiles, exportConversation, openReplayPanel, startReplayRun, recordReplayEvent, finishReplayRun } from "./messages.js";
import { configure as configureProjectNav, renderProjects, selectProject, renderConvs, selectSession, loadSession, recoverMissingSession, validateActiveSession, initProjectNav } from "./project-nav.js";
import { configure as configureSearch, openSearchPanel, closeSearchPanel, renderSearchResults } from "./search.js";
import { configure as configureDropdowns, closeAllDropdowns, populateIdentitiesSubmenu, populateModelDropdown, updateModelLabel, initDropdowns } from "./dropdowns.js";
import { configure as configureSettings, openSettings, openTeamsBuilder, renderSettingsTab, settingsPage, settingsBody, teamsPage, initSettings } from "./settings/index.js";
import { configure as configureSetup, claudeSetupState, getClaudeSetupState, handleClaudeDetectResult, initSetup } from "./setup.js";
import { configure as configureChatEngine, setMode, setPerm, setRunning, autosize, onClaudeEvent, onClaudeStderr, onClaudeDone, handleAskUser, currentRunId, getCurrentRunId, initChatEngine, retryLastPrompt } from "./chat-engine.js";
import { configure as configureOnboarding, initOnboarding, openHelp } from "./onboarding.js";
import { switchIdentity as switchIdentitySetting } from "./settings/identities.js";
import { switchProvider as switchProviderSetting } from "./settings/providers.js";
import { configure as configureCommandPalette, openCommandPalette, closeCommandPalette, initCommandPalette } from "./command-palette.js";
import { configure as configureSlashCommands, initSlashCommands } from "./slash-commands.js";
import { initTooltip } from "./tooltip.js";
import { initTheme, toggleTheme, cycleDensity } from "./theme.js";
import { initNotifications } from "./notifications.js";

// Module-local state
export let initialLoadDone = false;
let identityAnalysisState = { running: false, status: "idle", message: "" };

export function getInitialLoadDone() { return initialLoadDone; }

export function newChat() {
  state.messages = []; state.selectedSession = ""; state.selectedSessionPath = "";
  state.clientSessionKey = crypto.randomUUID(); state.pendingPlanPrompt = ""; state.mode = "normal";
  save(); renderMessages(); $("#promptInput").focus();
}

export function applyBootstrap(payload) {
  if (!payload?.ok) {
    const message = payload?.error || "启动数据加载失败";
    data.loadErrors.bootstrap = message;
    toast(message, "error");
    return;
  }
  const d = payload.data || {};
  if (Array.isArray(d.providers)) data.providers = d.providers;
  if (Array.isArray(d.skills)) data.skills = d.skills;
  if (Array.isArray(d.categorizedSkills)) data.categorizedSkills = d.categorizedSkills;
  else if (Array.isArray(d.skills)) data.categorizedSkills = d.skills;
  if (Array.isArray(d.skills) || Array.isArray(d.categorizedSkills)) setSkillCategoriesLoaded(true);
  if (d.categoryInfo && typeof d.categoryInfo === "object") data.categoryInfo = d.categoryInfo;
  if (Array.isArray(d.mcp)) data.mcp = d.mcp;
  if (Array.isArray(d.identities)) data.identities = d.identities;
  if (Array.isArray(d.teams)) data.teams = d.teams;
  if (Array.isArray(d.agentTasks)) data.agentTasks = d.agentTasks;
  if (Array.isArray(d.projects)) { data.projects = d.projects; mergeCustomProjects(); }
  if (Array.isArray(d.plugins)) data.plugins = d.plugins;
  if (Array.isArray(d.automations)) data.automations = d.automations;
  if (Array.isArray(d.runners)) data.runners = d.runners;
  delete data.loadErrors.bootstrap;
  updateFooter();
  populateIdentitiesSubmenu();
  populateModelDropdown();
  renderProjects();
  renderConvs();
  refreshSettingsIfOpen();
  renderContextStack();
}

export function handleProjectIndex(payload = {}) {
  setProjectIndexState({
    status: payload.status || "idle",
    stats: payload.result?.stats || projectIndexState.stats,
    updatedAt: payload.finishedAt || payload.startedAt || Date.now(),
    error: payload.error || "",
  });
  if (payload.status === "done" && payload.result) {
    data.projects = payload.result.projects || payload.result || [];
    mergeCustomProjects();
    renderProjects();
    renderConvs();
    validateActiveSession();
  }
  if (payload.status === "error" && payload.error) {
    data.loadErrors.projects = payload.error;
    toast(payload.error, "error");
  }
  renderContextStack();
}

export function handleIdentityAnalysis(payload = {}) {
  identityAnalysisState = {
    running: !["done", "error"].includes(payload.status),
    status: payload.status || "idle",
    message: payload.message || "",
    warning: payload.warning || "",
  };
  if (payload.status === "fallback" && payload.warning) {
    toast("Claude 分析未完成，已切换到本地聚类", "info");
  }
  if (payload.status === "done") {
    Promise.all([loadSkillCategories(), loadIdentities()]).then(() => {
      if (settingsPage.classList.contains("is-open") && state.panel === "identities") renderSettingsTab();
    });
  }
}

function deferWork(fn, timeout = 300) {
  if (window.requestIdleCallback) {
    window.requestIdleCallback(fn, { timeout });
  } else {
    setTimeout(fn, timeout);
  }
}

export async function boot() {
  const bridge = getBridge();
  const sidebar = $("#sidebar");
  const contextStack = $("#contextStack");

  if (state.contextOpen === undefined) state.contextOpen = true;
  sidebar?.classList.toggle("is-collapsed", !state.sidebarOpen);
  contextStack?.classList.toggle("is-collapsed", !state.contextOpen);
  setPerm(state.permissionMode || "auto");
  renderProjects();
  renderConvs();
  renderMessages();
  updateFooter();
  autosize();

  // Wave 1: Critical path
  let bootstrapped = false;
  if (bridge?.bootstrapData) {
    const bootstrap = await safeBridge("bootstrapData", null);
    if (bootstrap?.ok && bootstrap.data) {
      applyBootstrap({ ok: true, data: bootstrap.data });
      bootstrapped = true;
    }
  }

  if (bootstrapped) {
    checkEnv();
  } else {
    await Promise.all([
      checkEnv(),
      loadProviders(),
      loadIdentities(),
      loadTeams(),
      loadProjects(),
    ]);
  }
  renderProjects();
  renderConvs();
  updateFooter();
  populateModelDropdown();
  populateIdentitiesSubmenu();
  initialLoadDone = true;

  // Fallback detection
  if (claudeSetupState.installed) {
    try {
      const dr = await safeBridge("detectClaude", null);
      if (dr?.ok && dr.data) handleClaudeDetectResult(dr.data);
    } catch {}
  }

  // Wave 2: Secondary data
  const loadSecondary = () => Promise.allSettled([
    loadSkillCategories(),
    loadMcp(),
    loadPlugins(),
    loadRunners(),
    loadAgentTasks(),
  ]);
  if (bootstrapped) deferWork(loadSecondary, 400);
  else await loadSecondary();

  // Auto-sync active identity skills on startup
  const activeId = data.identities.find(i => i.active);
  if (activeId) {
    setTimeout(async () => {
      const sr = await safeBridge("syncIdentitySkills", null, activeId.id);
      if (sr.ok) {
        var copied2 = sr.data?.copied?.length || 0;
        var missing2 = sr.data?.missing?.length || 0;
        if (copied2 > 0 || missing2 > 0) {
          var msg2 = "Skills 已同步 " + copied2 + " 个";
          toast(msg2, missing2 > 0 ? "error" : "success");
        }
      }
    }, 500);
  }

  // Wave 3: Deep scan + heavy ops
  deferWork(() => throttledRefresh(), 1000);
  deferWork(() => loadDiag(), 1200);
  deferWork(() => loadUsage(), 1400);
  deferWork(() => loadAutomations(), 1600);
}

export async function throttledRefresh(force = false) {
  if (!force && Date.now() - getLastRefresh() < 15000) return;
  setLastRefresh(Date.now());
  await refreshProjectIndex();
}

async function showShortcutModal() {
  const { showModal } = await import("./modal.js");
  const shortcuts = [
    ["Ctrl/⌘ + K", "命令面板"],
    ["Ctrl/⌘ + N", "新建对话"],
    ["Ctrl/⌘ + /", "搜索"],
    ["Ctrl/⌘ + B", "切换侧边栏"],
    ["Ctrl/⌘ + .", "切换右侧面板"],
    ["Ctrl/⌘ + Shift + T", "切换主题"],
    ["Ctrl/⌘ + Shift + D", "切换密度"],
    ["Esc", "关闭面板 / 停止运行"],
    ["↑（输入框）", "上一条历史输入"],
    ["↓（输入框）", "下一条历史输入"],
    ["/（输入框）", "触发快捷命令"],
  ];
  const html = shortcuts.map(([key, desc]) =>
    `<div class="shortcut-row"><span class="shortcut-desc">${desc}</span><span class="shortcut-keys">${key.split("+").map(k => `<kbd class="kbd">${k.trim()}</kbd>`).join("+")}</span></div>`
  ).join("");
  await showModal("键盘快捷键", []);
  const fieldsEl = document.querySelector("#modalFields");
  if (fieldsEl) fieldsEl.innerHTML = `<div class="shortcut-list">${html}</div>`;
}
export function initApp() {
  const bridge = getBridge();
  const openWorkspaceWindow = async () => {
    const r = await bridge?.openWorkspaceWindow?.(state.cwd || "");
    toast(r?.ok ? "已打开新的本地工作区窗口" : (r?.error || "当前运行环境不支持多窗口"), r?.ok ? "success" : "error");
  };

  // Window controls
  $("#winMinimize")?.addEventListener("click", () => runtimeAction("WindowMinimise")());
  $("#winMaximize")?.addEventListener("click", () => runtimeAction("WindowToggleMaximise")());
  $("#winClose")?.addEventListener("click", () => runtimeAction("Quit")());

  // Brand menu
  const brandBtn = $("#brandMenuBtn");
  const brandDropdown = $("#brandDropdown");
  brandBtn?.addEventListener("click", e => {
    if (!brandDropdown) return;
    e.stopPropagation();
    const isOpen = brandDropdown.classList.contains("is-open");
    closeAllDropdowns();
    if (!isOpen) {
      const rect = brandBtn.getBoundingClientRect();
      brandDropdown.style.top = `${rect.bottom + 4}px`;
      brandDropdown.style.left = `${rect.left}px`;
      brandDropdown.style.right = "auto";
      brandDropdown.style.bottom = "auto";
      brandDropdown.classList.add("is-open");
    }
  });
  brandDropdown?.querySelectorAll("[data-tab]").forEach(item => {
    item.addEventListener("click", () => {
      brandDropdown.classList.remove("is-open");
      if (item.dataset.tab === "teams") openTeamsBuilder();
      else openSettings(item.dataset.tab);
    });
  });

  // Sidebar toggle
  const sidebar = $("#sidebar");
  const contextStack = $("#contextStack");
  $("#sidebarToggle")?.addEventListener("click", () => {
    state.sidebarOpen = !state.sidebarOpen;
    save();
    sidebar.classList.toggle("is-collapsed", !state.sidebarOpen);
  });
  $("#contextToggle")?.addEventListener("click", () => {
    state.contextOpen = !(state.contextOpen !== false);
    save();
    contextStack?.classList.toggle("is-collapsed", !state.contextOpen);
  });

  // Plan buttons
  $("#approvePlanBtn")?.addEventListener("click", () => {
    if (!state.pendingPlanPrompt) return;
    $("#promptInput").value = `请按计划执行。\n\n原始任务：${state.pendingPlanPrompt}`;
    autosize();
    state.pendingPlanPrompt = "";
    save();
  });
  $("#revisePlanBtn")?.addEventListener("click", () => {
    if (!state.pendingPlanPrompt) return;
    $("#promptInput").value = `请修改计划：\n\n${state.pendingPlanPrompt}`;
    autosize();
  });
  $("#cancelPlanBtn")?.addEventListener("click", () => { state.pendingPlanPrompt = ""; save(); });

  // Run/stop button
  const runStopBtn = $("#runStopBtn");
  runStopBtn?.addEventListener("click", async e => {
    const runId = getCurrentRunId();
    if (runId) {
      e.preventDefault();
      if (bridge?.stopClaude) await bridge.stopClaude(runId);
      setRunning(false);
    }
  });

  // New chat buttons
  $("#newChatBtn")?.addEventListener("click", newChat);
  $("#newChatBtn2")?.addEventListener("click", newChat);

  // Search
  $("#searchBtn")?.addEventListener("click", openSearchPanel);
  $("#searchCloseBtn")?.addEventListener("click", closeSearchPanel);
  $("#globalSearchInput")?.addEventListener("input", e => renderSearchResults(e.currentTarget.value));

  // Quick actions
  $("#pluginsBtn")?.addEventListener("click", async () => { await loadPlugins(); openSettings("plugins"); });
  $("#teamsBtn")?.addEventListener("click", openTeamsBuilder);
  $("#helpBtn")?.addEventListener("click", () => { closeAllDropdowns(); openHelp(); });
  $("#refreshIndexBtn")?.addEventListener("click", () => throttledRefresh(true));

  // Add folder button
  $("#addFolderBtn")?.addEventListener("click", async () => {
    if (!bridge?.chooseFolder) {
      toast("当前运行环境不支持选择目录，请在桌面应用中打开。", "error");
      return;
    }
    const folder = await bridge?.chooseFolder?.();
    if (!folder) return;
    state.cwd = folder;
    const existingPaths = new Set(data.projects.map(p => (p.path || "").toLowerCase()));
    if (!existingPaths.has(folder.toLowerCase())) {
      const proj = { id: folder, name: basename(folder), path: folder, updatedAt: Math.floor(Date.now() / 1000), sessions: [], sessionCount: 0 };
      data.projects.unshift(proj);
      state.customProjects = state.customProjects || [];
      if (!state.customProjects.some(p => (p.path || "").toLowerCase() === folder.toLowerCase())) {
        state.customProjects.push(proj);
      }
    }
    state.selectedProject = folder;
    save();
    renderProjects();
    updateFooter();
    toast(`已选择项目：${basename(folder)}`, "success");
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", e => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "Escape") {
      // Close command palette first
      const cmdOverlay = $('#cmdPaletteOverlay');
      if (cmdOverlay?.classList.contains('is-open')) { closeCommandPalette(); return; }
      if (teamsPage?.classList.contains("is-open")) { teamsPage.classList.remove("is-open"); return; }
      if (settingsPage.classList.contains("is-open")) { settingsPage.classList.remove("is-open"); return; }
      if (getCurrentRunId() && bridge?.stopClaude) { bridge.stopClaude(getCurrentRunId()); setRunning(false); return; }
    }
    if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); openCommandPalette(); return; }
    if (mod && e.key.toLowerCase() === "n") { e.preventDefault(); newChat(); return; }
    if (mod && e.key.toLowerCase() === "/") { e.preventDefault(); openSearchPanel(); return; }
    if (mod && e.key.toLowerCase() === "b") { e.preventDefault(); $('#sidebarToggle')?.click(); return; }
    if (mod && e.key === ".") { e.preventDefault(); $('#contextToggle')?.click(); return; }
    if (mod && e.shiftKey && e.key.toLowerCase() === "t") { e.preventDefault(); toggleTheme(); return; }
    if (mod && e.shiftKey && e.key.toLowerCase() === "d") { e.preventDefault(); cycleDensity(); return; }
  });

  // Bridge event subscriptions
  if (bridge?.onBootstrap) bridge.onBootstrap(applyBootstrap);
  if (bridge?.onProjectIndex) bridge.onProjectIndex(handleProjectIndex);
  if (bridge?.onIdentityAnalysis) bridge.onIdentityAnalysis(handleIdentityAnalysis);

  // Initialize sub-modules
  configureDataLoader({
    updateFooter, populateModelDropdown, populateIdentitiesSubmenu,
    renderProjects, renderConvs, renderContextStack, renderSettingsTab,
    validateActiveSession, settingsPage,
  });
  configureContextFooter({
    curProvider: () => data.providers.find(p => p.current) || data.providers[0] || null,
    selProject: () => data.projects.find(p => p.id === state.selectedProject) || data.projects[0] || null,
    updateModelLabel,
    getAttachedFiles,
    recordReplayEvent,
    friendlyProgress: (text) => String(text || "")
      .replace(/启动中/g, "准备上下文")
      .replace(/启动/g, "准备")
      .replace(/复用 runner/gi, "继续处理")
      .replace(/runner/gi, "工作进程")
      .replace(/进程已退出/g, "已完成"),
  });
  configureMessages({
    getCurrentRunId,
    renderArtifacts: () => import("./context-footer.js").then(m => m.renderArtifacts()),
    openSettings,
    openTeamsBuilder,
    retryLastPrompt,
  });
  configureProjectNav({
    renderMessages, updateFooter, setMode, addTimeline,
    getInitialLoadDone: () => initialLoadDone,
  });
  configureSearch({
    selectProject, selectSession,
    switchIdentity: (id) => switchIdentitySetting(id, { settingsBody, renderSettingsTab, updateFooter, populateIdentitiesSubmenu }),
    openTeamsBuilder,
    renderProjects, renderConvs,
  });
  configureDropdowns({
    switchIdentity: (id) => switchIdentitySetting(id, { settingsBody, renderSettingsTab, updateFooter, populateIdentitiesSubmenu }),
    switchProvider: (id) => switchProviderSetting(id, { renderSettingsTab, updateFooter, populateModelDropdown }),
    openSettings, syncActiveIdentity, addAttachments,
    renderProjects, updateFooter, setPerm,
    closeSearchPanel,
  });
  configureSettings({
    loadPlugins, loadMcp, loadRunners, loadUsage, loadDiag, loadTeams, loadAgentTasks,
    settingsPage,
    updateFooter, populateModelDropdown, populateIdentitiesSubmenu,
    setPerm,
    curProvider: () => data.providers.find(p => p.current) || data.providers[0] || null,
    selProject: () => data.projects.find(p => p.id === state.selectedProject) || data.projects[0] || null,
    switchIdentity: (id) => switchIdentitySetting(id, { settingsBody, renderSettingsTab, updateFooter, populateIdentitiesSubmenu }),
    claudeSetupState, updateClaudeSetupState: (v) => Object.assign(claudeSetupState, v),
    showSetupBanner: (result) => import("./setup.js").then(m => m.showSetupBanner(result)),
  });
  configureSetup({ boot });
  configureOnboarding({ openSettings, openTeamsBuilder });
  configureChatEngine({
    switchProvider: (id) => switchProviderSetting(id, { renderSettingsTab, updateFooter, populateModelDropdown }),
    renderMessages, updateFooter, renderContextStack, renderAttachments, renderArtifacts: () => import("./context-footer.js").then(m => m.renderArtifacts()),
    addTimeline, renderConvs, renderProjects,
    populateModelDropdown, populateIdentitiesSubmenu,
    validateActiveSession, recoverMissingSession,
    promptWithAttachments, addAttachments,
    setAttachedFiles, setRunTimeline, setRunTouchedFiles, setLastTimelineKey,
    startReplayRun, finishReplayRun, openReplayPanel, loadPlugins,
    compactPath: (path) => { const text = String(path || ""); if (!text) return "--"; if (text.length <= 42) return text; return `${text.slice(0, 18)}...${text.slice(-20)}`; },
    timelineFromClaudeEvent,
    updatePermDropdown: (pm) => {
      const addDropdown = $("#addMenu");
      if (addDropdown) addDropdown.querySelectorAll(".add-option").forEach(opt => { opt.classList.toggle("is-active", opt.dataset.action === pm); });
    },
    newChat, openSettings, openHelp,
    exportConversation,
  });

  configureCommandPalette({
    newChat, openSearchPanel, openSettings, openHelp,
    toggleTheme, cycleDensity, selectProject,
    switchIdentity: (id) => switchIdentitySetting(id, { settingsBody, renderSettingsTab, updateFooter, populateIdentitiesSubmenu }),
    switchProvider: (id) => switchProviderSetting(id, { renderSettingsTab, updateFooter, populateModelDropdown }),
    compactPath: (path) => { const text = String(path || ""); if (!text) return "--"; if (text.length <= 42) return text; return `${text.slice(0, 18)}...${text.slice(-20)}`; },
    setPerm,
    showShortcuts: () => showShortcutModal(),
    exportConversation,
    openReplayPanel,
    openWorkspaceWindow,
  });

  configureSlashCommands({
    newChat, setPerm, openSettings, openHelp,
    toggleTheme, autosize: () => autosize(),
    exportConversation, openReplayPanel, openWorkspaceWindow,
  });

  // Initialize sub-modules
  initDropdowns();
  initSettings();
  initSetup();
  initOnboarding();
  initChatEngine();
  initCommandPalette();
  initSlashCommands();
  initTooltip();
  initTheme();
  initNotifications();
  initProjectNav();

  // Boot
  boot().catch(e => {
    console.error("Init error:", e);
  });

  // Auto-refresh
  setInterval(throttledRefresh, 60000);
  window.addEventListener("focus", throttledRefresh);
}
