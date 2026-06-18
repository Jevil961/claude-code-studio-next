import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

function teamsPath() {
  return process.env.CCS_TEAMS_PATH || join(homedir(), ".claude-code-studio", "teams.json");
}

function emptyStore() {
  return { teams: [] };
}

function readStore() {
  const file = teamsPath();
  if (!existsSync(file)) return emptyStore();
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return { teams: Array.isArray(parsed.teams) ? parsed.teams.map(normalizeTeam) : [] };
  } catch {
    return emptyStore();
  }
}

function saveStore(store) {
  const file = teamsPath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ teams: store.teams.map(normalizeTeam) }, null, 2), "utf8");
}

function now() {
  return Date.now();
}

function text(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function bool(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === false || value === "false") return false;
  return true;
}

const TEAM_RUN_MODES = new Set(["workflow", "plan", "goal"]);

function normalizeRunMode(value) {
  const mode = text(value);
  return TEAM_RUN_MODES.has(mode) ? mode : "workflow";
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeAuditEvents(events = []) {
  if (!Array.isArray(events)) return [];
  return events.slice(0, 240).map(event => {
    if (typeof event === "string") {
      return { type: "note", title: text(event).slice(0, 120), detail: text(event).slice(0, 1000) };
    }
    const paths = Array.isArray(event?.paths)
      ? event.paths.map(item => text(item).slice(0, 260)).filter(Boolean).slice(0, 20)
      : [];
    return {
      type: text(event?.type, "event").slice(0, 60) || "event",
      title: text(event?.title || event?.tool || event?.name || event?.type, "event").slice(0, 120),
      detail: text(event?.detail || event?.message || event?.summary || event?.input || event?.output).slice(0, 1000),
      tool: text(event?.tool || event?.toolName).slice(0, 120),
      ok: event?.ok === undefined ? undefined : Boolean(event.ok),
      durationMs: event?.durationMs === undefined ? undefined : number(event.durationMs, 0),
      at: number(event?.at || event?.timestamp, 0),
      paths,
    };
  }).filter(event => event.title || event.detail || event.tool || event.paths.length);
}

function normalizeChangedFiles(files = []) {
  if (!Array.isArray(files)) return [];
  const seen = new Set();
  const normalized = [];
  for (const file of files) {
    const value = typeof file === "string" ? file : file?.path || file?.file || file?.name;
    const path = text(value).slice(0, 320);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    normalized.push(path);
    if (normalized.length >= 120) break;
  }
  return normalized;
}

function normalizeMember(member = {}) {
  return {
    id: text(member.id) || randomUUID(),
    name: text(member.name, "New member"),
    icon: text(member.icon, "ID").slice(0, 8) || "ID",
    role: text(member.role),
    rules: text(member.rules),
    providerId: text(member.providerId),
    identityId: text(member.identityId),
    agentRuntimeId: text(member.agentRuntimeId),
    permissionMode: text(member.permissionMode, "auto") || "auto",
    createdAt: Number(member.createdAt || now()),
    updatedAt: Number(member.updatedAt || member.createdAt || now()),
  };
}

function normalizeStep(step = {}, index = 0) {
  return {
    id: text(step.id) || randomUUID(),
    name: text(step.name, `Step ${index + 1}`),
    memberId: text(step.memberId),
    nodeType: text(step.nodeType, "work") || "work",
    instruction: text(step.instruction),
    decisionInstruction: text(step.decisionInstruction),
    requiresApproval: bool(step.requiresApproval, false),
    inputMode: text(step.inputMode, "task-and-previous") || "task-and-previous",
    x: number(step.x, 80 + (index % 4) * 220),
    y: number(step.y, 80 + Math.floor(index / 4) * 150),
    createdAt: Number(step.createdAt || now()),
    updatedAt: Number(step.updatedAt || step.createdAt || now()),
  };
}

function normalizeEdge(edge = {}) {
  return {
    id: text(edge.id) || randomUUID(),
    from: text(edge.from),
    to: text(edge.to),
    condition: text(edge.condition, "default") || "default",
    label: text(edge.label),
    createdAt: Number(edge.createdAt || now()),
    updatedAt: Number(edge.updatedAt || edge.createdAt || now()),
  };
}

function normalizeTeam(team = {}) {
  const members = Array.isArray(team.members) ? team.members.map(normalizeMember) : [];
  const workflow = Array.isArray(team.workflow) ? team.workflow.map(normalizeStep) : [];
  const nodeIds = new Set(workflow.map(step => step.id));
  const rawEdges = Array.isArray(team.workflowEdges)
    ? team.workflowEdges
    : workflow.slice(1).map((step, index) => ({ from: workflow[index].id, to: step.id }));
  const workflowEdges = rawEdges
    .map(normalizeEdge)
    .filter(edge => edge.from && edge.to && edge.from !== edge.to && nodeIds.has(edge.from) && nodeIds.has(edge.to));
  const entryStepId = nodeIds.has(text(team.entryStepId)) ? text(team.entryStepId) : workflow[0]?.id || "";
  const finalStepId = nodeIds.has(text(team.finalStepId)) ? text(team.finalStepId) : workflow.at(-1)?.id || "";
  return {
    id: text(team.id) || randomUUID(),
    name: text(team.name, "New team"),
    description: text(team.description),
    rules: text(team.rules),
    cwd: text(team.cwd),
    runMode: normalizeRunMode(team.runMode),
    goal: text(team.goal),
    successCriteria: text(team.successCriteria),
    planningRules: text(team.planningRules),
    members,
    workflow,
    workflowEdges,
    entryStepId,
    finalStepId,
    createdAt: Number(team.createdAt || now()),
    updatedAt: Number(team.updatedAt || team.createdAt || now()),
  };
}

function findTeam(store, teamId) {
  const team = store.teams.find(item => item.id === teamId);
  if (!team) throw new Error("Team not found");
  return team;
}

export function listTeams() {
  return readStore().teams;
}

export function createTeam(input = {}) {
  const store = readStore();
  const team = normalizeTeam({
    name: input.name || "New team",
    description: input.description || "",
    rules: input.rules || "",
    cwd: input.cwd || "",
    runMode: input.runMode || "workflow",
    goal: input.goal || "",
    successCriteria: input.successCriteria || "",
    planningRules: input.planningRules || "",
    members: input.members || [],
    workflow: input.workflow || [],
    workflowEdges: input.workflowEdges,
    entryStepId: input.entryStepId || "",
    finalStepId: input.finalStepId || "",
    createdAt: now(),
    updatedAt: now(),
  });
  store.teams.push(team);
  saveStore(store);
  return team;
}

export function updateTeam(teamId, updates = {}) {
  const store = readStore();
  const team = findTeam(store, teamId);
  for (const key of ["name", "description", "rules", "entryStepId", "finalStepId", "cwd", "goal", "successCriteria", "planningRules"]) {
    if (updates[key] !== undefined) team[key] = text(updates[key]);
  }
  if (updates.runMode !== undefined) team.runMode = normalizeRunMode(updates.runMode);
  team.updatedAt = now();
  saveStore(store);
  return team;
}

export function deleteTeam(teamId) {
  const store = readStore();
  const next = store.teams.filter(team => team.id !== teamId);
  if (next.length === store.teams.length) throw new Error("Team not found");
  store.teams = next;
  saveStore(store);
  return { ok: true };
}

export function createTeamMember(teamId, input = {}) {
  const store = readStore();
  const team = findTeam(store, teamId);
  const member = normalizeMember({ ...input, createdAt: now(), updatedAt: now() });
  team.members.push(member);
  team.updatedAt = now();
  saveStore(store);
  return { team, member };
}

export function updateTeamMember(teamId, memberId, updates = {}) {
  const store = readStore();
  const team = findTeam(store, teamId);
  const member = team.members.find(item => item.id === memberId);
  if (!member) throw new Error("Team member not found");
  for (const key of ["name", "icon", "role", "rules", "providerId", "identityId", "agentRuntimeId", "permissionMode"]) {
    if (updates[key] !== undefined) member[key] = text(updates[key]);
  }
  member.updatedAt = now();
  team.updatedAt = now();
  saveStore(store);
  return { team, member: normalizeMember(member) };
}

export function deleteTeamMember(teamId, memberId) {
  const store = readStore();
  const team = findTeam(store, teamId);
  const before = team.members.length;
  team.members = team.members.filter(member => member.id !== memberId);
  if (team.members.length === before) throw new Error("Team member not found");
  team.workflow = team.workflow.map(step => step.memberId === memberId ? { ...step, memberId: "", updatedAt: now() } : step);
  team.updatedAt = now();
  saveStore(store);
  return { team };
}

export function createTeamStep(teamId, input = {}) {
  const store = readStore();
  const team = findTeam(store, teamId);
  const previousLastStep = team.workflow.at(-1) || null;
  const previousFinalStep = team.workflow.find(step => step.id === team.finalStepId) || null;
  const step = normalizeStep({ ...input, createdAt: now(), updatedAt: now() }, team.workflow.length);
  team.workflow.push(step);
  if (!team.entryStepId) team.entryStepId = step.id;
  if (
    !team.finalStepId
    || step.nodeType === "final"
    || (previousLastStep && team.finalStepId === previousLastStep.id && previousFinalStep?.nodeType !== "final")
  ) {
    team.finalStepId = step.id;
  }
  team.updatedAt = now();
  saveStore(store);
  return { team, step };
}

export function updateTeamStep(teamId, stepId, updates = {}) {
  const store = readStore();
  const team = findTeam(store, teamId);
  const step = team.workflow.find(item => item.id === stepId);
  if (!step) throw new Error("Workflow step not found");
  for (const key of ["name", "memberId", "nodeType", "instruction", "decisionInstruction", "inputMode"]) {
    if (updates[key] !== undefined) step[key] = text(updates[key]);
  }
  if (updates.x !== undefined) step.x = number(updates.x, step.x);
  if (updates.y !== undefined) step.y = number(updates.y, step.y);
  if (updates.requiresApproval !== undefined) step.requiresApproval = bool(updates.requiresApproval, true);
  step.updatedAt = now();
  team.updatedAt = now();
  saveStore(store);
  return { team, step: normalizeStep(step) };
}

export function deleteTeamStep(teamId, stepId) {
  const store = readStore();
  const team = findTeam(store, teamId);
  const before = team.workflow.length;
  team.workflow = team.workflow.filter(step => step.id !== stepId);
  if (team.workflow.length === before) throw new Error("Workflow step not found");
  team.workflowEdges = (team.workflowEdges || []).filter(edge => edge.from !== stepId && edge.to !== stepId);
  if (team.entryStepId === stepId) team.entryStepId = team.workflow[0]?.id || "";
  if (team.finalStepId === stepId) team.finalStepId = team.workflow.at(-1)?.id || "";
  team.updatedAt = now();
  saveStore(store);
  return { team };
}

export function updateTeamWorkflow(teamId, updates = {}) {
  const store = readStore();
  const team = findTeam(store, teamId);
  const nodeIds = new Set(team.workflow.map(step => step.id));
  if (Array.isArray(updates.workflow)) {
    team.workflow = updates.workflow.map((step, index) => normalizeStep({
      ...team.workflow.find(item => item.id === step.id),
      ...step,
      updatedAt: now(),
    }, index));
  }
  const nextNodeIds = new Set(team.workflow.map(step => step.id));
  if (Array.isArray(updates.workflowEdges)) {
    team.workflowEdges = updates.workflowEdges
      .map(normalizeEdge)
      .filter(edge => edge.from && edge.to && edge.from !== edge.to && nextNodeIds.has(edge.from) && nextNodeIds.has(edge.to));
  } else {
    team.workflowEdges = (team.workflowEdges || []).filter(edge => nextNodeIds.has(edge.from) && nextNodeIds.has(edge.to));
  }
  if (updates.entryStepId !== undefined) team.entryStepId = nextNodeIds.has(text(updates.entryStepId)) ? text(updates.entryStepId) : "";
  if (updates.finalStepId !== undefined) team.finalStepId = nextNodeIds.has(text(updates.finalStepId)) ? text(updates.finalStepId) : "";
  if (!team.entryStepId && team.workflow.length) team.entryStepId = team.workflow[0].id;
  if (!team.finalStepId && team.workflow.length) team.finalStepId = team.workflow.at(-1).id;
  team.updatedAt = now();
  saveStore(store);
  return normalizeTeam(team);
}

function teamRoster(team) {
  return team.members
    .map(member => `- ${member.name}${member.role ? `: ${member.role}` : ""}`)
    .join("\n");
}

function workflowPlan(team) {
  return team.workflow
    .map(step => {
      const member = team.members.find(item => item.id === step.memberId);
      const routes = (team.workflowEdges || [])
        .filter(edge => edge.from === step.id)
        .map(edge => {
          const next = team.workflow.find(item => item.id === edge.to);
          return next ? `${edge.condition || "default"} -> ${next.name}` : "";
        })
        .filter(Boolean)
        .join(", ");
      return `- ${step.name} [${step.nodeType || "work"}]${member ? ` by ${member.name}` : ""}${routes ? ` routes: ${routes}` : ""}`;
    })
    .join("\n");
}

function teamRunContext(team, context = {}) {
  return {
    mode: normalizeRunMode(context.mode || team.runMode),
    goal: text(context.goal || team.goal),
    successCriteria: text(context.successCriteria || team.successCriteria),
    plan: text(context.plan),
    planningRules: text(context.planningRules || team.planningRules),
  };
}

function extractBalancedJsonObject(source, startIndex = 0) {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = Math.max(0, startIndex); index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = inString;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) return source.slice(start, index + 1);
    }
  }
  return "";
}

