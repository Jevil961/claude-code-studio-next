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
    createdAt: Number(step.createdAt || now()),
    updatedAt: Number(step.updatedAt || step.createdAt || now()),
  };
}

function normalizeTeam(team = {}) {
  const members = Array.isArray(team.members) ? team.members.map(normalizeMember) : [];
  const workflow = Array.isArray(team.workflow) ? team.workflow.map(normalizeStep) : [];
  return {
    id: text(team.id) || randomUUID(),
    name: text(team.name, "New team"),
    description: text(team.description),
    rules: text(team.rules),
    members,
    workflow,
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
  for (const key of ["name", "description", "rules"]) {
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
  team.updatedAt = now();
  saveStore(store);
  return { team };
}

export function composeTeamStepPrompt({ teamId, stepId, task = "", previousOutputs = {} } = {}) {
  const team = findTeam(readStore(), teamId);
  const step = team.workflow.find(item => item.id === stepId);
  if (!step) throw new Error("Workflow step not found");
  const member = team.members.find(item => item.id === step.memberId) || null;
  const stepIndex = team.workflow.findIndex(item => item.id === stepId);
  const priorSteps = stepIndex > 0 ? team.workflow.slice(0, stepIndex) : [];
  const prior = priorSteps
    .filter(item => previousOutputs[item.id])
    .map(item => `## ${item.name}\n${previousOutputs[item.id]}`)
    .join("\n\n");
  const lines = [
    `You are working as the team member: ${member?.name || "Unassigned member"}.`,
    member?.role ? `Role: ${member.role}` : "",
    team.rules ? `Team rules:\n${team.rules}` : "",
    member?.rules ? `Member rules:\n${member.rules}` : "",
    `Current workflow step: ${step.name}`,
    step.instruction ? `Step instruction:\n${step.instruction}` : "",
    task ? `User task:\n${task}` : "",
    prior ? `Previous accepted outputs:\n${prior}` : "",
    "Return only the useful deliverable for this step. If something is missing, state the blocker clearly.",
  ].filter(Boolean);
  return { team, step, member, prompt: lines.join("\n\n") };
}

export const testExports = { normalizeTeam, normalizeMember, normalizeStep };
