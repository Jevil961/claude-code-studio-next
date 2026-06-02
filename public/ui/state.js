const SK = "ccs-v6";

export const data = {
  providers: [], skills: [], mcp: [], projects: [], plugins: [], teams: [],
  automations: [], usage: null, runners: [], diagnostics: null,
  identities: [], categorizedSkills: null, categoryInfo: {}, selectedCategory: "all",
  loadErrors: {},
};

export let currentRunId = "";
export let assistantBuffer = "";
export let liveThinking = [];

export function setRunId(v) { currentRunId = v; }
export function setBuffer(v) { assistantBuffer = v; }
export function appendBuffer(v) { assistantBuffer += v; }
export function pushThink(v) { if (v && liveThinking[liveThinking.length - 1] !== v) { liveThinking.push(v); if (liveThinking.length > 8) liveThinking.shift(); } }
export function clearThink() { liveThinking = []; }

function defaults() {
  return {
    panel: "providers", cwd: "", claudePath: "", mode: "normal",
    permissionMode: "auto", runnerStrategy: "strict", messages: [],
    selectedProject: "", selectedSession: "", selectedSessionPath: "",
    clientSessionKey: crypto.randomUUID(), pendingPlanPrompt: "",
    searchTerm: "", sessionMeta: {}, priceTable: {}, defaultCwd: "", customProjects: [], teamRuns: {},
    density: "normal", diagnosticsLog: [], sidebarOpen: true, contextOpen: true, firstRunDone: false,
  };
}

export const state = (() => {
  try { return { ...defaults(), ...JSON.parse(localStorage.getItem(SK) || "{}") }; }
  catch { return defaults(); }
})();

export function save() {
  localStorage.setItem(SK, JSON.stringify({ ...state, messages: state.messages.map(({ thinking, ...m }) => m) }));
}

export function sessMeta(id) { if (!id) return {}; state.sessionMeta[id] ||= {}; return state.sessionMeta[id]; }