export function composeTeamStepPrompt({ teamId, stepId, task = "", previousOutputs = {}, teamRunContext: rawRunContext = {} } = {}) {
  const team = findTeam(readStore(), teamId);
  const step = team.workflow.find(item => item.id === stepId);
  if (!step) throw new Error("Workflow step not found");
  const member = team.members.find(item => item.id === step.memberId) || null;
  const runContext = teamRunContext(team, rawRunContext);
  const roster = teamRoster(team);
  const incomingIds = new Set((team.workflowEdges || []).filter(edge => edge.to === stepId).map(edge => edge.from));
  const priorSteps = team.workflow.filter(item => incomingIds.has(item.id) && previousOutputs[item.id]);
  const prior = priorSteps
    .map(item => `## ${item.name}\n${previousOutputs[item.id]}`)
    .join("\n\n");
  const nextSteps = (team.workflowEdges || [])
    .filter(edge => edge.from === stepId)
    .map(edge => ({ edge, step: team.workflow.find(item => item.id === edge.to) }))
    .filter(item => item.step);
  const nextLabel = nextSteps
    .map(item => `${item.step.name}${item.edge.condition && item.edge.condition !== "default" ? ` (${item.edge.condition})` : ""}`)
    .join(", ");
  const conditionalRoutes = nextSteps.filter(item => item.edge.condition && item.edge.condition !== "default");
  const conditionList = [...new Set(conditionalRoutes.map(item => item.edge.condition))].join(", ");
  const handoffContract = nextSteps.length
    ? [
        "Handoff contract:",
        "- End with a short handoff section that names completed work, evidence, risks, and the next recommended route.",
        conditionalRoutes.length
          ? `- If routing is required, include a final line exactly like one available condition: DECISION: ${conditionalRoutes[0].edge.condition}.`
          : "- If no routing decision is required, do not invent a DECISION line.",
        "- When useful, include a compact JSON block named TEAM_HANDOFF_JSON with keys: summary, evidence, risks, decision.",
      ].join("\n")
    : [
        "Final delivery contract:",
        "- Produce the user-facing result directly.",
        "- Include what changed, what was verified, and any remaining risk.",
      ].join("\n");
  const finalInstruction = step.id === team.finalStepId
    ? nextSteps.length
      ? "This is a final review node with mapped handoff routes. Decide whether the work is ready or must be reworked, then follow the available route conditions."
      : "This is the final output node. Produce the formal user-facing answer; do not add internal handoff notes unless they are necessary for the user."
    : "";
  const lines = [
    `You are working as the team member: ${member?.name || "Unassigned member"}.`,
    member?.role ? `Role: ${member.role}` : "",
    team.rules ? `Team rules:\n${team.rules}` : "",
    [
      "Team operating context:",
      `- Run mode: ${runContext.mode}.`,
      runContext.goal ? `- Shared goal: ${runContext.goal}` : "",
      runContext.successCriteria ? `- Success criteria: ${runContext.successCriteria}` : "",
      runContext.planningRules ? `- Planning rules: ${runContext.planningRules}` : "",
      roster ? `Team roster:\n${roster}` : "",
      runContext.plan ? `Accepted team plan:\n${runContext.plan}` : "",
      "- Act as one part of the same team: preserve upstream decisions, expose blockers early, and make handoffs easy for the next member.",
    ].filter(Boolean).join("\n"),
    member?.rules ? `Member rules:\n${member.rules}` : "",
    `Current workflow step: ${step.name}`,
    `Step type: ${step.nodeType || "work"}`,
    step.instruction ? `Step instruction:\n${step.instruction}` : "",
    step.decisionInstruction ? `Decision instruction:\n${step.decisionInstruction}` : "",
    task ? `User task:\n${task}` : "",
    prior ? `Previous accepted outputs:\n${prior}` : "",
    finalInstruction,
    nextSteps.length ? `Available handoff routes: ${nextLabel}.` : "This is the final mapped step. Produce a final, user-facing answer when ready.",
    conditionalRoutes.length ? `If this step is deciding a route, include a final line exactly like one of the available conditions: ${conditionList}. Example: DECISION: ${conditionalRoutes[0].edge.condition}.` : "",
    handoffContract,
    "Return only the useful deliverable for this step. If something is missing, state the blocker clearly.",
  ].filter(Boolean);
  return { team, step, member, nextSteps: nextSteps.map(item => item.step), nextEdges: nextSteps.map(item => item.edge), prompt: lines.join("\n\n") };
}

