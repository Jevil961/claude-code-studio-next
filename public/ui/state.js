const SK = "ccs-v6";

export const data = {
  providers: [], skills: [], mcp: [], projects: [], plugins: [], teams: [],
  agentTasks: [], automations: [], usage: null, runners: [], diagnostics: null,
  identities: [], categorizedSkills: null, categoryInfo: {}, selectedCategory: "all",
  loadErrors: {},
};

function defaults() {
  return {
    panel: "providers", cwd: "", claudePath: "", mode: "normal",
    permissionMode: "auto", runnerStrategy: "strict", messages: [],
    selectedProject: "", selectedSession: "", selectedSessionPath: "",
    clientSessionKey: crypto.randomUUID(), pendingPlanPrompt: "",
    searchTerm: "", sessionMeta: {}, priceTable: {}, defaultCwd: "", customProjects: [], teamRuns: {},
    density: "default", diagnosticsLog: [], sidebarOpen: true, contextOpen: true, firstRunDone: false,
    teamConnectFrom: "",
  };
}

export const state = (() => {
  try { return { ...defaults(), ...JSON.parse(localStorage.getItem(SK) || "{}") }; }
  catch { return defaults(); }
})();

let _saveTimer = null;
let _lastSaveErr = false;

function doSave() {
  try {
    const { teamConnectFrom, ...persistedState } = state;
    localStorage.setItem(SK, JSON.stringify({ ...persistedState, messages: state.messages.map(({ thinking, originalPrompt, ...m }) => m) }));
    if (_lastSaveErr) { _lastSaveErr = false; }
  } catch (e) {
    console.error("[state] save failed:", e.message);
    if (e.name === "QuotaExceededError" || /quota/i.test(e.message)) {
      _lastSaveErr = true;
      try { window.dispatchEvent(new CustomEvent("ccs:quota-exceeded", { detail: { error: e.message } })); } catch {}
    }
  }
}

export function save() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(doSave, 200);
}

export function saveImmediate() {
  clearTimeout(_saveTimer);
  doSave();
}

export function sessMeta(id) { if (!id) return {}; state.sessionMeta[id] ||= {}; return state.sessionMeta[id]; }
