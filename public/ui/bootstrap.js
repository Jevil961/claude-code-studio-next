import { data, save, saveImmediate, state } from "./state.js";
import { getBridge, safeBridge, runtimeAction } from "./bridge.js";
import { $, basename, toast } from "./helpers.js";
import { configure as configureDataLoader, loadProviders, loadSkills, loadSkillCategories, loadIdentities, loadTeams, loadAgentTasks, loadMcp, loadPlugins, loadAutomations, loadUsage, loadRunners, loadAgentRuntimes, loadDiag, loadProjects, refreshProjectIndex, checkEnv, syncActiveIdentity, mergeCustomProjects, projectIndexState, setProjectIndexState, skillCategoriesLoaded, setSkillCategoriesLoaded, getLastRefresh, setLastRefresh, refreshSettingsIfOpen } from "./data-loader.js";
import { configure as configureContextFooter, updateFooter, renderContextStack, addTimeline, timelineFromClaudeEvent, setRunTimeline, setRunTouchedFiles, setLastTimelineKey } from "./context-footer.js";
import { configure as configureMessages, renderMessages, addAttachments, renderAttachments, promptWithAttachments, setAttachedFiles, getAttachedFiles, exportConversation, openReplayPanel, startReplayRun, recordReplayEvent, finishReplayRun, getLatestReplaySnapshot } from "./messages.js";
import { configure as configureProjectNav, renderProjects, selectProject, renderConvs, selectSession, loadSession, recoverMissingSession, validateActiveSession, initProjectNav } from "./project-nav.js";
import { configure as configureSearch, openSearchPanel, closeSearchPanel, renderSearchResults } from "./search.js";
import { configure as configureDropdowns, closeAllDropdowns, populateIdentitiesSubmenu, populateModelDropdown, updateModelLabel, initDropdowns } from "./dropdowns.js";
import { configure as configureSettings, openSettings, openTeamsBuilder, renderSettingsTab, settingsPage, settingsBody, teamsPage, initSettings } from "./settings/index.js";
import { configure as configureSetup, claudeSetupState, getClaudeSetupState, handleClaudeDetectResult, initSetup } from "./setup.js";
import { configure as configureChatEngine, setMode, setPerm, setRunning, autosize, onClaudeEvent, onClaudeStderr, onClaudeDone, handleAskUser, currentRunId, getCurrentRunId, clearCurrentRunId, initChatEngine, retryLastPrompt } from "./chat-engine.js";
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

function setContextOpen(open) {
  const isOpen = Boolean(open);
  const contextStack = $("#contextStack");
  const contextToggle = $("#contextToggle");
  const contextRail = $("#contextRail");
  state.contextOpen = isOpen;
  contextStack?.classList.toggle("is-collapsed", !isOpen);
  contextToggle?.setAttribute("aria-expanded", String(isOpen));
  contextToggle?.setAttribute("aria-label", isOpen ? "隐藏右侧数据" : "展开右侧数据");
  contextRail?.setAttribute("aria-hidden", String(isOpen));
  contextRail?.setAttribute("tabindex", isOpen ? "-1" : "0");
  document.querySelector(".tooltip-content")?.classList.remove("is-visible");
}

export function newChat() {
  state.messages = []; state.selectedSession = ""; state.selectedSessionPath = "";
  state.clientSessionKey = crypto.randomUUID(); state.pendingPlanPrompt = ""; state.mode = "normal";
  saveImmediate(); renderMessages(); $("#promptInput").focus();
}

function setQuickNavActive(key = "chat") {
  document.querySelectorAll(".side-nav-btn[data-quick]").forEach(btn => {
    btn.classList.toggle("is-active", btn.dataset.quick === key);
  });
}