export function composeTeamPlanningPrompt({ teamId, task = "", goal = "", successCriteria = "" } = {}) {
  const team = findTeam(readStore(), teamId);
  const runContext = teamRunContext(team, {
    mode: "plan",
    goal: goal || task,
    successCriteria,
  });
  const lines = [
    "You are the planning coordinator for this AI team.",
    `Team: ${team.name}`,
    team.description ? `Description: ${team.description}` : "",
    team.rules ? `Team rules:\n${team.rules}` : "",
    runContext.planningRules ? `Planning rules:\n${runContext.planningRules}` : "",
    runContext.goal ? `Shared goal:\n${runContext.goal}` : "",
    runContext.successCriteria ? `Success criteria:\n${runContext.successCriteria}` : "",
    task ? `User task:\n${task}` : "",
    team.members.length ? `Team roster:\n${teamRoster(team)}` : "Team roster: no members are configured.",
    team.workflow.length ? `Workflow map:\n${workflowPlan(team)}` : "Workflow map: no steps are configured.",
    [
      "Planning contract:",
      "- Produce a concise execution plan that assigns clear responsibility to the existing team members and workflow steps.",
      "- Identify dependencies, likely blockers, verification points, and the handoff order.",
      "- Keep the plan actionable enough for the team to execute without asking the user to manually split work.",
      "- End with a fenced JSON block introduced by TEAM_PLAN_JSON.",
      "- The JSON object must include: goal, successCriteria, steps, risks, handoffOrder.",
    ].join("\n"),
    "TEAM_PLAN_JSON example:\n```json\n{\"goal\":\"...\",\"successCriteria\":[\"...\"],\"steps\":[{\"owner\":\"PM\",\"work\":\"...\",\"handoff\":\"...\"}],\"risks\":[\"...\"],\"handoffOrder\":[\"PM\",\"Developer\",\"QA\"]}\n```",
  ].filter(Boolean);
  return { team, prompt: lines.join("\n\n") };
}

