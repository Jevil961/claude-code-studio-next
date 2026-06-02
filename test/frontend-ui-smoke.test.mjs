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

test("tauri bridge exposes teams workflow methods", () => {
  const source = fs.readFileSync("public/tauri-bridge.js", "utf8");
  const calls = [];
  const window = {
    __TAURI__: {
      core: { invoke: async (command, payload) => { calls.push({ command, payload }); return { ok: true }; } },
      event: { listen: async () => () => {} },
    },
  };

  vm.runInNewContext(source, { window, Promise });

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
  ]) {
    assert.equal(typeof window.agentBridge[method], "function", method);
  }

  window.agentBridge.listTeams();
  assert.equal(calls[0].command, "backend_call");
  assert.equal(calls[0].payload.method, "listTeams");
  assert.equal(calls[0].payload.args.length, 0);
});
