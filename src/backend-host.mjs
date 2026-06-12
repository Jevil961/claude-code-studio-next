import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, rmSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { homedir } from "node:os";

globalThis.__agentBridgeEmit = (channel, payload = {}) => {
  process.stdout.write(JSON.stringify({ type: "event", channel, payload }) + "\n");
};

const providers = await import("./db/providers.js");
const skills = await import("./db/skills.js");
const mcp = await import("./db/mcp.js");
const runner = await import("./runner/ClaudeRunner.js");
const claudeSetup = await import("./claude-setup.js");
const { getDb } = await import("./db/connection.js");
const { categorizeAllSkills, CATEGORIES } = await import("./skill-categories.js");
const identities = await import("./identities.js");
const teams = await import("./teams.js");
const agentTasks = await import("./agent-tasks.js");
const { PROVIDER_PRESETS, API_FORMATS } = await import("./provider-presets.js");
const { assertInsidePath, assertNotSymlink, assertRealInsidePath, safeReadTextFile, validatePluginInstallName } = await import("./path-security.js");

let dbReady = false;
let projectIndexRunning = false;
const PLUGIN_ROOT = join(homedir(), ".claude", "plugins");

async function ensureDb() {
  if (!dbReady) {
    await getDb();
    dbReady = true;
  }
}

function ok(data) {
  return { ok: true, data };
}

function fail(error, extra = {}) {
  return { ok: false, error: error?.message || String(error), ...extra };
}

async function withDb(fn) {
  await ensureDb();
  return ok(await fn());
}

async function wrapped(fn) {
  return ok(await fn());
}

function extractJsonObject(text) {
  const raw = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("AI did not return JSON");
  return JSON.parse(raw.slice(start, end + 1));
}

function streamJsonText(stdout) {
  let text = "";
  for (const line of String(stdout || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const content = event.message?.content || event.content || [];
    if (Array.isArray(content)) text += content.map(part => part?.text || "").join("");
    if (typeof event.result === "string") text += event.result;
  }
  return text;
}

async function analyzeSkillsWithClaude(allSkills, emit = () => {}) {
  emit("locating-claude", "Locating Claude CLI");
  const claudePath = await runner.resolveClaude();
  if (!claudePath) throw new Error("Claude CLI not found");
  const categorized = categorizeAllSkills(allSkills).filter(s => s.inCcSwitch !== false);
  emit("preparing", `Preparing ${categorized.length} skills`);
  const sample = categorized.slice(0, 160).map(s => ({
    directory: s.directory,
    name: s.name,
    description: s.description,
    category: s.category,
  }));
  const prompt = [
    "IMPORTANT: classify Skills into capability categories. Do not invent direct persona templates.",
    "Each category will later be represented as an identity/capability set in the UI.",
    "Return strict JSON with top-level key categories, not identities.",
    "JSON schema: {\"categories\":[{\"name\":\"string\",\"icon\":\"short ascii\",\"description\":\"string\",\"reason\":\"string\",\"skills\":[\"directory\"]}]}",
    `Skills:\n${JSON.stringify(sample)}`,
  ].join("\n\n");

  return await new Promise((resolve, reject) => {
    emit("ai-running", "Running Claude skill analysis");
    execFile(
      claudePath,
      ["-p", prompt, "--output-format", "stream-json", "--verbose", "--permission-mode", "plan"],
      { windowsHide: true, timeout: 120000, env: { ...process.env, NO_COLOR: "1" } },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(String(stderr || err.message || "Claude analysis failed").slice(0, 400)));
        try {
          emit("ai-parsing", "Parsing Claude skill analysis");
          resolve(extractJsonObject(streamJsonText(stdout) || stdout));
        } catch (e) {
          reject(e);
        }
      },
    );
  });
}

function readPluginManifest(pluginDir) {
  const candidates = [
    join(pluginDir, ".claude-plugin", "plugin.json"),
    join(pluginDir, ".codex-plugin", "plugin.json"),
    join(pluginDir, "plugin.json"),
    join(pluginDir, "package.json"),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try { return { ...JSON.parse(readFileSync(file, "utf8")), manifestPath: file }; } catch {}
  }
  return null;
}