export function extractTeamPlan(output = "") {
  const source = String(output || "").trim();
  if (!source) return { goal: "", successCriteria: [], steps: [], risks: [], handoffOrder: [], raw: "" };
  const candidates = [];
  const labeledFence = source.match(/TEAM_PLAN_JSON[\s\S]*?```(?:json)?\s*([\s\S]*?)```/i);
  if (labeledFence) candidates.push(labeledFence[1]);
  const anyJsonFence = source.match(/```(?:json)?\s*({[\s\S]*?})\s*```/i);
  if (anyJsonFence) candidates.push(anyJsonFence[1]);
  const labelIndex = source.search(/TEAM_PLAN_JSON/i);
  candidates.push(extractBalancedJsonObject(source, labelIndex >= 0 ? labelIndex : 0));
  candidates.push(extractBalancedJsonObject(source, 0));

  for (const candidate of candidates.filter(Boolean)) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") {
        return {
          goal: text(parsed.goal),
          successCriteria: Array.isArray(parsed.successCriteria) ? parsed.successCriteria.map(item => text(item)).filter(Boolean) : [text(parsed.successCriteria)].filter(Boolean),
          steps: Array.isArray(parsed.steps) ? parsed.steps : [],
          risks: Array.isArray(parsed.risks) ? parsed.risks.map(item => text(item)).filter(Boolean) : [text(parsed.risks)].filter(Boolean),
          handoffOrder: Array.isArray(parsed.handoffOrder) ? parsed.handoffOrder.map(item => text(item)).filter(Boolean) : [text(parsed.handoffOrder)].filter(Boolean),
          raw: source,
        };
      }
    } catch {
      // Try the next extraction strategy.
    }
  }

  const steps = source
    .split(/\r?\n/)
    .map(line => line.replace(/^[-*\d.\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 12);
  return { goal: "", successCriteria: [], steps, risks: [], handoffOrder: [], raw: source };
}

export function extractTeamDecision(output = "") {
  const source = String(output || "");
  const pattern = /\bDECISION\s*[:：]\s*(yes|no|pass|revise|approve|reject|default)\b/i;
  const lines = source.split(/\r?\n/).map(line => line.trim()).filter(Boolean).reverse();
  for (const line of lines) {
    const match = line.match(pattern);
    if (match) return match[1].toLowerCase();
  }
  const match = source.match(pattern);
  return match ? match[1].toLowerCase() : "";
}

function routeDecisionAliases(decision) {
  switch (decision) {
    case "approve":
    case "yes":
    case "pass":
      return ["approve", "yes", "pass"];
    case "reject":
    case "no":
    case "revise":
      return ["reject", "no", "revise"];
    case "default":
      return ["default"];
    default:
      return decision ? [decision] : [];
  }
}

export function selectTeamRoute(team = {}, stepId = "", output = "", options = {}) {
  const normalized = normalizeTeam(team);
  const step = normalized.workflow.find(item => item.id === stepId) || null;
  const outgoing = (normalized.workflowEdges || [])
    .filter(edge => edge.from === stepId)
    .map(edge => ({ edge, step: normalized.workflow.find(item => item.id === edge.to) || null }))
    .filter(item => item.step);
  const decision = text(options.preferredCondition) || extractTeamDecision(output);
  if (!step) return { done: false, needsChoice: false, decision, edge: null, step: null, error: "Workflow step not found" };
  if (!outgoing.length) return { done: true, needsChoice: false, decision, edge: null, step: null };

  const nonDefault = outgoing.filter(item => item.edge.condition && item.edge.condition !== "default");
  if (!nonDefault.length) {
    return { done: false, needsChoice: false, decision: decision || "default", edge: outgoing[0].edge, step: outgoing[0].step };
  }

  const candidates = routeDecisionAliases(decision);
  const exact = outgoing.find(item => candidates.includes(item.edge.condition));
  if (exact) return { done: false, needsChoice: false, decision, edge: exact.edge, step: exact.step };

  const fallback = outgoing.find(item => item.edge.condition === "default");
  if (fallback && !decision) {
    return { done: false, needsChoice: false, decision: "default", edge: fallback.edge, step: fallback.step };
  }

  return {
    done: false,
    needsChoice: true,
    decision,
    edge: null,
    step: null,
    choices: outgoing.map(item => ({
      condition: item.edge.condition || "default",
      label: item.edge.label || item.step.name,
      stepId: item.step.id,
      stepName: item.step.name,
    })),
  };
}

export function recordTeamStepFailure(run = {}, team = {}, stepId = "", error = "", extra = {}) {
  const normalized = normalizeTeam(team);
  const step = normalized.workflow.find(item => item.id === stepId) || null;
  const timestamp = now();
  const message = error instanceof Error ? error.message : text(error, "Workflow step failed");
  const output = text(extra.output);
  const entry = {
    id: randomUUID(),
    stepId,
    stepName: step?.name || "",
    memberId: step?.memberId || "",
    status: "error",
    error: message,
    output,
    outputPreview: text(output || message).slice(0, 240),
    prompt: text(extra.prompt),
    decision: "",
    timestamp,
    durationMs: number(extra.durationMs, 0),
    auditEvents: normalizeAuditEvents(extra.auditEvents || extra.events),
    changedFiles: normalizeChangedFiles(extra.changedFiles || extra.touchedFiles),
    errorCategory: text(extra.errorCategory || extra.category).slice(0, 120),
    stderrPreview: text(extra.stderrPreview || extra.stderr).slice(0, 1200),
  };
  return {
    ...run,
    running: false,
    completed: false,
    error: message,
    currentStepId: stepId,
    failedStepId: stepId,
    updatedAt: timestamp,
    stepHistory: [...(Array.isArray(run.stepHistory) ? run.stepHistory : []), entry],
  };
}

export function planTeamRetry(run = {}, team = {}) {
  const normalized = normalizeTeam(team);
  const errorHistory = Array.isArray(run.stepHistory) ? run.stepHistory.filter(item => item.status === "error") : [];
  const stepId = text(run.failedStepId || run.currentStepId || errorHistory.at(-1)?.stepId);
  const step = normalized.workflow.find(item => item.id === stepId) || null;
  if (!step) {
    return { canRetry: false, error: "No failed workflow step is available to retry.", run };
  }
  const retryRun = {
    ...run,
    running: false,
    completed: false,
    error: "",
    currentStepId: stepId,
    failedStepId: "",
    updatedAt: now(),
    stepHistory: (Array.isArray(run.stepHistory) ? run.stepHistory : [])
      .filter(item => !(item.stepId === stepId && item.status === "error")),
  };
  return {
    canRetry: true,
    stepId,
    step,
    task: text(run.task),
    previousOutputs: run.outputs && typeof run.outputs === "object" ? { ...run.outputs } : {},
    run: retryRun,
  };
}

export const testExports = {
  normalizeTeam,
  normalizeMember,
  normalizeStep,
  normalizeEdge,
  normalizeRunMode,
  normalizeAuditEvents,
  normalizeChangedFiles,
  routeDecisionAliases,
};
