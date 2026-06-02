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

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
    instruction: text(step.instruction),
    requiresApproval: bool(step.requiresApproval, true),
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
    members: input.members || [],
    workflow: input.workflow || [],
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
  for (const key of ["name", "description", "rules", "entryStepId", "finalStepId"]) {
    if (updates[key] !== undefined) team[key] = text(updates[key]);
  }
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
  for (const key of ["name", "icon", "role", "rules", "providerId", "identityId", "permissionMode"]) {
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
  const step = normalizeStep({ ...input, createdAt: now(), updatedAt: now() }, team.workflow.length);
  team.workflow.push(step);
  if (!team.entryStepId) team.entryStepId = step.id;
  if (!team.finalStepId) team.finalStepId = step.id;
  team.updatedAt = now();
  saveStore(store);
  return { team, step };
}

export function updateTeamStep(teamId, stepId, updates = {}) {
  const store = readStore();
  const team = findTeam(store, teamId);
  const step = team.workflow.find(item => item.id === stepId);
  if (!step) throw new Error("Workflow step not found");
  for (const key of ["name", "memberId", "instruction", "inputMode"]) {
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

export function composeTeamStepPrompt({ teamId, stepId, task = "", previousOutputs = {} } = {}) {
  const team = findTeam(readStore(), teamId);
  const step = team.workflow.find(item => item.id === stepId);
  if (!step) throw new Error("Workflow step not found");
  const member = team.members.find(item => item.id === step.memberId) || null;
  const incomingIds = new Set((team.workflowEdges || []).filter(edge => edge.to === stepId).map(edge => edge.from));
  const priorSteps = team.workflow.filter(item => incomingIds.has(item.id) && previousOutputs[item.id]);
  const prior = priorSteps
    .map(item => `## ${item.name}\n${previousOutputs[item.id]}`)
    .join("\n\n");
  const nextSteps = (team.workflowEdges || [])
    .filter(edge => edge.from === stepId)
    .map(edge => team.workflow.find(item => item.id === edge.to))
    .filter(Boolean);
  const lines = [
    `You are working as the team member: ${member?.name || "Unassigned member"}.`,
    member?.role ? `Role: ${member.role}` : "",
    team.rules ? `Team rules:\n${team.rules}` : "",
    member?.rules ? `Member rules:\n${member.rules}` : "",
    `Current workflow step: ${step.name}`,
    step.instruction ? `Step instruction:\n${step.instruction}` : "",
    task ? `User task:\n${task}` : "",
    prior ? `Previous accepted outputs:\n${prior}` : "",
    nextSteps.length ? `After this step, hand off to: ${nextSteps.map(item => item.name).join(", ")}.` : "This is the final mapped step. Produce a final, user-facing answer when ready.",
    "Return only the useful deliverable for this step. If something is missing, state the blocker clearly.",
  ].filter(Boolean);
  return { team, step, member, nextSteps, prompt: lines.join("\n\n") };
}

export const testExports = { normalizeTeam, normalizeMember, normalizeStep, normalizeEdge };
