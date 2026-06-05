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
  };
}

export const state = (() => {
  try { return { ...defaults(), ...JSON.parse(localStorage.getItem(SK) || "{}") }; }
  catch { return defaults(); }
})();

export function save() {
  try {
    localStorage.setItem(SK, JSON.stringify({ ...state, messages: state.messages.map(({ thinking, ...m }) => m) }));
  } catch (e) {
    console.error("[state] save failed:", e.message);
  }
}

export function sessMeta(id) { if (!id) return {}; state.sessionMeta[id] ||= {}; return state.sessionMeta[id]; }