function updateWorkspacePills() {
  const provider = data.providers.find(p => p.current) || data.providers[0] || null;
  const providerPill = $("#workspaceProviderPill");
  const modePill = $("#workspaceModePill");
  if (providerPill) providerPill.textContent = provider ? `${provider.name}${provider.model ? ` / ${provider.model}` : ""}` : "未配置 Provider";
  if (modePill) modePill.textContent = state.permissionMode || "auto";
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
  if (Array.isArray(d.agentRuntimes)) data.agentRuntimes = d.agentRuntimes;
  delete data.loadErrors.bootstrap;
  updateFooter();
  updateWorkspacePills();
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
  // Clear stale search term from previous session
  if (state.searchTerm) { state.searchTerm = ""; save(); }

  const bridge = getBridge();
  const sidebar = $("#sidebar");

  if (state.contextOpen === undefined) state.contextOpen = false;
  if (state.contextAutoShielded !== true) {
    state.contextOpen = false;
    state.contextAutoShielded = true;
    save();
  }
  if (typeof window !== "undefined" && window.innerWidth <= 700) state.sidebarOpen = false;
  sidebar?.classList.toggle("is-collapsed", !state.sidebarOpen);
  setContextOpen(state.contextOpen);
  setPerm(state.permissionMode || "auto");
  renderProjects();
  renderConvs();
  renderMessages();
  updateFooter();
  updateWorkspacePills();
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
  renderMessages();
  updateFooter();
  updateWorkspacePills();
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
    loadAgentRuntimes(),
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
  $("#sidebarToggle")?.addEventListener("click", () => {
    state.sidebarOpen = !state.sidebarOpen;
    save();
    sidebar.classList.toggle("is-collapsed", !state.sidebarOpen);
  });
  const toggleContext = () => {
    setContextOpen(!(state.contextOpen !== false));
    save();
  };
  $("#contextToggle")?.addEventListener("click", toggleContext);
  $("#contextRail")?.addEventListener("click", toggleContext);

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
      clearCurrentRunId();
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
  $("#teamsBtn")?.addEventListener("click", () => { setQuickNavActive("teams"); openTeamsBuilder(); });
  $("#helpBtn")?.addEventListener("click", () => { closeAllDropdowns(); openHelp(); });
  $("#refreshIndexBtn")?.addEventListener("click", () => throttledRefresh(true));

  document.querySelectorAll(".side-nav-btn[data-quick]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const key = btn.dataset.quick || "chat";
      setQuickNavActive(key);
      if (key === "chat") {
        settingsPage?.classList.remove("is-open");
        teamsPage?.classList.remove("is-open");
        $("#promptInput")?.focus();
      } else if (key === "teams") {
        openTeamsBuilder();
      } else if (key === "tasks") {
        openSettings("tasks");
      } else if (key === "providers") {
        openSettings("providers");
      }
    });
  });

  // Add folder button
  $("#addFolderBtn")?.addEventListener("click", async () => {
    if (!bridge?.chooseFolder) {
      toast("当前运行环境不支持选择目录，请在桌面应用中打开。", "error");
      return;
    }
    let folder;
    try {
      folder = await bridge.chooseFolder();
    } catch (e) {
      toast("目录选择失败: " + String(e?.message || e || "unknown"), "error");
      return;
    }
    if (!folder) return; // User cancelled
    state.cwd = folder;
    const folderLower = folder.toLowerCase();
    const existing = data.projects.find(p => (p.path || "").toLowerCase() === folderLower);
    if (existing) {
      state.selectedProject = existing.id;
    } else {
      const proj = { id: folder, name: basename(folder), path: folder, updatedAt: Math.floor(Date.now() / 1000), sessions: [], sessionCount: 0 };
      data.projects.unshift(proj);
      state.customProjects = state.customProjects || [];
      if (!state.customProjects.some(p => (p.path || "").toLowerCase() === folderLower)) {
        state.customProjects.push(proj);
      }
      state.selectedProject = proj.id;
    }
    save();
    renderProjects();
    renderConvs();
    updateFooter();
    updateWorkspacePills();
    toast(`已添加项目：${folder}`, "success");
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
      if (getCurrentRunId() && bridge?.stopClaude) { bridge.stopClaude(getCurrentRunId()); clearCurrentRunId(); setRunning(false); return; }
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
    loadPlugins, loadMcp, loadRunners, loadAgentRuntimes, loadUsage, loadDiag, loadTeams, loadAgentTasks,
    settingsPage,
    updateFooter, populateModelDropdown, populateIdentitiesSubmenu,
    setPerm,
    curProvider: () => data.providers.find(p => p.current) || data.providers[0] || null,
    selProject: () => data.projects.find(p => p.id === state.selectedProject) || data.projects[0] || null,
    switchProvider: (id) => switchProviderSetting(id, { renderSettingsTab, updateFooter, populateModelDropdown }),
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
    startReplayRun, finishReplayRun, getLatestReplaySnapshot, openReplayPanel, loadPlugins,
    compactPath: (path) => { const text = String(path || ""); if (!text) return "--"; if (text.length <= 42) return text; return `${text.slice(0, 18)}...${text.slice(-20)}`; },
    timelineFromClaudeEvent,
    updatePermDropdown: (pm) => {
      const addDropdown = $("#addMenu");
      if (addDropdown) addDropdown.querySelectorAll(".add-option").forEach(opt => { opt.classList.toggle("is-active", opt.dataset.action === pm); });
    },
    newChat, openSettings, openHelp, openTeamsBuilder, openWorkspaceWindow,
    toggleTheme,
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
    newChat, setPerm, openSettings, openHelp, openTeamsBuilder,
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
    initialLoadDone = true;
  });

  // Auto-refresh
  setInterval(throttledRefresh, 60000);
  window.addEventListener("focus", throttledRefresh);

  // localStorage quota warning
  window.addEventListener("ccs:quota-exceeded", () => {
    toast("本地存储已满，部分数据可能无法保存。建议清理旧对话或导出备份。", "warning");
  });
}
