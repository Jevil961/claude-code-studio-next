import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach(name => this.values.add(name)); }
  remove(...names) { names.forEach(name => this.values.delete(name)); }
  toggle(name, force) {
    const on = force ?? !this.values.has(name);
    if (on) this.values.add(name);
    else this.values.delete(name);
    return on;
  }
  contains(name) { return this.values.has(name); }
}

class FakeElement {
  constructor(selector = "") {
    this.selector = selector;
    this.children = [];
    this.classList = new FakeClassList();
    this.style = {};
    this.dataset = {};
    this.textContent = "";
    this.value = "";
    this.disabled = false;
    this.type = "";
    this.className = "";
    this._innerHTML = "";
  }
  append(...nodes) { this.children.push(...nodes); }
  addEventListener() {}
  remove() {}
  focus() {}
  requestSubmit() {}
  closest() { return null; }
  getBoundingClientRect() { return { left: 0, right: 120, top: 0, bottom: 30 }; }
  querySelector() { return new FakeElement(); }
  querySelectorAll() { return []; }
  cloneNode() { return new FakeElement(this.selector); }
  setAttribute(name, value) { this[name] = String(value); }
  set innerHTML(value) {
    this._innerHTML = String(value ?? "");
    this.children = [];
  }
  get innerHTML() { return this._innerHTML; }
}

class FakeTemplate extends FakeElement {
  constructor(child) {
    super();
    this.content = { firstElementChild: child };
  }
}

class FakeConversationButton extends FakeElement {
  constructor() {
    super("conv");
    this.parts = {
      ".conv-item-title": new FakeElement(".conv-item-title"),
      ".conv-item-time": new FakeElement(".conv-item-time"),
      ".conv-item-badge": new FakeElement(".conv-item-badge"),
    };
  }
  cloneNode() { return new FakeConversationButton(); }
  querySelector(selector) { return this.parts[selector] || new FakeElement(selector); }
}

function installFakeDom() {
  const nodes = new Map();
  const get = selector => {
    if (!nodes.has(selector)) nodes.set(selector, new FakeElement(selector));
    return nodes.get(selector);
  };

  globalThis.localStorage = {
    getItem() { return null; },
    setItem() {},
  };
  globalThis.window = {
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener() {},
    requestIdleCallback(fn) { return setTimeout(fn, 0); },
  };
  globalThis.document = {
    querySelector: get,
    querySelectorAll() { return []; },
    createElement: tag => new FakeElement(tag),
    createElementNS: (_ns, tag) => new FakeElement(tag),
    addEventListener() {},
    removeEventListener() {},
  };

  nodes.set("#tplConv", new FakeTemplate(new FakeConversationButton()));
  nodes.set("#tplMessage", new FakeTemplate(new FakeElement("message")));
  return { nodes, get };
}

function installFakeBridge() {
  window.agentBridge = {
    bootstrapData: async () => ({
      ok: true,
      data: {
        providers: [],
        skills: [],
        categorizedSkills: [],
        categoryInfo: {},
        mcp: [],
        identities: [],
        teams: [],
        agentTasks: [],
        projects: [],
        plugins: [],
        automations: [],
        runners: [],
      },
    }),
    checkEnv: async () => ({ ok: true }),
    detectClaude: async () => ({ ok: true, data: { installed: true } }),
    listSkillCategories: async () => ({ ok: true, data: { skills: [], categoryInfo: {} } }),
    listTeams: async () => ({ ok: true, data: [] }),
    listAgentTasks: async () => ({ ok: true, data: [] }),
    listMcp: async () => ({ ok: true, data: [] }),
    listPlugins: async () => ({ ok: true, data: [] }),
    listRunners: async () => ({ ok: true, data: [] }),
    diagnostics: async () => ({ ok: true, data: {} }),
    listUsage: async () => ({ ok: true, data: null }),
    listAutomations: async () => ({ ok: true, data: [] }),
    refreshProjectsBackground: async () => ({ ok: true, data: {} }),
    onBootstrap() {},
    onProjectIndex() {},
    onIdentityAnalysis() {},
    onClaudeEvent() {},
    onClaudeStderr() {},
    onClaudeDone() {},
    onAskUser() {},
    onClaudeDetectResult() {},
    onClaudeInstallProgress() {},
  };
}

function collectHtml(node) {
  return [node.innerHTML || "", ...(node.children || []).map(collectHtml)].join("\n");
}

