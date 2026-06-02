function getBridge() { return window.agentBridge; }

export function withTimeout(p, ms, fb) {
  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => resolve(fb), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export function call(method, fb, ...args) {
  const bridge = getBridge();
  if (!bridge || typeof bridge[method] !== "function") return Promise.resolve({ ok: false, error: "Bridge missing", data: fb });
  return withTimeout(bridge[method](...args), 12000, { ok: false, error: `${method} timeout`, data: fb });
}

export async function loadProviders(d) { const r = await call("listProviders", []); if (r.ok) d.providers = r.data || []; return r; }
export async function loadSkills(d) { const r = await call("listSkills", []); if (r.ok) d.skills = r.data || []; return r; }
export async function loadSkillCategories(d) { const r = await call("listSkillCategories", []); if (r.ok && r.data) { d.categorizedSkills = r.data.skills || []; d.categoryInfo = r.data.categoryInfo || {}; d.skills = d.categorizedSkills; } return r; }
export async function loadIdentities(d) { const r = await call("listIdentities", []); if (r.ok) d.identities = r.data || []; return r; }
export async function loadTeams(d) { const r = await call("listTeams", []); if (r.ok) d.teams = r.data || []; return r; }
export async function loadMcp(d) { const r = await call("listMcp", []); if (r.ok) d.mcp = r.data || []; return r; }
export async function loadProjects(d) { const r = await call("listProjects", []); if (r.ok) d.projects = r.data || []; return r; }
export async function loadPlugins(d) { const r = await call("listPlugins", []); if (r.ok) d.plugins = r.data || []; return r; }
export async function loadAutomations(d) { const r = await call("listAutomations", []); if (r.ok) d.automations = r.data || []; return r; }
export async function loadUsage(d) { const r = await call("listUsage", null); if (r.ok) d.usage = r.data || null; return r; }
export async function loadRunners(d) { const r = await call("listRunners", []); if (r.ok) d.runners = r.data || []; return r; }
export async function loadDiag(d, p) { const r = await call("diagnostics", null, p); if (r.ok) d.diagnostics = r.data || null; return r; }
export async function checkEnv() { return await call("checkEnv", {}); }
export async function switchProvider(id) { return await call("switchProvider", null, id); }
export async function switchIdentity(id) { return await call("setActiveIdentity", null, id); }
export async function syncActiveIdentity(id) { return await call("syncIdentitySkills", null, id); }
export async function autoGenIdentities() { return await call("autoGenerateIdentities", null); }
export async function createIdentity(d) { return await call("createIdentity", null, d); }
export async function deleteIdentity(id) { return await call("deleteIdentity", null, id); }
export async function setCategoryEnabled(iid, cid, e) { return await call("setCategoryEnabled", null, iid, cid, e); }
export async function setSkillInCategory(iid, cid, s, e) { return await call("setSkillInCategory", null, iid, cid, s, e); }
export async function enableAllInCategory(iid, cid) { return await call("enableAllInCategory", null, iid, cid); }
export async function updateProvider(id, u) { return await call("updateProvider", null, id, u); }
export async function deleteProvider(id) { return await call("deleteProvider", null, id); }
export async function createProvider(d) { return await call("createProvider", null, d); }
export async function importSkill() { return await call("importSkill", null, await getBridge()?.chooseFolder?.()); }
export async function deleteSkill(d) { return await call("deleteSkill", null, d); }
export async function toggleMcp(id, e) { return await call("setMcpEnabled", null, id, e); }
export async function deleteMcp(id) { return await call("deleteMcp", null, id); }
export async function updateMcp(id, u) { return await call("updateMcp", null, id, u); }
export async function addMcp(n, c) { return await call("addMcp", null, n, c); }
export async function importMcp() { return await call("importMcp", null, await getBridge()?.chooseFile?.()); }
export async function readSession(id) { return await call("readSession", null, id); }
export async function stopRun(id) { return await call("stopClaude", null, id); }
export async function stopRunner(k) { return await call("stopRunner", null, k); }
export async function reconnect() { return await call("reconnectClaude"); }
export async function runClaude(p) { return await call("runClaude", null, p); }
export async function chooseFolder() { return await getBridge()?.chooseFolder?.(); }
export async function readText(p) { return await call("readText", null, p); }
export async function copyText(t) { return await getBridge()?.copyText?.(t); }
export async function openPath(p) { return await getBridge()?.openPath?.(p); }