function sanitizePluginId(value) {
  return String(value || "plugin").trim().replace(/^@/, "").replace(/[\\/:"*?<>|\s]+/g, "-").slice(0, 80) || "plugin";
}

const handlers = {
  bootstrapData: async () => {
    await ensureDb();
    const safe = (fn, fallback) => { try { return fn(); } catch (e) { console.error("[bootstrap] module error:", e.message); return fallback; } };
    const projectsModule = await import("./db.js");
    return ok({
      providers: safe(() => providers.list(), []),
      identities: safe(() => identities.getIdentities(), []),
      teams: safe(() => teams.listTeams(), []),
      agentTasks: safe(() => agentTasks.listAgentTasks(), []),
      projects: safe(() => projectsModule.listProjects(), []),
      runners: safe(() => runner.listRunners(), []),
    });
  },
  listProviders: () => withDb(() => providers.list()),
  switchProvider: (id) => withDb(() => providers.switchTo(id)),
  createProvider: (data) => withDb(() => providers.create(data)),
  updateProvider: (id, updates) => withDb(() => providers.update(id, updates)),
  deleteProvider: (id) => withDb(() => providers.remove(id)),
  testProvider: (id) => withDb(() => providers.testConnection(id)),
  listSkills: () => withDb(() => skills.list()),
  syncSkills: (dirs) => withDb(() => skills.sync(dirs)),
  previewSkillsSync: (dirs) => withDb(() => skills.previewSync(dirs)),
  importSkill: (path) => withDb(() => skills.importDir(path)),
  updateSkill: (directory, updates) => withDb(() => skills.update(directory, updates)),
  deleteSkill: (directory) => withDb(() => skills.remove(directory)),
  listMcp: () => withDb(() => mcp.list()),
  syncMcp: () => withDb(() => mcp.sync()),
  previewMcpSync: () => withDb(() => mcp.previewSync()),
  setMcpEnabled: (id, enabled) => withDb(() => mcp.setEnabled(id, enabled)),
  addMcp: (name, config) => withDb(() => mcp.add(name, config)),
  importMcp: (path) => withDb(() => mcp.importFile(path)),
  updateMcp: (id, updates) => withDb(() => mcp.update(id, updates)),
  deleteMcp: (id) => withDb(() => mcp.remove(id)),
  rescanSkills: () => withDb(() => {
    const result = skills.rescan();
    identities.reconcileWithSkills(categorizeAllSkills(skills.list()));
    return result;
  }),
  listSkillCategories: () => withDb(() => {
    const all = skills.list();
    const categorized = categorizeAllSkills(all);
    identities.reconcileWithSkills(categorized);
    const groups = {};
    for (const key of Object.keys(CATEGORIES)) groups[key] = [];
    for (const skill of categorized) {
      const category = skill.category || "other";
      if (!groups[category]) groups[category] = [];
      groups[category].push(skill);
    }
    return { groups, categoryInfo: CATEGORIES, skills: categorized };
  }),
  syncIdentitySkills: (identityId) => withDb(() => {
    const all = skills.list();
    const categorized = categorizeAllSkills(all);
    const identity = identityId
      ? identities.getIdentities().find(i => i.id === identityId)
      : identities.getActiveIdentity();
    if (!identity) throw new Error("No identity");
    const raw = identities.resolveIdentitySkillDirectories(identity, categorized);
    return skills.sync([...new Set(raw)]);
  }),
  listIdentities: () => ok(identities.getIdentities()),
  getActiveIdentity: () => ok(identities.getActiveIdentity()),
  setActiveIdentity: (id) => ok(identities.setActiveIdentity(id)),
  createIdentity: (data) => ok(identities.createIdentity(data)),
  updateIdentity: (id, updates) => ok(identities.updateIdentity(id, updates)),
  deleteIdentity: (id) => ok(identities.deleteIdentity(id)),
  autoGenerateIdentities: () => withDb(() => identities.autoGenerateIdentities(skills.list())),
  analyzeSkillsIdentities: async () => {
    const emit = (status, message, extra = {}) => {
      globalThis.__agentBridgeEmit("identities:analysis", { status, message, at: Date.now(), ...extra });
    };
    await ensureDb();
    emit("loading-skills", "Loading skills");
    const all = skills.list();
    let analysis;
    let source = "ai-analysis";
    try {
      analysis = await analyzeSkillsWithClaude(all, emit);
    } catch (e) {
      emit("fallback", "Claude analysis failed, using local analysis", { warning: e?.message || String(e) });
      analysis = identities.localSkillAnalysis(all);
      source = "local-analysis";
      analysis.warning = e?.message || String(e);
    }
    emit("applying", "Applying generated identities");
    const applied = identities.applyAnalyzedIdentities(analysis, all, source);
    const payload = { ...applied, warning: analysis.warning || "", preview: analysis.categories || analysis.identities || [] };
    emit("done", `Generated ${payload.generated || 0} identities`, { source, generated: payload.generated || 0 });
    return ok(payload);
  },
  setCategoryEnabled: (identityId, categoryId, enabled) => ok(identities.setCategoryEnabled(identityId, categoryId, enabled)),
  setSkillInCategory: (identityId, categoryId, skillDir, enabled) => ok(identities.setSkillInCategory(identityId, categoryId, skillDir, enabled)),
  enableAllInCategory: (identityId, categoryId) => ok(identities.enableAllInCategory(identityId, categoryId)),
  disableAllInCategory: (identityId, categoryId) => ok(identities.disableAllInCategory(identityId, categoryId)),
  listTeams: () => ok(teams.listTeams()),
  createTeam: (data) => ok(teams.createTeam(data)),
  updateTeam: (teamId, updates) => ok(teams.updateTeam(teamId, updates)),
  deleteTeam: (teamId) => ok(teams.deleteTeam(teamId)),
  createTeamMember: (teamId, data) => ok(teams.createTeamMember(teamId, data)),
  updateTeamMember: (teamId, memberId, updates) => ok(teams.updateTeamMember(teamId, memberId, updates)),
  deleteTeamMember: (teamId, memberId) => ok(teams.deleteTeamMember(teamId, memberId)),
  createTeamStep: (teamId, data) => ok(teams.createTeamStep(teamId, data)),
  updateTeamStep: (teamId, stepId, updates) => ok(teams.updateTeamStep(teamId, stepId, updates)),
  deleteTeamStep: (teamId, stepId) => ok(teams.deleteTeamStep(teamId, stepId)),
  updateTeamWorkflow: (teamId, updates) => ok(teams.updateTeamWorkflow(teamId, updates)),
  composeTeamStepPrompt: (payload) => ok(teams.composeTeamStepPrompt(payload)),
  listAgentTasks: () => ok(agentTasks.listAgentTasks()),
  createAgentTask: (data) => ok(agentTasks.createAgentTask(data)),
  createAgentTaskBatch: (data) => ok(agentTasks.createAgentTaskBatch(data)),
  updateAgentTask: (taskId, updates) => ok(agentTasks.updateAgentTask(taskId, updates)),
  deleteAgentTask: (taskId) => ok(agentTasks.deleteAgentTask(taskId)),
  prepareAgentTask: async (taskId) => ok(await agentTasks.prepareAgentTask(taskId)),
  collectAgentTaskEvidence: async (taskId) => ok(await agentTasks.collectAgentTaskEvidence(taskId)),
  commitAgentTask: async (taskId, message) => ok(await agentTasks.commitAgentTask(taskId, message)),
  discardAgentTaskChanges: async (taskId) => ok(await agentTasks.discardAgentTaskChanges(taskId)),
  planAgentTaskQueue: () => ok(agentTasks.planAgentTaskQueue()),
  exportAgentTaskAudit: (taskId, format) => ok(agentTasks.exportAgentTaskAudit(taskId, format)),
  getProviderPresets: () => ok({ presets: PROVIDER_PRESETS, apiFormats: API_FORMATS }),
  fetchModels: (opts = {}) => withDb(async () => {
    const preset = PROVIDER_PRESETS.find(p => p.id === opts.presetId || p.baseUrl === opts.baseUrl || p.name === opts.name);
    const fallbackModels = preset ? [...(preset.models || []), ...(preset.altFormat?.models || [])] : [];
    const target = {
      ...opts,
      name: opts.name || preset?.name || "Provider",
      baseUrl: opts.baseUrl || preset?.baseUrl || "",
      apiFormat: opts.apiFormat || preset?.apiFormat || "openai",
    };
    const remote = await providers.fetchModels(target);
    if (remote.ok) return remote;
    return {
      ...remote,
      models: fallbackModels,
      modelCount: fallbackModels.length,
      source: fallbackModels.length ? "preset-fallback" : remote.source,
      fallback: Boolean(fallbackModels.length),
    };
  }),
  runClaude: async (payload = {}) => {
    if (!payload.prompt?.trim()) return fail("Empty prompt");
    if (payload.sessionId) {
      const { validateSession } = await import("./db.js");
      const session = validateSession(payload.sessionId);
      if (!session.exists) {
        return fail(session.error || `No conversation found with session ID: ${payload.sessionId}`, {
          code: "SESSION_MISSING",
          recoverable: true,
        });
      }
    }
    const runId = payload.runId || globalThis.crypto.randomUUID();
    const claudePath = await runner.resolveClaude(payload.claudePath);
    if (payload.runnerStrategy === "strict" || payload.runnerStrategy === "oneshot") {
      runner.spawnOnce({ ...payload, runId, claudePath });
      return { ok: true, runId, keptAlive: false };
    }
    const result = runner.runPersistent({ ...payload, runId, claudePath });
    if (!result.ok && result.fallback) {
      runner.spawnOnce({ ...payload, runId, claudePath });
      return { ok: true, runId, fallback: true };
    }
    return result.ok ? { ok: true, runId, keptAlive: false, managed: true } : fail(result.error);
  },
  stopClaude: (runId) => runner.stopRun(runId),
  answerQuestion: ({ runId, toolUseId, answer }) => runner.answerQuestion(runId, toolUseId, answer),
  reconnectClaude: () => runner.stopAll(),
  listRunners: () => ok(runner.listRunners()),
  stopRunner: (key) => ok(runner.stopByKey(key)),
  checkEnv: async () => {
    const result = await runner.checkClaude();
    const setup = claudeSetup.detectClaude(result.claudePath);
    return {
      ...setup,
      claudePath: result.claudePath || setup.claudePath,
      claudeVersion: result.version || setup.version,
      version: result.version || setup.version,
      ccSwitchPath: "(integrated)",
      ok: result.ok,
      error: result.error,
    };
  },
  checkClaude: async (preferred) => ok(await runner.checkClaude(preferred)),
  openCcSwitch: async () => {
    const path = join(homedir(), ".cc-switch");
    if (existsSync(path)) await import("./event-bus.js").then(m => m.openPathTarget(path));
    return { ok: true };
  },
  readText: (path) => {
    if (!path || !existsSync(path)) return { ok: false };
    assertRealInsidePath(homedir(), path, "readText path");
    return ok(safeReadTextFile(path));
  },
  detectClaude: (path) => ok(claudeSetup.detectClaude(path)),
  getClaudeSetup: () => ok(claudeSetup.getConfig()),
  dismissSetup: () => ok(claudeSetup.dismissSetup()),
  resetSetup: () => ok(claudeSetup.resetSetup()),
  fetchClaudeVersions: async () => ok(await claudeSetup.fetchVersions()),
  installClaude: (version) => ok({ installId: claudeSetup.installClaude(version) }),
  cancelInstall: (id) => ok(claudeSetup.cancelInstall(id)),
  openNodeDownload: () => ok(claudeSetup.openNodeDownload()),
  installNode: () => ok({ installId: claudeSetup.installNodeViaWinget() }),
  fetchNodeVersions: async () => ok(await claudeSetup.fetchNodeVersions()),
  installNodeMsi: (version) => ok({ installId: claudeSetup.installNode(version) }),
  listProjects: async () => ok((await import("./db.js")).listProjects()),
  refreshProjects: async () => ok((await import("./db.js")).refreshProjects()),
  refreshProjectsBackground: async (options = {}) => {
    if (projectIndexRunning) return ok({ running: true });
    projectIndexRunning = true;
    globalThis.__agentBridgeEmit("projects:index", { status: "queued", startedAt: Date.now() });
    setTimeout(async () => {
      try {
        globalThis.__agentBridgeEmit("projects:index", { status: "scanning", startedAt: Date.now() });
        const { refreshProjects } = await import("./db.js");
        const result = refreshProjects({
          budgetMs: Number(options.budgetMs ?? 500),
          visibleSessionCount: Number(options.visibleSessionCount ?? 16),
          titleScanCount: Number(options.titleScanCount ?? 6),
          maxProjects: Number(options.maxProjects ?? 120),
        });
        globalThis.__agentBridgeEmit("projects:index", { status: "done", result, finishedAt: Date.now() });
      } catch (e) {
        globalThis.__agentBridgeEmit("projects:index", { status: "error", error: e?.message || String(e), finishedAt: Date.now() });
      } finally {
        projectIndexRunning = false;
      }
    }, 0);
    return ok({ running: true });
  },
  validateSession: async (id) => ok((await import("./db.js")).validateSession(id)),
  readSession: async (id) => ok((await import("./db.js")).readSession(id)),
  listPlugins: async () => ok((await import("./db.js")).listPlugins()),
  importPluginFolder: async (sourcePath) => {
    if (!sourcePath || !existsSync(sourcePath) || !statSync(sourcePath).isDirectory()) return fail("Please choose a plugin folder");
    assertNotSymlink(sourcePath, "Plugin source");
    const manifest = readPluginManifest(sourcePath);
    if (!manifest) return fail("Plugin manifest not found");
    const targetRoot = PLUGIN_ROOT;
    const pluginId = sanitizePluginId(manifest.id || manifest.name || sourcePath.split(/[\\/]/).filter(Boolean).pop());
    const target = join(targetRoot, pluginId);
    assertInsidePath(targetRoot, target, "Plugin install target");
    if (sourcePath.toLowerCase() === target.toLowerCase()) return ok({ path: target, manifest, alreadyInstalled: true });
    mkdirSync(targetRoot, { recursive: true });
    cpSync(sourcePath, target, { recursive: true, force: true, dereference: false });
    return ok({ path: target, manifest, pluginId });
  },
  installPluginByName: async (pluginName) => {
    const claudePath = await runner.resolveClaude();
    if (!claudePath) return fail("Claude CLI not found");
    const name = validatePluginInstallName(pluginName);
    return await new Promise(resolve => {
      execFile(claudePath, ["plugin", "install", name], { windowsHide: true, timeout: 45000, env: { ...process.env, NO_COLOR: "1" } }, (err, stdout, stderr) => {
        const output = String(stdout || "").trim();
        const errOut = String(stderr || "").trim();
        if (err) return resolve(fail((errOut || err.message || "Install failed").slice(0, 300)));
        resolve(ok({ name, output: output.slice(0, 500) || "Installed" }));
      });
    });
  },
  deletePlugin: (pluginPath) => {
    if (!pluginPath || !existsSync(pluginPath)) return fail("Plugin path does not exist");
    const safePath = assertInsidePath(PLUGIN_ROOT, pluginPath, "Plugin path");
    assertNotSymlink(safePath, "Plugin path");
    rmSync(safePath, { recursive: true, force: true });
    return { ok: true };
  },
  listAutomations: async () => ok((await import("./db.js")).listAutomations()),
  listUsage: async () => ok((await import("./db.js")).listUsage()),
  diagnostics: async (payload) => ok(await (await import("./db.js")).getDiagnostics(payload)),
  diagnosticReport: async (payload) => ok(await (await import("./db.js")).getDiagnosticReport(payload)),
};

const ALLOWED_METHODS = new Set(Object.keys(handlers));

async function call(method, args = []) {
  if (!ALLOWED_METHODS.has(method)) return fail(`Unknown backend method: ${method}`);
  const handler = handlers[method];
  try {
    return await handler(...args);
  } catch (e) {
    return fail(e);
  }
}

function cleanup() {
  try { runner.stopAll(); } catch {}
  try { claudeSetup.cancelAllInstalls?.(); } catch {}
}

process.on("SIGTERM", () => { cleanup(); process.exit(0); });
process.on("SIGINT", () => { cleanup(); process.exit(0); });
process.on("exit", cleanup);

process.stdout.write(JSON.stringify({ type: "ready" }) + "\n");

setTimeout(async () => {
  const result = await call("bootstrapData", []);
  globalThis.__agentBridgeEmit("app:bootstrap", result);
  const detected = await call("detectClaude", []);
  if (detected.ok) globalThis.__agentBridgeEmit("claude:detectResult", detected.data);
}, 500);

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("close", () => {
  setTimeout(() => { cleanup(); process.exit(0); }, 100);
});
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
  } catch (e) {
    process.stdout.write(JSON.stringify({ type: "response", id: null, result: fail(`Bad JSON: ${e.message}`) }) + "\n");
    return;
  }
  const result = await call(request.method, Array.isArray(request.args) ? request.args : []);
  process.stdout.write(JSON.stringify({ type: "response", id: request.id, result }) + "\n");
});