installFakeDom();

test("bootstrap binds every configure call it uses", () => {
  const source = fs.readFileSync("public/ui/bootstrap.js", "utf8");
  const calls = [...new Set([...source.matchAll(/\b(configure[A-Z]\w*)\s*\(/g)].map(match => match[1]))];
  const imports = new Set();
  for (const match of source.matchAll(/import \{([^}]+)\} from/g)) {
    for (const rawName of match[1].split(",")) {
      const name = rawName.trim();
      imports.add(name.match(/\bas\s+(\w+)$/)?.[1] || name);
    }
  }
  assert.deepEqual(calls.filter(name => !imports.has(name)), []);
});

test("bootstrap entry module imports successfully", async () => {
  const bootstrap = await import("../public/ui/bootstrap.js");

  assert.equal(typeof bootstrap.initApp, "function");
  assert.equal(typeof bootstrap.boot, "function");
});

test("initApp starts without synchronous or boot-time runtime errors", async () => {
  installFakeDom();
  installFakeBridge();
  const originalSetInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  const unhandled = [];
  const onUnhandled = error => unhandled.push(error);
  process.on("unhandledRejection", onUnhandled);

  try {
    const bootstrap = await import("../public/ui/bootstrap.js");
    bootstrap.initApp();
    await new Promise(resolve => setTimeout(resolve, 100));
  } finally {
    process.off("unhandledRejection", onUnhandled);
    globalThis.setInterval = originalSetInterval;
  }

  assert.deepEqual(unhandled.map(error => String(error?.stack || error)), []);
});

test("settings action functions used across modules are exported", async () => {
  const providers = await import("../public/ui/settings/providers.js");
  const identities = await import("../public/ui/settings/identities.js");

  assert.equal(typeof providers.switchProvider, "function");
  assert.equal(typeof identities.switchIdentity, "function");
});

test("artifact rendering consumes a synchronous attachment list", async () => {
  const { get } = installFakeDom();
  const messages = await import("../public/ui/messages.js");
  const contextFooter = await import("../public/ui/context-footer.js");

  messages.setAttachedFiles(["C:/work/input.txt"]);
  contextFooter.configure({ getAttachedFiles: messages.getAttachedFiles });
  contextFooter.renderArtifacts();

  assert.equal(get("#artifactCount").textContent, "1");
  assert.match(get("#artifactList").innerHTML, /input\.txt/);
});

test("project search filters before limiting visible projects", async () => {
  const { get } = installFakeDom();
  const { data, state } = await import("../public/ui/state.js");
  const projectNav = await import("../public/ui/project-nav.js");

  data.projects = Array.from({ length: 25 }, (_, index) => ({
    id: `project-${index}`,
    name: index === 24 ? "needle-project" : `project-${index}`,
    path: `C:/work/${index === 24 ? "needle-project" : `project-${index}`}`,
    sessions: [],
    sessionCount: 0,
  }));
  state.searchTerm = "needle";
  projectNav.configure({ getInitialLoadDone: () => true });
  projectNav.renderProjects();

  assert.equal(get("#projectList").children.length, 1);
  assert.match(get("#projectList").children[0].innerHTML, /needle-project/);
});

test("conversation search filters before limiting visible sessions", async () => {
  const { get } = installFakeDom();
  const { data, state } = await import("../public/ui/state.js");
  const projectNav = await import("../public/ui/project-nav.js");

  const sessions = Array.from({ length: 35 }, (_, index) => ({
    id: `session-${index}`,
    title: index === 34 ? "needle-session" : `session-${index}`,
    updatedAt: index + 1,
  }));
  data.projects = [{ id: "p1", name: "p1", path: "C:/work/p1", sessions }];
  state.selectedProject = "p1";
  state.searchTerm = "needle";
  projectNav.configure({ getInitialLoadDone: () => true });
  projectNav.renderConvs();

  assert.equal(get("#convList").children.length, 1);
  assert.match(get("#convList").children[0].querySelector(".conv-item-title").innerHTML, /needle.*session/);
});

test("teams settings renders user-defined members and workflow steps", async () => {
  installFakeDom();
  const { data, state } = await import("../public/ui/state.js");
  const { renderTeamsSettings } = await import("../public/ui/settings/teams.js");
  const settingsBody = new FakeElement("#settingsBody");

  data.providers = [{ id: "provider-a", name: "Provider A", model: "model-a" }];
  data.identities = [{ id: "identity-a", name: "Architect", icon: "AR" }];
  data.teams = [{
    id: "team-a",
    name: "WorkBuddy",
    description: "User-defined team",
    rules: "Escalate blockers.",
    members: [{
      id: "member-a",
      name: "Reviewer",
      icon: "RV",
      role: "Review plans",
      providerId: "provider-a",
      identityId: "identity-a",
      permissionMode: "plan",
    }],
    workflow: [{
      id: "step-a",
      name: "Review",
      memberId: "member-a",
      instruction: "Find risks",
      requiresApproval: true,
    }],
  }];
  state.selectedTeamId = "team-a";

  renderTeamsSettings({ settingsBody, renderSettingsTab() {} });

  const html = collectHtml(settingsBody);
  assert.match(html, /WorkBuddy/);
  assert.match(html, /Reviewer/);
  assert.match(html, /Review/);
});

test("teams canvas can pan from blank content layers but not nodes", async () => {
  const { canPanTeamCanvasTarget } = await import("../public/ui/settings/teams.js");
  const canvas = { contains: target => target?.insideCanvas === true };
  const blankContent = { insideCanvas: true, closest: () => null };
  const blankSvg = { insideCanvas: true, closest: () => null };
  const nodeCard = { insideCanvas: true, closest: selector => selector.includes(".team-node-card") ? {} : null };
  const outside = { insideCanvas: false, closest: () => null };

  assert.equal(canPanTeamCanvasTarget(canvas, canvas), true);
  assert.equal(canPanTeamCanvasTarget(blankContent, canvas), true);
  assert.equal(canPanTeamCanvasTarget(blankSvg, canvas), true);
  assert.equal(canPanTeamCanvasTarget(nodeCard, canvas), false);
  assert.equal(canPanTeamCanvasTarget(outside, canvas), false);
});

test("teams workflow edge labels are offset to avoid overlapping routes", async () => {
  const { layoutWorkflowEdgesForRender } = await import("../public/ui/settings/teams.js");
  const team = {
    workflow: [
      { id: "pm", x: 100, y: 120 },
      { id: "dev", x: 420, y: 120 },
      { id: "qa", x: 420, y: 180 },
    ],
    workflowEdges: [
      { id: "a", from: "pm", to: "dev", condition: "yes" },
      { id: "b", from: "dev", to: "pm", condition: "no" },
      { id: "c", from: "pm", to: "qa", condition: "revise" },
    ],
  };

  const layouts = layoutWorkflowEdgesForRender(team);
  assert.equal(layouts.length, 3);
  const labels = layouts.map(item => `${Math.round(item.labelX)},${Math.round(item.labelY)}`);
  assert.equal(new Set(labels).size, labels.length);
  assert.notEqual(Math.round(layouts[0].labelY), Math.round(layouts[1].labelY));
});

test("opening the standalone teams builder refreshes teams before rendering", async () => {
  installFakeDom();
  const settings = await import("../public/ui/settings/index.js");
  let loaded = false;

  settings.configure({
    async loadTeams() { loaded = true; },
  });

  await settings.openTeamsBuilder();

  assert.equal(loaded, true);
  assert.equal(settings.teamsPage.classList.contains("is-open"), true);
});

test("first-run wizard and help entry are wired into the shell", () => {
  const html = fs.readFileSync("public/index.html", "utf8");
  const bootstrap = fs.readFileSync("public/ui/bootstrap.js", "utf8");
  const onboarding = fs.readFileSync("public/ui/onboarding.js", "utf8");

  assert.match(html, /id="wizardOverlay"/);
  assert.match(html, /id="helpBtn"/);
  assert.match(bootstrap, /initOnboarding\(\)/);
  assert.match(bootstrap, /openHelp/);
  assert.match(onboarding, /openFirstRunWizard/);
  assert.match(onboarding, /shouldShowFirstRun/);
});

test("desktop shell uses a roomy default window and neutral code logo", () => {
  const html = fs.readFileSync("public/index.html", "utf8");
  const styles = fs.readFileSync("public/styles.css", "utf8");
  const tauri = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
  const win = tauri.app.windows[0];

  assert.equal(win.width, 1360);
  assert.equal(win.height, 860);
  assert.equal(win.minWidth, 980);
  assert.equal(win.minHeight, 620);
  assert.match(html, /class="logo-icon"/);
  assert.match(html, /M6\.4 8\.2 4\.8 10l1\.6 1\.8/);
  assert.doesNotMatch(html, /id="logoGrad"/);
  assert.doesNotMatch(html, /circle cx="10" cy="10"/);
  assert.match(styles, /\.logo-icon[\s\S]*color: var\(--td-brand-color\)/);
  assert.doesNotMatch(styles, /letter-spacing: -0\.2px/);
});

test("installed app detection separates bundled Node from system npm and searches common CLI paths", () => {
  const runner = fs.readFileSync("src/runner/ClaudeRunner.js", "utf8");
  const setup = fs.readFileSync("src/claude-setup.js", "utf8");
  const setupUi = fs.readFileSync("public/ui/setup.js", "utf8");
  const diagnostics = fs.readFileSync("public/ui/settings/diagnostics.js", "utf8");
  const general = fs.readFileSync("public/ui/settings/general.js", "utf8");
  const main = fs.readFileSync("src-tauri/src/main.rs", "utf8");

  assert.match(runner, /\/opt\/homebrew\/bin/);
  assert.match(runner, /\.npm-global/);
  assert.match(runner, /\.nvm/);
  assert.match(runner, /\.asdf/);
  assert.match(runner, /\.volta/);
  assert.match(runner, /env: toolEnv\(\)/);
  assert.match(setup, /hasRuntimeNode/);
  assert.match(setup, /hasSystemNode/);
  assert.match(setup, /npmPath/);
  assert.match(setupUi, /需要系统 Node\.js\/npm/);
  assert.match(setupUi, /打开 Node\.js 下载/);
  assert.match(setupUi, /手动设置路径/);
  assert.match(setupUi, /handleManualClaudePath/);
  assert.match(setupUi, /chooseFile/);
  assert.match(general, /选择 Claude 文件/);
  assert.match(diagnostics, /系统 Node/);
  assert.match(diagnostics, /内置 Node/);
  assert.match(main, /PermissionsExt/);
  assert.match(main, /set_mode\(0o755\)/);
});

test("core empty states include actionable guidance", () => {
  const messages = fs.readFileSync("public/ui/messages.js", "utf8");
  const projectNav = fs.readFileSync("public/ui/project-nav.js", "utf8");
  const providers = fs.readFileSync("public/ui/settings/providers.js", "utf8");
  const mcp = fs.readFileSync("public/ui/settings/mcp.js", "utf8");
  const teams = fs.readFileSync("public/ui/settings/teams.js", "utf8");

  assert.match(messages, /配置 Provider/);
  assert.match(projectNav, /emptyAddProjectBtn/);
  assert.match(projectNav, /emptyFocusPromptBtn/);
  assert.match(providers, /emptyAddProviderBtn/);
  assert.match(mcp, /emptyAddMcpBtn/);
  assert.match(teams, /emptyTemplateTeamBtn/);
});

test("PM Dev QA template does not default team members into plan mode", () => {
  const source = fs.readFileSync("public/ui/settings/teams.js", "utf8");
  const templateSource = source.slice(
    source.indexOf("async function createPmDevQaTemplate"),
    source.indexOf("async function editTeamDlg"),
  );

  assert.doesNotMatch(templateSource, /permissionMode:\s*"plan"/);
  assert.match(templateSource, /permissionMode:\s*"auto"/);
});

test("teams runtime does not propagate plan permission mode into handoff runs", () => {
  const source = fs.readFileSync("public/ui/settings/teams.js", "utf8");

  assert.match(source, /function effectiveTeamPermissionMode/);
  assert.match(source, /member\?\.permissionMode === "bypass" \? "bypass" : "auto"/);
  assert.doesNotMatch(source, /setPerm\?\.\(member\.permissionMode\)/);
  assert.doesNotMatch(source, /\{ value: "plan", label: "Plan" \}/);
});

test("agent task center includes a dedicated diff review overlay", () => {
  const source = fs.readFileSync("public/ui/settings/tasks.js", "utf8");
  const styles = fs.readFileSync("public/styles.css", "utf8");

  assert.match(source, /function ensureDiffReviewOverlay/);
  assert.match(source, /taskDiffReviewOverlay/);
  assert.match(source, /审查 Diff/);
  assert.match(source, /copyCurrentDiffBtn/);
  assert.match(styles, /\.task-review-overlay/);
  assert.match(styles, /\.diff-line-add/);
  assert.match(styles, /\.diff-line-del/);
});

test("session replay, official plugin install shortcut, and security center are wired", () => {
  const messages = fs.readFileSync("public/ui/messages.js", "utf8");
  const chat = fs.readFileSync("public/ui/chat-engine.js", "utf8");
  const slash = fs.readFileSync("public/ui/slash-commands.js", "utf8");
  const palette = fs.readFileSync("public/ui/command-palette.js", "utf8");
  const diagnostics = fs.readFileSync("public/ui/settings/diagnostics.js", "utf8");
  const styles = fs.readFileSync("public/styles.css", "utf8");

  assert.match(messages, /function ensureReplayOverlay/);
  assert.match(messages, /replaySearchInput/);
  assert.match(messages, /replayFilter/);
  assert.match(messages, /copyReplayAuditBtn/);
  assert.match(messages, /msg-recovery-actions/);
  assert.match(messages, /startReplayRun/);
  assert.match(messages, /recordReplayEvent/);
  assert.match(messages, /finishReplayRun/);
  assert.match(chat, /installPluginByName/);
  assert.match(chat, /\/plugin/);
  assert.match(chat, /openWorkspaceWindow/);
  assert.match(slash, /\/replay/);
  assert.match(slash, /\/security/);
  assert.match(slash, /\/window/);
  assert.match(palette, /打开会话回放/);
  assert.match(palette, /打开新的本地工作区窗口/);
  assert.match(diagnostics, /权限与沙箱安全中心/);
  assert.match(diagnostics, /securityFindings/);
  assert.match(styles, /\.replay-overlay/);
  assert.match(styles, /\.replay-tools/);
  assert.match(styles, /\.msg-recovery-actions/);
  assert.match(styles, /\.security-center/);
});

test("agent task center supports batch diff review", () => {
  const source = fs.readFileSync("public/ui/settings/tasks.js", "utf8");
  const backend = fs.readFileSync("src/agent-tasks.js", "utf8");
  const styles = fs.readFileSync("public/styles.css", "utf8");

  assert.match(source, /function showBatchReview/);
  assert.match(source, /combinedReviewTask/);
  assert.match(source, /batchReviewBtn/);
  assert.match(source, /可审查/);
  assert.match(source, /function reviewTask/);
  assert.match(source, /reviewStatusLabel/);
  assert.match(source, /通过审查/);
  assert.match(backend, /reviewStatus/);
  assert.match(backend, /reviewNotes/);
  assert.match(backend, /reviewedAt/);
  assert.match(styles, /\.task-review-state/);
});

test("runner settings expose health and runtime metadata", () => {
  const source = fs.readFileSync("public/ui/settings/runners.js", "utf8");
  const styles = fs.readFileSync("public/styles.css", "utf8");

  assert.match(source, /function runnerHealth/);
  assert.match(source, /runner-health-strip/);
  assert.match(source, /runner-meta/);
  assert.match(styles, /\.runner-card/);
  assert.match(styles, /\.runner-health-strip/);
});

test("tauri bridge exposes teams workflow and agent task methods", () => {
  const source = fs.readFileSync("public/tauri-bridge.js", "utf8");
  const calls = [];
  const window = {
    __TAURI__: {
      core: { invoke: async (command, payload) => { calls.push({ command, payload }); return { ok: true }; } },
      event: { listen: async () => () => {} },
    },
  };

  vm.runInNewContext(source, { window, Promise });
  assert.equal(typeof window.agentBridge.openWorkspaceWindow, "function");

  for (const method of [
    "listTeams",
    "createTeam",
    "updateTeam",
    "deleteTeam",
    "createTeamMember",
    "updateTeamMember",
    "deleteTeamMember",
    "createTeamStep",
    "updateTeamStep",
    "deleteTeamStep",
    "updateTeamWorkflow",
    "composeTeamStepPrompt",
    "listAgentTasks",
    "createAgentTask",
    "createAgentTaskBatch",
    "updateAgentTask",
    "deleteAgentTask",
    "prepareAgentTask",
    "collectAgentTaskEvidence",
    "commitAgentTask",
    "discardAgentTaskChanges",
    "planAgentTaskQueue",
    "exportAgentTaskAudit",
  ]) {
    assert.equal(typeof window.agentBridge[method], "function", method);
  }

  window.agentBridge.listTeams();
  assert.equal(calls[0].command, "backend_call");
  assert.equal(calls[0].payload.method, "listTeams");
  assert.equal(calls[0].payload.args.length, 0);
});
