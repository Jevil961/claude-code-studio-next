import { data, save, state } from "../state.js";
import { safeBridge } from "../bridge.js";
import { toast } from "../helpers.js";
import { runStepAsync, isRunning as claudeIsRunning, getAssistantBuffer } from "../chat-engine.js";
import { showConfirm, showModal } from "../modal.js";
import { escapeHtml } from "../../markdown.js";
import { loadAgentRuntimes, loadIdentities, loadProviders, loadTeams } from "../data-loader.js";

const NODE_W = 200;
const NODE_H = 80;
const CANVAS_W = 2400;
const CANVAS_H = 1400;
const MAX_WORKFLOW_STEPS = 24;

const NODE_COLORS = {
  start: { bg: "#1a3a2a", border: "#22c55e", bar: "#22c55e", icon: "#4ade80" },
  intake: { bg: "#1a2a3a", border: "#3b82f6", bar: "#3b82f6", icon: "#60a5fa" },
  work: { bg: "#1e293b", border: "#475569", bar: "#6366f1", icon: "#818cf8" },
  review: { bg: "#2a2a1a", border: "#f59e0b", bar: "#f59e0b", icon: "#fbbf24" },
  approval: { bg: "#2a1a2a", border: "#a855f7", bar: "#a855f7", icon: "#c084fc" },
  final: { bg: "#1a2a2a", border: "#10b981", bar: "#10b981", icon: "#34d399" },
};
function nodeColor(type) { return NODE_COLORS[type] || NODE_COLORS.work; }
const COMPONENTS = [
  { type: "start", name: "开始", icon: "S", instruction: "接收任务输入，交给第一位处理身份", color: "#22c55e" },
  { type: "intake", name: "身份处理", icon: "ID", instruction: "接收上游输入，按身份规则处理后交接", color: "#3b82f6" },
  { type: "work", name: "执行任务", icon: "WK", instruction: "完成执行、修改或实现，输出交接说明", color: "#6366f1" },
  { type: "review", name: "测试判断", icon: "QA", instruction: "检查结果，输出 DECISION: pass/revise", color: "#f59e0b" },
  { type: "approval", name: "审核判断", icon: "OK", instruction: "审核是否可交付，输出 DECISION", color: "#a855f7" },
  { type: "final", name: "输出结果", icon: "OUT", instruction: "形成给用户的最终结果或交付摘要", color: "#10b981" },
];

const TEAM_RUN_MODES = [
  { id: "workflow", label: "执行", tag: "Flow", placeholder: "输入任务描述..." },
  { id: "plan", label: "计划", tag: "Plan", placeholder: "输入任务，让 Team 先产出计划..." },
  { id: "goal", label: "目标", tag: "Goal", placeholder: "输入目标下的具体任务..." },
];

function selectedTeam() {
  return data.teams.find(team => team.id === state.selectedTeamId) || data.teams[0] || null;
}

function workflowEdges(team) {
  return Array.isArray(team.workflowEdges) ? team.workflowEdges : [];
}

function conditionLabel(condition = "default") {
  return {
    default: "默认",
    pass: "通过",
    revise: "返工",
    approve: "批准",
    reject: "驳回",
    yes: "Yes",
    no: "No",
  }[condition] || condition;
}

export function canPanTeamCanvasTarget(target, canvas) {
  if (!target || !canvas) return false;
  if (target.closest?.(".team-node-card, .team-zoom-bar, button, input, textarea, select, [draggable='true']")) return false;
  return target === canvas || Boolean(canvas.contains?.(target));
}

export function layoutWorkflowEdgesForRender(team, edges = workflowEdges(team)) {
  const valid = edges
    .map(edge => ({ edge, from: stepById(team, edge.from), to: stepById(team, edge.to) }))
    .filter(item => item.from && item.to);
  const groups = new Map();
  for (const item of valid) {
    const pairKey = [item.edge.from, item.edge.to].sort().join("<>");
    if (!groups.has(pairKey)) groups.set(pairKey, []);
    groups.get(pairKey).push(item.edge.id || `${item.edge.from}->${item.edge.to}:${item.edge.condition || "default"}`);
  }
  const usedLabels = [];
  return valid.map(item => {
    const x1 = (item.from.x || 0) + NODE_W;
    const y1 = (item.from.y || 0) + NODE_H / 2;
    const x2 = item.to.x || 0;
    const y2 = (item.to.y || 0) + NODE_H / 2;
    const pairKey = [item.edge.from, item.edge.to].sort().join("<>");
    const group = groups.get(pairKey) || [];
    const groupIndex = Math.max(0, group.indexOf(item.edge.id || `${item.edge.from}->${item.edge.to}:${item.edge.condition || "default"}`));
    const groupOffset = (groupIndex - (group.length - 1) / 2) * 30;
    const len = Math.max(1, Math.hypot(x2 - x1, y2 - y1));
    const nx = -(y2 - y1) / len;
    const ny = (x2 - x1) / len;
    const offsetX = nx * groupOffset;
    const offsetY = ny * groupOffset;
    let labelX = (x1 + x2) / 2 + offsetX;
    let labelY = (y1 + y2) / 2 - 12 + offsetY;
    let collisionStep = 0;
    while (usedLabels.some(pos => Math.abs(pos.x - labelX) < 48 && Math.abs(pos.y - labelY) < 24) && collisionStep < 6) {
      collisionStep += 1;
      labelY += 20;
      labelX += collisionStep % 2 ? 16 : -16;
    }
    usedLabels.push({ x: labelX, y: labelY });
    return {
      edge: item.edge,
      from: item.from,
      to: item.to,
      x1,
      y1,
      x2,
      y2,
      cp: Math.max(50, Math.abs(x2 - x1) * 0.5),
      offsetX,
      offsetY,
      labelX,
      labelY,
    };
  });
}

function conditionOptions(value = "default") {
  return ["default", "yes", "no", "revise", "pass", "approve", "reject"].map(condition => ({
    value: condition,
    label: conditionLabel(condition),
    selected: condition === value,
  }));
}

function nodeTypeOptions(value = "work") {
  return [
    ["start", "开始"],
    ["intake", "入口澄清"],
    ["work", "执行处理"],
    ["review", "评审测试"],
    ["approval", "最终审核"],
    ["final", "正式输出"],
  ].map(([id, label]) => ({ value: id, label, selected: id === value }));
}

function outgoingEdges(team, stepId) {
  return workflowEdges(team).filter(edge => edge.from === stepId && stepById(team, edge.to));
}

function decisionFromText(text) {
  const raw = String(text || "");
  const jsonMatch = raw.match(/"decision"\s*:\s*"(yes|no|pass|revise|approve|reject|default)"/i)
    || raw.match(/\bdecision\s*[:：]\s*(yes|no|pass|revise|approve|reject|default)\b/i);
  if (jsonMatch) return jsonMatch[1].toLowerCase();
  const lineMatch = raw.match(/DECISION\s*[:：]\s*(yes|no|pass|revise|approve|reject|default)/i);
  return lineMatch ? lineMatch[1].toLowerCase() : "";
}

function summarizeText(text, max = 180) {
  const oneLine = String(text || "").replace(/\s+/g, " ").trim();
  if (!oneLine) return "";
  return oneLine.length > max ? `${oneLine.slice(0, max)}...` : oneLine;
}

function normalizeAuditEvents(events = []) {
  if (!Array.isArray(events)) return [];
  return events.slice(0, 240).map(event => {
    if (typeof event === "string") return { type: "note", title: summarizeText(event, 120), detail: summarizeText(event, 1000) };
    const paths = Array.isArray(event?.paths)
      ? event.paths.map(item => String(item || "").trim()).filter(Boolean).slice(0, 20)
      : [];
    return {
      type: String(event?.type || "event").slice(0, 60),
      title: summarizeText(event?.title || event?.tool || event?.name || event?.type || "event", 120),
      detail: summarizeText(event?.detail || event?.message || event?.summary || event?.input || event?.output || "", 1000),
      tool: String(event?.tool || event?.toolName || "").slice(0, 120),
      ok: event?.ok === undefined ? undefined : Boolean(event.ok),
      durationMs: Number.isFinite(Number(event?.durationMs)) ? Number(event.durationMs) : undefined,
      at: Number.isFinite(Number(event?.at || event?.timestamp)) ? Number(event.at || event.timestamp) : 0,
      paths,
    };
  }).filter(event => event.title || event.detail || event.tool || event.paths.length);
}

function normalizeChangedFiles(files = []) {
  if (!Array.isArray(files)) return [];
  const seen = new Set();
  return files.map(file => String(typeof file === "string" ? file : file?.path || file?.file || file?.name || "").trim())
    .filter(path => {
      if (!path || seen.has(path)) return false;
      seen.add(path);
      return true;
    })
    .slice(0, 120);
}

function stepAuditFields(result = {}) {
  const replay = result.replay && typeof result.replay === "object" ? result.replay : {};
  return {
    auditEvents: normalizeAuditEvents(result.auditEvents || replay.events),
    changedFiles: normalizeChangedFiles(result.changedFiles || replay.touchedFiles),
    errorCategory: summarizeText(result.errorCategory || result.category || result.code || "", 120),
    stderrPreview: summarizeText(result.stderrPreview || result.stderr || "", 1200),
  };
}

function compactPath(path) {
  const text = String(path || "");
  if (!text) return "--";
  if (text.length <= 46) return text;
  return `${text.slice(0, 18)}...${text.slice(-24)}`;
}

function stepById(team, stepId) {
  return team.workflow.find(step => step.id === stepId) || null;
}

function memberById(team, memberId) {
  return team.members.find(member => member.id === memberId) || null;
}

function memberLabel(team, memberId) {
  const member = memberById(team, memberId);
  return member ? `${member.icon || "ID"} ${member.name}` : "未绑定身份";
}

function providerName(providerId) {
  return data.providers.find(provider => provider.id === providerId)?.name || "当前 Provider";
}

function identityName(identityId) {
  return data.identities.find(identity => identity.id === identityId)?.name || "未绑定 Skills 身份";
}

function normalizeTeamRunMode(value) {
  return TEAM_RUN_MODES.some(mode => mode.id === value) ? value : "workflow";
}

function teamRunModeOptions(value = "workflow") {
  const current = normalizeTeamRunMode(value);
  return TEAM_RUN_MODES.map(mode => ({ value: mode.id, label: mode.label, selected: mode.id === current }));
}

function effectiveTeamRunMode(team, run = null) {
  return normalizeTeamRunMode(run?.mode || team?.runMode || "workflow");
}

function teamRunModeLabel(mode) {
  return TEAM_RUN_MODES.find(item => item.id === normalizeTeamRunMode(mode))?.label || "执行";
}

function teamGoalText(team, run) {
  return String(run?.goal || team?.goal || run?.task || "").trim();
}

function teamSuccessCriteriaText(team, run) {
  return String(run?.successCriteria || team?.successCriteria || "").trim();
}

function teamPlanText(run) {
  return String(run?.plan || run?.planOutput || "").trim();
}

function buildTeamRunContext(team, run) {
  return {
    mode: effectiveTeamRunMode(team, run),
    goal: teamGoalText(team, run),
    successCriteria: teamSuccessCriteriaText(team, run),
    plan: teamPlanText(run),
    planningRules: team?.planningRules || "",
  };
}

function effectiveTeamPermissionMode(member) {
  return ["plan", "bypass"].includes(member?.permissionMode) ? member.permissionMode : "auto";
}

function runState(teamId) {
  state.teamRuns ||= {};
  state.teamRuns[teamId] ||= {
    task: "",
    mode: "",
    goal: "",
    successCriteria: "",
    plan: "",
    planOutput: "",
    planAccepted: false,
    phase: "",
    currentStepId: "",
    outputs: {},
    completed: false,
    updatedAt: Date.now(),
    running: false,
    stepHistory: [],
    error: "",
    conversation: [],
  };
  const run = state.teamRuns[teamId];
  run.running ??= false;
  run.stepHistory ??= [];
  run.conversation ??= [];
  run.error ??= "";
  run.mode = run.mode ? normalizeTeamRunMode(run.mode) : "";
  run.goal ??= "";
  run.successCriteria ??= "";
  run.plan ??= "";
  run.planOutput ??= "";
  run.planAccepted ??= false;
  run.phase ??= "";
  return run;
}

function activeStepId(team) {
  const run = runState(team.id);
  if (run.currentStepId && stepById(team, run.currentStepId)) return run.currentStepId;
  return team.entryStepId || team.workflow[0]?.id || "";
}

function nextSteps(team, stepId) {
  return outgoingEdges(team, stepId).map(edge => stepById(team, edge.to)).filter(Boolean);
}

function providerOptions(value = "") {
  return [
    { value: "", label: "使用当前 Provider" },
    ...data.providers.map(provider => ({ value: provider.id, label: `${provider.name}${provider.model ? ` · ${provider.model}` : ""}` })),
  ].map(option => ({ ...option, selected: option.value === value }));
}

function identityOptions(value = "") {
  return [
    { value: "", label: "不绑定 Skills 身份" },
    ...data.identities.map(identity => ({ value: identity.id, label: `${identity.icon || "ID"} ${identity.name}` })),
  ].map(option => ({ ...option, selected: option.value === value }));
}

function runtimeOptions(value = "") {
  const runtimes = (data.agentRuntimes || []).length
    ? data.agentRuntimes
    : [{ id: "studio-agent", name: "Studio Agent", available: true }];
  return [
    { value: "", label: "使用当前 Agent Runtime" },
    ...runtimes.map(runtime => ({
      value: runtime.id,
      label: `${runtime.name || runtime.id}${runtime.available === false ? " (not detected)" : ""}`,
    })),
  ].map(option => ({ ...option, selected: option.value === value }));
}

function runtimeName(runtimeId = "") {
  if (!runtimeId) return "";
  return (data.agentRuntimes || []).find(runtime => runtime.id === runtimeId)?.name || runtimeId;
}

function memberOptions(team, value = "") {
  return [
    { value: "", label: "未绑定身份" },
    ...team.members.map(member => ({ value: member.id, label: `${member.icon || "ID"} ${member.name}` })),
  ].map(option => ({ ...option, selected: option.value === value }));
}

function stepOptions(team, value = "") {
  return team.workflow.map(step => ({ value: step.id, label: step.name, selected: step.id === value }));
}

async function refresh(renderSettingsTab) {
  await Promise.allSettled([loadTeams(), loadProviders(), loadIdentities(), loadAgentRuntimes()]);
  renderSettingsTab();
}

function lastAssistantMessage() {
  return [...(state.messages || [])].reverse().find(message => message.role === "assistant" && String(message.content || "").trim());
}

async function switchMemberContext(member, deps) {
  if (member?.providerId) {
    const r = await safeBridge("switchProvider", null, member.providerId);
    if (r.ok) {
      data.providers = data.providers.map(provider => ({ ...provider, current: provider.id === member.providerId }));
      deps.populateModelDropdown?.();
    } else {
      toast(r.error || "Provider 切换失败", "error");
    }
  }
  if (member?.identityId) await deps.switchIdentity?.(member.identityId);
  deps.setPerm?.(effectiveTeamPermissionMode(member));
  deps.updateFooter?.();
}

function validateTeamRun(team, startStep) {
  if (!team) return "请先创建或选择一个 Team。";
  if (!state.cwd && !team.cwd) return "请先选择项目目录，或在 Team 设置里指定项目路径。";
  if (!team.workflow.length) return "请先添加至少一个工作流节点。";
  if (!startStep) return "入口节点不存在，请重新设置入口。";
  const missingMember = team.workflow.find(step => step.nodeType !== "start" && !step.memberId);
  if (missingMember) return `节点「${missingMember.name}」还没有绑定身份。`;
  const missingTarget = workflowEdges(team).find(edge => !stepById(team, edge.from) || !stepById(team, edge.to));
  if (missingTarget) return "工作流里存在失效交接线，请删除后重连。";
  return "";
}

// ── Auto-execution engine ──

function resolveNextStep(team, step, output) {
  const edges = outgoingEdges(team, step.id);
  if (!edges.length) return null;
  const decision = decisionFromText(output);
  if (step.id === team.finalStepId && ["approve", "pass", "yes"].includes(decision)) return null;
  if (edges.length === 1) return { step: stepById(team, edges[0].to), edge: edges[0] };
  const matched = edges.find(e => e.condition === decision) || edges.find(e => e.condition === "default");
  if (matched) return { step: stepById(team, matched.to), edge: matched };
  return { step: null, edge: null, needsChoice: true, edges };
}

async function executeStep(team, step, run, deps) {
  const startedAt = Date.now();
  const member = memberById(team, step.memberId);
  await switchMemberContext(member, deps);

  const r = await safeBridge("composeTeamStepPrompt", null, {
    teamId: team.id,
    stepId: step.id,
    task: run.task,
    previousOutputs: run.outputs || {},
    teamRunContext: buildTeamRunContext(team, run),
  });
  if (!r.ok || !r.data?.prompt) {
    throw new Error(r.error || "生成节点提示词失败");
  }

  const result = await runStepAsync(r.data.prompt, {
    providerId: member?.providerId || "",
    permissionMode: effectiveTeamPermissionMode(member),
    agentRuntimeId: member?.agentRuntimeId || "",
    cwd: team.cwd || state.cwd,
  });
  const durationMs = Date.now() - startedAt;
  const provider = member?.providerId ? data.providers.find(item => item.id === member.providerId) : data.providers.find(item => item.current) || data.providers[0] || null;
  const identity = member?.identityId ? data.identities.find(item => item.id === member.identityId) : data.identities.find(item => item.active) || null;

  // Capture conversation for this step
  if (result.ok && result.output) {
    if (!run.conversation) run.conversation = [];
    run.conversation.push({
      stepId: step.id,
      memberId: step.memberId,
      prompt: r.data.prompt,
      output: result.output,
      timestamp: Date.now(),
      durationMs,
      providerName: provider?.name || "",
      model: provider?.model || "",
      identityName: identity?.name || "",
      agentRuntimeId: member?.agentRuntimeId || state.agentRuntimeId || "studio-agent",
      agentRuntimeName: runtimeName(member?.agentRuntimeId || state.agentRuntimeId || "studio-agent"),
    });
  }

  return {
    ...result,
    prompt: r.data.prompt,
    durationMs,
    startedAt,
    finishedAt: Date.now(),
    member,
    provider,
    identity,
    agentRuntimeId: member?.agentRuntimeId || state.agentRuntimeId || "studio-agent",
    agentRuntimeName: runtimeName(member?.agentRuntimeId || state.agentRuntimeId || "studio-agent"),
    cwd: team.cwd || state.cwd,
  };
}

async function runSingleIdentityChat(team, step, member, message, run, deps) {
  if (run.running) { toast("工作流正在运行中", "error"); return; }

  run.running = true;
  run.error = "";
  if (!run.conversation) run.conversation = [];
  run.updatedAt = Date.now();
  save();
  deps.renderSettingsTab?.();

  try {
    await switchMemberContext(member, deps);

    // Build a simple prompt for single identity
    const r = await safeBridge("composeTeamStepPrompt", null, {
      teamId: team.id,
      stepId: step.id,
      task: message,
      previousOutputs: run.outputs || {},
      teamRunContext: buildTeamRunContext(team, run),
    });
    if (!r.ok || !r.data?.prompt) {
      throw new Error(r.error || "生成提示词失败");
    }

    const result = await runStepAsync(r.data.prompt, {
      providerId: member?.providerId || "",
      permissionMode: effectiveTeamPermissionMode(member),
      agentRuntimeId: member?.agentRuntimeId || "",
      cwd: team.cwd || state.cwd,
    });

    if (result.ok && result.output) {
      run.conversation.push({
        stepId: step.id,
        memberId: step.memberId,
        prompt: message,
        output: result.output,
        timestamp: Date.now(),
      });
    } else if (!result.ok) {
      run.error = result.error || "执行失败";
      toast(`执行失败：${result.error}`, "error");
    }
  } catch (err) {
    run.error = String(err.message || err);
    toast(`执行失败：${run.error}`, "error");
  }

  run.running = false;
  run.updatedAt = Date.now();
  save();
  deps.renderSettingsTab?.();
}

function planningMember(team) {
  const entry = stepById(team, team.entryStepId) || team.workflow[0] || null;
  const firstWorkStep = entry?.nodeType === "start" ? nextSteps(team, entry.id)[0] : entry;
  return memberById(team, firstWorkStep?.memberId || "") || team.members[0] || null;
}

async function runTeamPlanning(team, task, run, deps, options = {}) {
  if (run.running) { toast("Team 正在运行中", "error"); return false; }
  const reset = options.reset !== false;
  const accept = options.accept === true;
  const completeAfterPlan = options.completeAfterPlan === true;
  const planner = planningMember(team);
  const startedAt = Date.now();

  if (reset) {
    run.runId = crypto.randomUUID();
    run.startedAt = startedAt;
    run.completedAt = 0;
    run.outputs = {};
    run.stepHistory = [];
    run.conversation = [];
  } else {
    run.runId ||= crypto.randomUUID();
    run.startedAt ||= startedAt;
  }
  run.task = task || run.task || "";
  run.goal = teamGoalText(team, run) || run.task;
  run.successCriteria = teamSuccessCriteriaText(team, run);
  run.plan = accept ? run.plan : "";
  run.planAccepted = false;
  run.completed = false;
  run.error = "";
  run.paused = false;
  run.pausedStepId = "";
  run.phase = "planning";
  run.currentStepId = "";
  run.running = true;
  run.updatedAt = Date.now();
  save();
  deps.renderSettingsTab?.();

  try {
    await switchMemberContext(planner, deps);
    const r = await safeBridge("composeTeamPlanningPrompt", null, {
      teamId: team.id,
      task: run.task,
      goal: run.goal,
      successCriteria: run.successCriteria,
    });
    if (!r.ok || !r.data?.prompt) throw new Error(r.error || "生成团队计划提示词失败");

    const result = await runStepAsync(r.data.prompt, {
      providerId: planner?.providerId || "",
      permissionMode: "plan",
      agentRuntimeId: planner?.agentRuntimeId || "",
      cwd: team.cwd || state.cwd,
    });
    const durationMs = Date.now() - startedAt;
    const provider = planner?.providerId ? data.providers.find(item => item.id === planner.providerId) : data.providers.find(item => item.current) || data.providers[0] || null;
    const identity = planner?.identityId ? data.identities.find(item => item.id === planner.identityId) : data.identities.find(item => item.active) || null;
    const output = result.output || "";
    const historyItem = {
      id: crypto.randomUUID(),
      runId: run.runId,
      stepId: "__team_plan",
      stepName: "团队计划",
      memberId: planner?.id || "",
      memberName: planner?.name || "Planner",
      status: result.ok ? "done" : "error",
      output,
      outputPreview: summarizeText(output || result.error, 260),
      error: result.ok ? "" : result.error || "团队计划生成失败",
      decision: "",
      prompt: r.data.prompt,
      durationMs,
      providerName: provider?.name || "",
      model: provider?.model || "",
      identityName: identity?.name || "",
      agentRuntimeId: planner?.agentRuntimeId || state.agentRuntimeId || "studio-agent",
      agentRuntimeName: runtimeName(planner?.agentRuntimeId || state.agentRuntimeId || "studio-agent"),
      cwd: team.cwd || state.cwd,
      startedAt,
      timestamp: Date.now(),
      ...stepAuditFields(result),
    };
    run.stepHistory.push(historyItem);
    run.conversation.push({
      stepId: "__team_plan",
      stepName: "团队计划",
      memberId: planner?.id || "",
      memberName: planner?.name || "Planner",
      prompt: r.data.prompt,
      output,
      timestamp: Date.now(),
      durationMs,
      providerName: provider?.name || "",
      model: provider?.model || "",
      identityName: identity?.name || "",
      agentRuntimeId: planner?.agentRuntimeId || state.agentRuntimeId || "studio-agent",
      agentRuntimeName: runtimeName(planner?.agentRuntimeId || state.agentRuntimeId || "studio-agent"),
    });

    if (!result.ok) throw new Error(result.error || "团队计划生成失败");
    run.planOutput = output;
    if (accept) {
      run.plan = output;
      run.planAccepted = true;
    }
    run.completed = completeAfterPlan;
    if (completeAfterPlan) run.completedAt = Date.now();
    toast(accept ? "团队计划已采纳" : "团队计划已生成", "success");
    return true;
  } catch (err) {
    run.error = String(err.message || err);
    run.completed = false;
    run.completedAt = Date.now();
    toast(`团队计划中断：${run.error}`, "error");
    return false;
  } finally {
    run.running = false;
    run.phase = "";
    run.updatedAt = Date.now();
    save();
    deps.renderSettingsTab?.();
  }
}

async function startTeamRun(team, task, deps) {
  const run = runState(team.id);
  const normalizedTask = String(task || "").trim();
  if (!normalizedTask) { toast("请先输入任务", "error"); return; }
  const mode = effectiveTeamRunMode(team, run);
  run.task = normalizedTask;
  run.mode = mode;
  if (mode === "plan") {
    await runTeamPlanning(team, normalizedTask, run, deps, { reset: true, completeAfterPlan: true });
    return;
  }

  const entry = stepById(team, team.entryStepId) || team.workflow[0];
  if (!entry) { toast("请先添加入口节点", "error"); return; }
  if (mode === "goal") {
    const planned = await runTeamPlanning(team, normalizedTask, run, deps, { reset: true, accept: true, completeAfterPlan: false });
    if (!planned) return;
    await runWorkflow(team, entry.id, normalizedTask, deps, { preservePlan: true });
    return;
  }
  await runWorkflow(team, entry.id, normalizedTask, deps);
}

async function acceptPlanAndRun(team, deps) {
  const run = runState(team.id);
  if (!run.planOutput?.trim()) { toast("还没有可采用的团队计划", "error"); return; }
  const entry = stepById(team, team.entryStepId) || team.workflow[0];
  if (!entry) { toast("请先添加入口节点", "error"); return; }
  run.mode = "goal";
  run.plan = run.planOutput;
  run.planAccepted = true;
  run.completed = false;
  run.error = "";
  run.updatedAt = Date.now();
  save();
  await runWorkflow(team, entry.id, run.task || run.goal || team.goal || run.planOutput, deps, { preservePlan: true });
}

async function runWorkflow(team, startStepId, task, deps, options = {}) {
  const run = runState(team.id);
  if (run.running) { toast("工作流正在运行中", "error"); return; }
  const startStep = stepById(team, startStepId);
  const validationError = validateTeamRun(team, startStep);
  if (validationError) { toast(validationError, "error"); return; }

  run.running = true;
  run.error = "";
  if (!options.preservePlan || !run.runId) run.runId = crypto.randomUUID();
  run.startedAt = options.preservePlan && run.startedAt ? run.startedAt : Date.now();
  run.completedAt = 0;
  run.outputs = {};
  run.stepHistory = options.preservePlan ? (run.stepHistory || []).filter(item => item.stepId === "__team_plan") : [];
  run.conversation = options.preservePlan ? (run.conversation || []).filter(item => item.stepId === "__team_plan") : [];
  run.completed = false;
  run.currentStepId = startStepId;
  run.phase = "workflow";
  run.updatedAt = Date.now();
  save();
  deps.renderSettingsTab?.();

  let currentStep = startStep;
  let executedSteps = 0;

  try {
    while (currentStep && run.running) {
      executedSteps += 1;
      if (executedSteps > MAX_WORKFLOW_STEPS) {
        throw new Error(`已达到 ${MAX_WORKFLOW_STEPS} 步保护上限。请检查是否存在无法收敛的循环。`);
      }
      // Skip start nodes (pass-through)
      if (currentStep.nodeType === "start") {
        const next = nextSteps(team, currentStep.id)[0];
        if (!next) throw new Error("开始节点没有连接到下一步");
        run.currentStepId = next.id;
        run.updatedAt = Date.now();
        save();
        deps.renderSettingsTab?.();
        currentStep = next;
        continue;
      }

      // Execute this step
      run.currentStepId = currentStep.id;
      run.updatedAt = Date.now();
      save();
      deps.renderSettingsTab?.();

      toast(`正在执行：${currentStep.name}`, "info");
      const result = await executeStep(team, currentStep, run, deps);

      if (!result.ok) {
        run.stepHistory.push({
          id: crypto.randomUUID(),
          runId: run.runId,
          stepId: currentStep.id,
          memberId: currentStep.memberId,
          status: "error",
          error: result.error || `步骤 "${currentStep.name}" 执行失败`,
          decision: "",
          output: result.output || "",
          outputPreview: summarizeText(result.output || result.error, 220),
          prompt: result.prompt || "",
          durationMs: result.durationMs || 0,
          providerName: result.provider?.name || "",
          model: result.provider?.model || "",
          identityName: result.identity?.name || "",
          agentRuntimeId: result.agentRuntimeId || "",
          agentRuntimeName: result.agentRuntimeName || runtimeName(result.agentRuntimeId || ""),
          cwd: result.cwd || "",
          startedAt: result.startedAt || Date.now(),
          timestamp: Date.now(),
          ...stepAuditFields(result),
        });
        throw new Error(result.error || `步骤 "${currentStep.name}" 执行失败`);
      }

      const output = result.output || "";
      run.outputs[currentStep.id] = output;
      const decision = decisionFromText(output);
      const historyItem = {
        id: crypto.randomUUID(),
        runId: run.runId,
        stepId: currentStep.id,
        memberId: currentStep.memberId,
        status: "done",
        output,
        outputPreview: summarizeText(output, 220),
        decision,
        prompt: result.prompt || "",
        durationMs: result.durationMs || 0,
        providerName: result.provider?.name || "",
        model: result.provider?.model || "",
        identityName: result.identity?.name || "",
        agentRuntimeId: result.agentRuntimeId || "",
        agentRuntimeName: result.agentRuntimeName || runtimeName(result.agentRuntimeId || ""),
        cwd: result.cwd || "",
        startedAt: result.startedAt || Date.now(),
        timestamp: Date.now(),
        ...stepAuditFields(result),
      };
      run.stepHistory.push(historyItem);
      run.updatedAt = Date.now();
      save();

      // Resolve next step
      const next = resolveNextStep(team, currentStep, output);
      historyItem.routeCondition = next?.edge?.condition || "";
      historyItem.nextStepId = next?.step?.id || "";
      if (!next) {
        // Workflow complete (no next step or final with positive decision)
        run.completed = true;
        break;
      }
      if (currentStep.requiresApproval) {
        const nextName = next.step?.name || "下一节点";
        const approved = await showConfirm("确认交接", `「${currentStep.name}」已完成，是否继续交给「${nextName}」？\n\n摘要：${historyItem.outputPreview || "无摘要"}`);
        if (!approved) {
          run.error = `已在「${currentStep.name}」后暂停，等待人工确认。`;
          break;
        }
      }
      if (next.needsChoice) {
        // DECISION not matched - ask user
        const choice = await showModal("选择交接路线", [{
          key: "edgeId", label: "下一步", type: "select", value: next.edges[0]?.id || "",
          options: next.edges.map(e => ({ value: e.id, label: `${conditionLabel(e.condition)} → ${stepById(team, e.to)?.name || "未知"}` })),
        }]);
        const chosen = next.edges.find(e => e.id === choice?.edgeId);
        if (!chosen) { run.error = "用户取消了路线选择"; break; }
        currentStep = stepById(team, chosen.to);
      } else if (next.step) {
        currentStep = next.step;
      } else {
        run.completed = true;
        break;
      }
    }
  } catch (err) {
    run.error = String(err.message || err);
    run.paused = true;
    run.pausedStepId = currentStep?.id || "";
    toast(`工作流中断：${run.error}`, "error");
  }

  run.running = false;
  run.phase = "";
  if (!run.paused) run.completedAt = Date.now();
  run.updatedAt = Date.now();
  save();
  deps.renderSettingsTab?.();

  if (run.completed) {
    toast("工作流已完成", "success");
  }
}

function stopWorkflow(teamId) {
  const run = runState(teamId);
  run.running = false;
  run.error = "用户手动停止";
  run.paused = false;
  run.pausedStepId = "";
  run.phase = "";
  run.completedAt = Date.now();
  run.updatedAt = Date.now();
  save();
  const bridge = document.querySelector("#runStopBtn");
  bridge?.click();
  toast("工作流已停止", "info");
}

async function retryStep(team, deps) {
  const run = runState(team.id);
  if (!run.paused || !run.pausedStepId) return;
  const step = stepById(team, run.pausedStepId);
  if (!step) { toast("找不到失败的步骤", "error"); return; }

  // Remove the error entry from stepHistory for this step
  run.stepHistory = (run.stepHistory || []).filter(h => !(h.stepId === step.id && h.status === "error"));
  run.error = "";
  run.paused = false;
  run.pausedStepId = "";
  run.running = true;
  run.phase = "workflow";
  run.updatedAt = Date.now();
  save();
  deps.renderSettingsTab?.();

  toast(`重试：${step.name}`, "info");
  const result = await executeStep(team, step, run, deps);

  if (!result.ok) {
    run.stepHistory.push({
      id: crypto.randomUUID(), runId: run.runId, stepId: step.id, memberId: step.memberId,
      status: "error", error: result.error || `步骤 "${step.name}" 执行失败`,
      decision: "", output: result.output || "", outputPreview: summarizeText(result.output || result.error, 220),
      prompt: result.prompt || "", durationMs: result.durationMs || 0,
      providerName: result.provider?.name || "", model: result.provider?.model || "",
      identityName: result.identity?.name || "", cwd: result.cwd || "",
      agentRuntimeId: result.agentRuntimeId || "", agentRuntimeName: result.agentRuntimeName || runtimeName(result.agentRuntimeId || ""),
      startedAt: result.startedAt || Date.now(), timestamp: Date.now(),
      ...stepAuditFields(result),
    });
    run.running = false;
    run.phase = "";
    run.error = result.error || `步骤 "${step.name}" 执行失败`;
    run.paused = true;
    run.pausedStepId = step.id;
    run.updatedAt = Date.now();
    save();
    deps.renderSettingsTab?.();
    toast(`重试失败：${run.error}`, "error");
    return;
  }

  // Success — continue workflow from next step
  const output = result.output || "";
  run.outputs[step.id] = output;
  const decision = decisionFromText(output);
  run.stepHistory.push({
    id: crypto.randomUUID(), runId: run.runId, stepId: step.id, memberId: step.memberId,
    status: "done", output, outputPreview: summarizeText(output, 220), decision,
    prompt: result.prompt || "", durationMs: result.durationMs || 0,
    providerName: result.provider?.name || "", model: result.provider?.model || "",
    identityName: result.identity?.name || "", cwd: result.cwd || "",
    agentRuntimeId: result.agentRuntimeId || "", agentRuntimeName: result.agentRuntimeName || runtimeName(result.agentRuntimeId || ""),
    startedAt: result.startedAt || Date.now(), timestamp: Date.now(),
    ...stepAuditFields(result),
  });

  // Continue the workflow from the next step
  const next = resolveNextStep(team, step, output);
  if (!next || next.needsChoice) {
    run.running = false;
    run.phase = "";
    run.completed = !next;
    run.completedAt = Date.now();
    run.updatedAt = Date.now();
    save();
    deps.renderSettingsTab?.();
    toast(next ? "需要手动选择下一步" : "工作流已完成", next ? "info" : "success");
    return;
  }

  // Resume the workflow loop from next step
  run.currentStepId = next.step.id;
  run.updatedAt = Date.now();
  save();
  deps.renderSettingsTab?.();

  // Re-enter runWorkflow from the next step
  await resumeWorkflow(team, next.step, run, deps);
}

async function resumeWorkflow(team, startStep, run, deps) {
  let currentStep = startStep;
  let executedSteps = (run.stepHistory || []).length;
  const MAX_WORKFLOW_STEPS = 24;
  run.phase = "workflow";

  try {
    while (currentStep && run.running) {
      if (executedSteps > MAX_WORKFLOW_STEPS) throw new Error("超过最大步骤限制");
      if (currentStep.nodeType === "start") {
        const edges = workflowEdges(team).filter(e => e.from === currentStep.id);
        currentStep = edges.length ? stepById(team, edges[0].to) : null;
        continue;
      }
      run.currentStepId = currentStep.id;
      run.updatedAt = Date.now();
      save();
      deps.renderSettingsTab?.();
      toast(`正在执行：${currentStep.name}`, "info");

      const result = await executeStep(team, currentStep, run, deps);
      if (!result.ok) {
        run.stepHistory.push({
          id: crypto.randomUUID(), runId: run.runId, stepId: currentStep.id, memberId: currentStep.memberId,
          status: "error", error: result.error, decision: "", output: result.output || "",
          outputPreview: summarizeText(result.output || result.error, 220), prompt: result.prompt || "",
          durationMs: result.durationMs || 0, providerName: result.provider?.name || "",
          model: result.provider?.model || "", identityName: result.identity?.name || "",
          agentRuntimeId: result.agentRuntimeId || "", agentRuntimeName: result.agentRuntimeName || runtimeName(result.agentRuntimeId || ""),
          cwd: result.cwd || "", startedAt: result.startedAt || Date.now(), timestamp: Date.now(),
          ...stepAuditFields(result),
        });
        throw new Error(result.error);
      }

      const output = result.output || "";
      run.outputs[currentStep.id] = output;
      const decision = decisionFromText(output);
      run.stepHistory.push({
        id: crypto.randomUUID(), runId: run.runId, stepId: currentStep.id, memberId: currentStep.memberId,
        status: "done", output, outputPreview: summarizeText(output, 220), decision,
        prompt: result.prompt || "", durationMs: result.durationMs || 0,
        providerName: result.provider?.name || "", model: result.provider?.model || "",
        identityName: result.identity?.name || "", cwd: result.cwd || "",
        agentRuntimeId: result.agentRuntimeId || "", agentRuntimeName: result.agentRuntimeName || runtimeName(result.agentRuntimeId || ""),
        startedAt: result.startedAt || Date.now(), timestamp: Date.now(),
        ...stepAuditFields(result),
      });
      executedSteps++;

      const next = resolveNextStep(team, currentStep, output);
      if (!next) { run.completed = true; break; }
      if (next.needsChoice) break;
      if (currentStep.requiresApproval) {
        const ok = await showConfirm("步骤审核", `「${currentStep.name}」已完成，是否继续？`);
        if (!ok) { run.error = "用户中止审核"; break; }
      }
      currentStep = next.step;
    }
  } catch (err) {
    run.error = String(err.message || err);
    run.paused = true;
    run.pausedStepId = currentStep?.id || "";
    toast(`工作流中断：${run.error}`, "error");
  }

  run.running = false;
  run.phase = "";
  if (!run.paused) run.completedAt = Date.now();
  run.updatedAt = Date.now();
  save();
  deps.renderSettingsTab?.();
  if (run.completed) toast("工作流已完成", "success");
}

function setPrompt(text) {
  const input = document.querySelector("#promptInput");
  if (!input) return;
  input.value = text;
  input.dispatchEvent(new Event("input"));
  input.focus();
}

async function ensureTask(team) {
  const run = runState(team.id);
  if (run.task?.trim()) return run.task.trim();
  const result = await showModal("启动 Team 工作流", [
    { key: "task", label: "用户问题", value: "", type: "textarea", placeholder: "输入问题，工作流会从入口身份开始交接处理" },
  ]);
  if (!result?.task?.trim()) return "";
  run.task = result.task.trim();
  run.outputs = {};
  run.completed = false;
  run.currentStepId = team.entryStepId || team.workflow[0]?.id || "";
  run.updatedAt = Date.now();
  save();
  return run.task;
}

async function prepareNode(team, step, deps) {
  const task = await ensureTask(team);
  if (!task) return;
  const run = runState(team.id);
  run.currentStepId = step.id;
  run.completed = false;
  run.updatedAt = Date.now();
  save();

  if (step.nodeType === "start") {
    const next = nextSteps(team, step.id)[0];
    if (!next) {
      toast("开始节点还没有连到下一步", "error");
      deps.renderSettingsTab();
      return;
    }
    run.currentStepId = next.id;
    run.updatedAt = Date.now();
    save();
    toast(`从开始进入：${next.name}`, "success");
    await prepareNode(team, next, deps);
    return;
  }

  const r = await safeBridge("composeTeamStepPrompt", null, {
    teamId: team.id,
    stepId: step.id,
    task,
    previousOutputs: run.outputs || {},
    teamRunContext: buildTeamRunContext(team, run),
  });
  if (!r.ok || !r.data?.prompt) {
    toast(r.error || "生成节点提示词失败", "error");
    return;
  }
  await switchMemberContext(r.data.member, deps);
  setPrompt(r.data.prompt);
  document.querySelector("#settingsPage")?.classList.remove("is-open");
  document.querySelector("#teamsPage")?.classList.remove("is-open");
  toast(`已交给：${step.name}`, "success");
}

async function acceptAndHandoff(team, deps) {
  const run = runState(team.id);
  const step = stepById(team, activeStepId(team));
  if (!step) {
    toast("请先选择一个身份节点", "error");
    return;
  }
  const last = lastAssistantMessage();
  if (!last) {
    toast("没有可采纳的助手输出", "error");
    return;
  }
  const output = String(last.content || "").trim();
  run.outputs ||= {};
  run.outputs[step.id] = output;
  const edges = outgoingEdges(team, step.id);
  const decision = decisionFromText(output);
  let nextEdge = null;
  if (step.id === team.finalStepId && ["approve", "pass", "yes"].includes(decision)) {
    nextEdge = null;
  } else if (edges.length === 1) {
    nextEdge = edges[0];
  } else if (edges.length > 1) {
    nextEdge = edges.find(edge => edge.condition === decision) || edges.find(edge => edge.condition === "default") || null;
    if (!nextEdge) {
      const result = await showModal("选择交接路线", [
        {
          key: "edgeId",
          label: "下一步",
          type: "select",
          value: edges[0]?.id || "",
          options: edges.map(edge => ({
            value: edge.id,
            label: `${conditionLabel(edge.condition)} → ${stepById(team, edge.to)?.name || "未知节点"}`,
          })),
        },
      ]);
      nextEdge = edges.find(edge => edge.id === result?.edgeId) || null;
    }
  }
  const nextStep = nextEdge ? stepById(team, nextEdge.to) : null;
  if (nextStep) {
    run.currentStepId = nextStep.id;
    run.completed = false;
    toast(`已采纳，${conditionLabel(nextEdge.condition)}后交给：${nextStep.name}`, "success");
  } else {
    run.completed = true;
    toast("工作流已到最终节点，请确认正式输出", "success");
  }
  run.updatedAt = Date.now();
  save();
  deps.renderSettingsTab();
}

async function resetRun(team, renderSettingsTab) {
  const run = runState(team.id);
  run.task = "";
  run.goal = "";
  run.successCriteria = "";
  run.plan = "";
  run.planOutput = "";
  run.planAccepted = false;
  run.phase = "";
  run.currentStepId = team.entryStepId || team.workflow[0]?.id || "";
  run.outputs = {};
  run.stepHistory = [];
  run.conversation = [];
  run.completed = false;
  run.running = false;
  run.error = "";
  run.runId = "";
  run.startedAt = 0;
  run.completedAt = 0;
  run.updatedAt = Date.now();
  save();
  renderSettingsTab();
}

async function createTeamDlg(renderSettingsTab) {
  const result = await showModal("创建 Team 脑图", [
    { key: "name", label: "名称", value: "WorkBuddy Team" },
    { key: "description", label: "描述", value: "", type: "textarea" },
    { key: "cwd", label: "项目路径", value: state.cwd || "", placeholder: "留空使用全局项目路径" },
    { key: "runMode", label: "默认模式", type: "select", value: "workflow", options: teamRunModeOptions("workflow") },
    { key: "goal", label: "团队目标", value: "", type: "textarea", placeholder: "这个 Team 长期负责什么结果" },
    { key: "successCriteria", label: "验收标准", value: "", type: "textarea", placeholder: "达到什么条件才算完成" },
    { key: "rules", label: "团队规则", value: "", type: "textarea", placeholder: "所有身份共同遵守的规则、交接标准、最终输出标准" },
    { key: "planningRules", label: "计划规则", value: "", type: "textarea", placeholder: "计划阶段必须考虑的约束、风险和验证方式" },
  ]);
  if (!result?.name?.trim()) return;
  const r = await safeBridge("createTeam", null, result);
  if (r.ok) {
    state.selectedTeamId = r.data.id;
    save();
    toast("Team 已创建", "success");
    await refresh(renderSettingsTab);
  } else toast(r.error || "创建失败", "error");
}

async function createPmDevQaTemplate(renderSettingsTab) {
  const teamResult = await safeBridge("createTeam", null, {
    name: "PM-Dev-QA Loop",
    description: "项目经理澄清需求，开发实现，测试循环验收，最终由项目经理审核后交付。",
    runMode: "goal",
    goal: "把用户问题转成可实现、可测试、可交付的结果。",
    successCriteria: "需求清楚，开发完成，测试通过，项目经理审核同意后才输出。",
    planningRules: "先明确目标和验收标准，再安排 PM、开发、测试的交接顺序。",
    rules: [
      "所有身份必须只处理自己职责内的事情。",
      "交接给下一身份前，要给出清楚的输入、已完成内容和剩余风险。",
      "评审类身份必须在最后一行输出 DECISION: pass 或 DECISION: revise。",
      "审核类身份必须按节点交接线输出对应 DECISION；本模板项目审核使用 DECISION: yes 或 DECISION: no。",
    ].join("\n"),
  });
  if (!teamResult.ok) {
    toast(teamResult.error || "创建模板失败", "error");
    return;
  }
  const teamId = teamResult.data.id;
  const pm = await safeBridge("createTeamMember", null, teamId, {
    name: "项目经理",
    icon: "PM",
    role: "把用户原始问题澄清为可执行需求，最后审核结果是否满足用户目标。",
    rules: "先复述目标、补齐约束、拆出验收标准，然后交接给开发。不要请求用户批准退出 Plan mode，也不要声称自己会开始写文件。",
    permissionMode: "auto",
  });
  const dev = await safeBridge("createTeamMember", null, teamId, {
    name: "程序开发",
    icon: "DEV",
    role: "根据项目经理或测试反馈修改代码，输出改动摘要和验证结果。",
    rules: "优先实现最小可用修复。收到测试返工意见时，只围绕意见修正并说明验证。",
    permissionMode: "auto",
  });
  const qa = await safeBridge("createTeamMember", null, teamId, {
    name: "软件测试",
    icon: "QA",
    role: "验证开发结果，提出可执行返工意见，直到认为满足验收标准。",
    rules: "不满意时列出具体失败点和复现方式，最后输出 DECISION: revise。满意时说明通过范围，最后输出 DECISION: pass。",
    permissionMode: "auto",
  });
  if (!pm.ok || !dev.ok || !qa.ok) {
    toast("模板身份创建失败", "error");
    await refresh(renderSettingsTab);
    return;
  }
  const start = await safeBridge("createTeamStep", null, teamId, {
    name: "开始",
    nodeType: "start",
    x: 60,
    y: 150,
    instruction: "从右侧任务输入开始，把用户原始问题交给项目经理。",
  });
  const intake = await safeBridge("createTeamStep", null, teamId, {
    name: "需求澄清",
    nodeType: "intake",
    memberId: pm.data.member.id,
    x: 280,
    y: 150,
    instruction: "接收用户原始问题，不要求用户懂怎么分配。把问题转成清晰需求、范围、约束和验收标准，然后交给开发。不要要求用户批准退出 Plan mode，不要说自己正在写文件。",
  });
  const build = await safeBridge("createTeamStep", null, teamId, {
    name: "开发实现",
    nodeType: "work",
    memberId: dev.data.member.id,
    x: 500,
    y: 150,
    instruction: "根据上游需求或测试返工意见完成实现/修改。输出改动点、关键文件、验证方式和仍需测试关注的风险。",
  });
  const test = await safeBridge("createTeamStep", null, teamId, {
    name: "测试验收",
    nodeType: "review",
    memberId: qa.data.member.id,
    x: 720,
    y: 150,
    instruction: "验证开发输出是否满足验收标准。发现问题就给开发可执行返工意见；满意才允许通过。",
    decisionInstruction: "如果仍需开发修改，最后一行输出 DECISION: revise。如果测试满意，最后一行输出 DECISION: pass。",
  });
  const audit = await safeBridge("createTeamStep", null, teamId, {
    name: "项目审核",
    nodeType: "approval",
    memberId: pm.data.member.id,
    x: 940,
    y: 150,
    instruction: "审核测试通过后的结果是否真正解决用户问题。通过则交给输出结果节点，不通过则退回测试补充建议。",
    decisionInstruction: "如果可交付，最后一行输出 DECISION: yes。如果仍需补充测试或返工，最后一行输出 DECISION: no。",
  });
  const output = await safeBridge("createTeamStep", null, teamId, {
    name: "输出结果",
    nodeType: "final",
    memberId: pm.data.member.id,
    x: 1160,
    y: 150,
    instruction: "把项目经理审核通过的结果整理成给用户的正式答复，只输出最终结论、变更摘要和验证状态。",
  });
  if (!start.ok || !intake.ok || !build.ok || !test.ok || !audit.ok || !output.ok) {
    toast("模板节点创建失败", "error");
    await refresh(renderSettingsTab);
    return;
  }
  await safeBridge("updateTeamWorkflow", null, teamId, {
    entryStepId: start.data.step.id,
    finalStepId: output.data.step.id,
    workflowEdges: [
      { from: start.data.step.id, to: intake.data.step.id, condition: "default", label: "开始交给项目经理" },
      { from: intake.data.step.id, to: build.data.step.id, condition: "default", label: "需求交给开发" },
      { from: build.data.step.id, to: test.data.step.id, condition: "default", label: "开发完成交给测试" },
      { from: test.data.step.id, to: build.data.step.id, condition: "revise", label: "测试不满意返工" },
      { from: test.data.step.id, to: audit.data.step.id, condition: "pass", label: "测试满意进入项目审核" },
      { from: audit.data.step.id, to: output.data.step.id, condition: "yes", label: "项目经理审核通过" },
      { from: audit.data.step.id, to: test.data.step.id, condition: "no", label: "项目经理不满意，回到测试补充" },
    ],
  });
  state.selectedTeamId = teamId;
  save();
  toast("PM-Dev-QA 循环模板已创建", "success");
  await refresh(renderSettingsTab);
}

async function createCodeReviewTemplate(renderSettingsTab) {
  const teamResult = await safeBridge("createTeam", null, {
    name: "代码审查模板",
    description: "面向第一次体验 Teams 的轻量代码审查流：先发现风险，再整理可执行结论。",
    runMode: "plan",
    goal: "快速找出当前代码或变更里的具体风险，并整理成可处理结论。",
    successCriteria: "发现有文件、行为或测试证据支撑；结论按严重程度排序；输出能直接执行。",
    planningRules: "先界定审查范围，再分配审查和整理职责。",
    rules: [
      "聚焦可复现的 bug、回归风险、安全问题和测试缺口。",
      "不要做无关重构建议；每条发现都要包含影响、位置和建议验证方式。",
      "最终输出按严重程度排序，并明确哪些问题需要立即处理。",
    ].join("\n"),
  });
  if (!teamResult.ok) {
    toast(teamResult.error || "创建代码审查模板失败", "error");
    return;
  }
  const teamId = teamResult.data.id;
  const reviewer = await safeBridge("createTeamMember", null, teamId, {
    name: "代码审查员",
    icon: "REV",
    role: "阅读当前改动和相关上下文，找出具体 bug、风险和测试缺口。",
    rules: "只报告能落到文件、行为或测试上的问题。按严重程度排序，避免泛泛而谈。",
    permissionMode: "auto",
  });
  const summarizer = await safeBridge("createTeamMember", null, teamId, {
    name: "结论整理员",
    icon: "SUM",
    role: "把审查发现整理成用户可直接处理的结论和下一步。",
    rules: "保留证据和优先级，合并重复项，最后给出建议验证命令。",
    permissionMode: "auto",
  });
  if (!reviewer.ok || !summarizer.ok) {
    toast("代码审查模板身份创建失败", "error");
    await refresh(renderSettingsTab);
    return;
  }
  const start = await safeBridge("createTeamStep", null, teamId, {
    name: "开始",
    nodeType: "start",
    x: 80,
    y: 140,
    instruction: "接收用户的审查目标，交给代码审查员。",
  });
  const review = await safeBridge("createTeamStep", null, teamId, {
    name: "审查改动",
    nodeType: "review",
    memberId: reviewer.data.member.id,
    x: 320,
    y: 140,
    instruction: "检查当前项目或用户指定范围内的代码改动，输出具体问题、风险等级、证据和验证建议。",
  });
  const summary = await safeBridge("createTeamStep", null, teamId, {
    name: "整理结论",
    nodeType: "work",
    memberId: summarizer.data.member.id,
    x: 560,
    y: 140,
    instruction: "将审查员输出整理成清晰的用户回复：发现列表、影响、建议修复顺序和测试建议。",
  });
  const output = await safeBridge("createTeamStep", null, teamId, {
    name: "输出结果",
    nodeType: "final",
    memberId: summarizer.data.member.id,
    x: 800,
    y: 140,
    instruction: "只输出最终代码审查结论，不重复中间过程。",
  });
  if (!start.ok || !review.ok || !summary.ok || !output.ok) {
    toast("代码审查模板节点创建失败", "error");
    await refresh(renderSettingsTab);
    return;
  }
  await safeBridge("updateTeamWorkflow", null, teamId, {
    entryStepId: start.data.step.id,
    finalStepId: output.data.step.id,
    workflowEdges: [
      { from: start.data.step.id, to: review.data.step.id, condition: "default", label: "开始审查" },
      { from: review.data.step.id, to: summary.data.step.id, condition: "default", label: "交给整理" },
      { from: summary.data.step.id, to: output.data.step.id, condition: "default", label: "输出结论" },
    ],
  });
  state.selectedTeamId = teamId;
  save();
  toast("代码审查模板已创建", "success");
  await refresh(renderSettingsTab);
}

async function editTeamDlg(team, renderSettingsTab) {
  const result = await showModal("编辑 Team", [
    { key: "name", label: "名称", value: team.name || "" },
    { key: "description", label: "描述", value: team.description || "", type: "textarea" },
    { key: "cwd", label: "项目路径", value: team.cwd || "", placeholder: "留空使用全局项目路径" },
    { key: "runMode", label: "默认模式", type: "select", value: team.runMode || "workflow", options: teamRunModeOptions(team.runMode || "workflow") },
    { key: "goal", label: "团队目标", value: team.goal || "", type: "textarea" },
    { key: "successCriteria", label: "验收标准", value: team.successCriteria || "", type: "textarea" },
    { key: "rules", label: "团队规则", value: team.rules || "", type: "textarea" },
    { key: "planningRules", label: "计划规则", value: team.planningRules || "", type: "textarea" },
  ]);
  if (!result) return;
  const r = await safeBridge("updateTeam", null, team.id, result);
  if (r.ok) { toast("Team 已更新", "success"); await refresh(renderSettingsTab); }
  else toast(r.error || "更新失败", "error");
}

async function deleteTeamDlg(team, renderSettingsTab) {
  if (!await showConfirm("删除 Team", `确定删除“${team.name}”？`)) return;
  const r = await safeBridge("deleteTeam", null, team.id);
  if (r.ok) {
    if (state.selectedTeamId === team.id) state.selectedTeamId = "";
    save();
    toast("Team 已删除", "success");
    await refresh(renderSettingsTab);
  } else toast(r.error || "删除失败", "error");
}

async function memberDlg(team, member, renderSettingsTab) {
  const result = await showModal(member ? "编辑身份" : "添加身份", [
    { key: "name", label: "名称", value: member?.name || "新身份" },
    { key: "icon", label: "标识", value: member?.icon || "ID" },
    { key: "role", label: "职责", value: member?.role || "", type: "textarea" },
    { key: "rules", label: "身份规则", value: member?.rules || "", type: "textarea", placeholder: "这个身份如何思考、如何交接、如何输出" },
    { key: "providerId", label: "Provider", type: "select", value: member?.providerId || "", options: providerOptions(member?.providerId || "") },
    { key: "identityId", label: "Skills 身份", type: "select", value: member?.identityId || "", options: identityOptions(member?.identityId || "") },
    { key: "agentRuntimeId", label: "Agent Runtime", type: "select", value: member?.agentRuntimeId || "", options: runtimeOptions(member?.agentRuntimeId || "") },
    { key: "permissionMode", label: "权限模式", type: "select", value: member?.permissionMode || "auto", options: [
      { value: "auto", label: "Auto" },
      { value: "plan", label: "Plan" },
      { value: "bypass", label: "Bypass" },
    ] },
  ]);
  if (!result?.name?.trim()) return;
  const method = member ? "updateTeamMember" : "createTeamMember";
  const args = member ? [team.id, member.id, result] : [team.id, result];
  const r = await safeBridge(method, null, ...args);
  if (r.ok) { toast(member ? "身份已更新" : "身份已添加", "success"); await refresh(renderSettingsTab); }
  else toast(r.error || "保存失败", "error");
}

async function deleteMemberDlg(team, member, renderSettingsTab) {
  if (!await showConfirm("删除身份", `确定删除“${member.name}”？相关节点会变成未绑定。`)) return;
  const r = await safeBridge("deleteTeamMember", null, team.id, member.id);
  if (r.ok) { toast("身份已删除", "success"); await refresh(renderSettingsTab); }
  else toast(r.error || "删除失败", "error");
}

async function nodeDlg(team, step, renderSettingsTab) {
  const result = await showModal(step ? "编辑脑图节点" : "添加脑图节点", [
    { key: "name", label: "节点名", value: step?.name || "新处理节点" },
    { key: "nodeType", label: "节点类型", type: "select", value: step?.nodeType || "work", options: nodeTypeOptions(step?.nodeType || "work") },
    { key: "memberId", label: "执行身份", type: "select", value: step?.memberId || "", options: memberOptions(team, step?.memberId || "") },
    { key: "instruction", label: "节点指令", value: step?.instruction || "", type: "textarea", placeholder: "这个身份收到问题后要处理什么，处理完交接什么" },
    { key: "decisionInstruction", label: "路由判断", value: step?.decisionInstruction || "", type: "textarea", placeholder: "需要条件分支时填写。例如：测试满意输出 DECISION: pass，否则输出 DECISION: revise" },
  ]);
  if (!result?.name?.trim()) return;
  const method = step ? "updateTeamStep" : "createTeamStep";
  const args = step ? [team.id, step.id, result] : [team.id, { ...result, x: 90 + team.workflow.length * 40, y: 90 + team.workflow.length * 30 }];
  const r = await safeBridge(method, null, ...args);
  if (r.ok) { toast(step ? "节点已更新" : "节点已添加", "success"); await refresh(renderSettingsTab); }
  else toast(r.error || "保存失败", "error");
}

async function addNodeFromComponent(team, type, position, renderSettingsTab) {
  const component = COMPONENTS.find(item => item.type === type) || COMPONENTS[1];
  const r = await safeBridge("createTeamStep", null, team.id, {
    name: component.name,
    nodeType: component.type,
    memberId: "",
    instruction: component.instruction,
    decisionInstruction: component.type === "review"
      ? "满意时输出 DECISION: pass；不满意时输出 DECISION: revise。"
      : component.type === "approval"
        ? "通过时输出 DECISION: approve；不通过时输出 DECISION: reject。"
        : "",
    x: position?.x ?? 120 + team.workflow.length * 48,
    y: position?.y ?? 120 + team.workflow.length * 36,
  });
  if (!r.ok) {
    toast(r.error || "添加组件失败", "error");
    return;
  }
  if (component.type === "start") {
    await safeBridge("updateTeamWorkflow", null, team.id, { entryStepId: r.data.step.id });
  }
  if (component.type === "final") {
    await safeBridge("updateTeamWorkflow", null, team.id, { finalStepId: r.data.step.id });
  }
  toast(`已添加组件：${component.name}`, "success");
  await refresh(renderSettingsTab);
}

async function addNodeFromMember(team, memberId, position, renderSettingsTab) {
  const member = memberById(team, memberId);
  if (!member) return;
  const r = await safeBridge("createTeamStep", null, team.id, {
    name: member.name,
    nodeType: "work",
    memberId: member.id,
    instruction: member.role || member.rules || "按该身份规则处理上游输入，并把结果交给下一节点。",
    x: position?.x ?? 140 + team.workflow.length * 48,
    y: position?.y ?? 140 + team.workflow.length * 36,
  });
  if (r.ok) {
    toast(`已添加身份节点：${member.name}`, "success");
    await refresh(renderSettingsTab);
  } else {
    toast(r.error || "添加身份节点失败", "error");
  }
}

async function deleteNodeDlg(team, step, renderSettingsTab) {
  if (!await showConfirm("删除节点", `确定删除“${step.name}”？相关连线也会删除。`)) return;
  const r = await safeBridge("deleteTeamStep", null, team.id, step.id);
  if (r.ok) { toast("节点已删除", "success"); await refresh(renderSettingsTab); }
  else toast(r.error || "删除失败", "error");
}

async function saveGraph(team, updates, renderSettingsTab, rerender = true) {
  const r = await safeBridge("updateTeamWorkflow", null, team.id, updates);
  if (!r.ok) {
    toast(r.error || "保存脑图失败", "error");
    return null;
  }
  data.teams = data.teams.map(item => item.id === team.id ? r.data : item);
  if (rerender) renderSettingsTab();
  return r.data;
}

async function connectNodes(team, fromId, toId, renderSettingsTab) {
  if (!fromId || !toId || fromId === toId) return;
  const edges = workflowEdges(team);
  const result = await showModal("设置交接线", [
    { key: "condition", label: "条件", type: "select", value: "default", options: conditionOptions("default") },
    { key: "label", label: "说明", value: "", placeholder: "例如：测试不满意返工、测试通过交给项目经理" },
  ]);
  if (!result) return;
  if (edges.some(edge => edge.from === fromId && edge.to === toId && edge.condition === result.condition)) {
    toast("这条交接线已经存在", "info");
    return;
  }
  await saveGraph(team, { workflowEdges: [...edges, { from: fromId, to: toId, condition: result.condition || "default", label: result.label || "" }] }, renderSettingsTab);
}

async function deleteEdge(team, edge, renderSettingsTab) {
  const edges = workflowEdges(team).filter(item => item.id !== edge.id);
  await saveGraph(team, { workflowEdges: edges }, renderSettingsTab);
}

async function markNode(team, step, key, renderSettingsTab) {
  await saveGraph(team, { [key]: step.id }, renderSettingsTab);
}

function buildRunAudit(team, run) {
  const history = run.stepHistory || [];
  return {
    team: {
      id: team.id,
      name: team.name,
      description: team.description || "",
      cwd: team.cwd || state.cwd || "",
      members: team.members.map(member => ({
        id: member.id,
        name: member.name,
        providerId: member.providerId || "",
        identityId: member.identityId || "",
        agentRuntimeId: member.agentRuntimeId || "",
        agentRuntimeName: runtimeName(member.agentRuntimeId || ""),
        permissionMode: effectiveTeamPermissionMode(member),
      })),
    },
    run: {
      id: run.runId || "",
      task: run.task || "",
      mode: effectiveTeamRunMode(team, run),
      goal: teamGoalText(team, run),
      successCriteria: teamSuccessCriteriaText(team, run),
      planAccepted: Boolean(run.planAccepted),
      planPreview: summarizeText(teamPlanText(run), 400),
      status: run.running ? "running" : run.completed ? "completed" : run.error ? "error" : "idle",
      error: run.error || "",
      startedAt: run.startedAt || 0,
      completedAt: run.completedAt || 0,
      durationMs: run.startedAt && run.completedAt ? run.completedAt - run.startedAt : 0,
      steps: history.map(item => {
        const step = stepById(team, item.stepId);
        const next = item.nextStepId ? stepById(team, item.nextStepId) : null;
        return {
          id: item.id || "",
          stepId: item.stepId,
          stepName: step?.name || item.stepId,
          memberId: item.memberId || "",
          memberName: memberById(team, item.memberId)?.name || "",
          status: item.status || "done",
          decision: item.decision || "",
          routeCondition: item.routeCondition || "",
          nextStepId: item.nextStepId || "",
          nextStepName: next?.name || "",
          providerName: item.providerName || "",
          model: item.model || "",
          identityName: item.identityName || "",
          agentRuntimeId: item.agentRuntimeId || "",
          agentRuntimeName: item.agentRuntimeName || runtimeName(item.agentRuntimeId || ""),
          cwd: item.cwd || "",
          durationMs: item.durationMs || 0,
          outputPreview: item.outputPreview || summarizeText(item.output, 220),
          error: item.error || "",
          errorCategory: item.errorCategory || "",
          stderrPreview: item.stderrPreview || "",
          changedFiles: normalizeChangedFiles(item.changedFiles),
          auditEvents: normalizeAuditEvents(item.auditEvents),
          timestamp: item.timestamp || 0,
        };
      }),
    },
  };
}

function auditToMarkdown(audit) {
  const lines = [
    `# ${audit.team.name} Run Audit`,
    "",
    `- Status: ${audit.run.status}`,
    `- Mode: ${audit.run.mode || "workflow"}`,
    `- Task: ${audit.run.task || "--"}`,
    `- Goal: ${audit.run.goal || "--"}`,
    `- Success criteria: ${audit.run.successCriteria || "--"}`,
    `- Project: ${audit.team.cwd || "--"}`,
    `- Duration: ${Math.round((audit.run.durationMs || 0) / 1000)}s`,
  ];
  if (audit.run.planPreview) lines.push(`- Plan: ${audit.run.planPreview}`);
  if (audit.run.error) lines.push(`- Error: ${audit.run.error}`);
  lines.push("", "## Steps");
  for (const step of audit.run.steps) {
    lines.push(
      "",
      `### ${step.stepName}`,
      `- Member: ${step.memberName || "--"}`,
      `- Status: ${step.status}`,
      `- Provider: ${step.providerName || "--"}${step.model ? ` / ${step.model}` : ""}`,
      `- Identity: ${step.identityName || "--"}`,
      `- Agent Runtime: ${step.agentRuntimeName || step.agentRuntimeId || "--"}`,
      `- Duration: ${Math.round((step.durationMs || 0) / 1000)}s`,
      `- Decision: ${step.decision || "--"}`,
      `- Route: ${step.routeCondition || "--"}${step.nextStepName ? ` -> ${step.nextStepName}` : ""}`,
      `- Changed files: ${step.changedFiles.length ? step.changedFiles.join(", ") : "--"}`,
      `- Audit events: ${step.auditEvents.length}`,
      "",
      step.error ? `Error: ${step.error}` : (step.outputPreview || "--"),
    );
    if (step.errorCategory) lines.push(`Error category: ${step.errorCategory}`);
    if (step.stderrPreview) lines.push(`Stderr: ${step.stderrPreview}`);
    for (const event of step.auditEvents.slice(0, 12)) {
      const status = event.ok === undefined ? "" : event.ok ? " ok" : " failed";
      const detail = event.detail ? ` - ${event.detail}` : "";
      const paths = event.paths?.length ? ` (${event.paths.join(", ")})` : "";
      lines.push(`- ${event.type || "event"}${status}: ${event.title || event.tool || "event"}${detail}${paths}`);
    }
  }
  return lines.join("\n");
}

function downloadText(filename, content, type = "text/plain") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportTeamRun(team, run, format = "json") {
  const audit = buildRunAudit(team, run);
  const safeName = String(team.name || "team").replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "") || "team";
  if (format === "md") {
    downloadText(`${safeName}-run-audit.md`, auditToMarkdown(audit), "text/markdown");
  } else {
    downloadText(`${safeName}-run-audit.json`, JSON.stringify(audit, null, 2), "application/json");
  }
  toast("运行审计已导出", "success");
}

function renderTeamList({ settingsBody, renderSettingsTab }) {
  const wrap = document.createElement("div");
  wrap.className = "scard";
  wrap.innerHTML = `<div class="scard-head"><span class="scard-title">Teams</span><div class="scard-actions"><button class="st-btn t-btn--link" id="reviewTemplateTeamBtn">代码审查模板</button><button class="st-btn t-btn--link" id="templateTeamBtn">PM-Dev-QA 模板</button><button class="st-btn t-btn--primary t-btn--sm" id="createTeamBtn">创建 Team</button></div></div>`;
  settingsBody.append(wrap);
  wrap.querySelector("#createTeamBtn").addEventListener("click", () => createTeamDlg(renderSettingsTab));
  wrap.querySelector("#templateTeamBtn").addEventListener("click", () => createPmDevQaTemplate(renderSettingsTab));
  wrap.querySelector("#reviewTemplateTeamBtn").addEventListener("click", () => createCodeReviewTemplate(renderSettingsTab));

  for (const team of data.teams) {
    const row = document.createElement("div");
    row.className = "slist-item" + (team.id === selectedTeam()?.id ? " is-active" : "");
    row.innerHTML = `
      <div class="slist-icon">TM</div>
      <div class="slist-body">
        <div class="slist-name">${escapeHtml(team.name)}</div>
        <div class="slist-sub">${team.members.length} 身份 / ${team.workflow.length} 节点 / ${workflowEdges(team).length} 交接线 · ${escapeHtml(team.description || "")}</div>
      </div>
      <div class="slist-actions">
        <button class="st-btn t-btn--link" data-act="open">打开</button>
        <button class="st-btn t-btn--link" data-act="edit">编辑</button>
        <button class="st-btn t-btn--danger t-btn--sm" data-act="delete">删除</button>
      </div>
    `;
    row.querySelector('[data-act="open"]').addEventListener("click", () => { state.selectedTeamId = team.id; save(); renderSettingsTab(); });
    row.querySelector('[data-act="edit"]').addEventListener("click", () => editTeamDlg(team, renderSettingsTab));
    row.querySelector('[data-act="delete"]').addEventListener("click", () => deleteTeamDlg(team, renderSettingsTab));
    settingsBody.append(row);
  }
}

function renderRightPanel(team, deps) {
  const { settingsBody, renderSettingsTab } = deps;
  const run = runState(team.id);
  const step = stepById(team, activeStepId(team));
  const panel = document.createElement("div");
  panel.className = "team-right-panel";

  // Status bar
  const statusBar = document.createElement("div");
  statusBar.className = "team-status-bar";
  const mode = effectiveTeamRunMode(team, run);
  const statusLabel = run.running && run.phase === "planning" ? "计划中" : run.running ? "运行中" : run.completed ? "已完成" : run.error ? "异常" : "就绪";
  const statusClass = run.running ? "is-running" : run.completed ? "is-done" : run.error ? "is-error" : "is-idle";
  const stepCount = (run.stepHistory || []).length;
  statusBar.innerHTML = `
    <span class="team-status-badge team-status-${statusClass}">${statusLabel}</span>
    <span class="team-status-info">${teamRunModeLabel(mode)} · ${stepCount} 步${run.runId ? ` · ${escapeHtml(String(run.runId).slice(0, 8))}` : ""}</span>
    <button class="team-mini-btn" id="exportRunJsonBtn" type="button" ${stepCount ? "" : "disabled"}>JSON</button>
    <button class="team-mini-btn" id="exportRunMdBtn" type="button" ${stepCount ? "" : "disabled"}>MD</button>
  `;
  statusBar.querySelector("#exportRunJsonBtn")?.addEventListener("click", () => exportTeamRun(team, run, "json"));
  statusBar.querySelector("#exportRunMdBtn")?.addEventListener("click", () => exportTeamRun(team, run, "md"));
  panel.append(statusBar);

  const overview = document.createElement("div");
  overview.className = "team-run-overview";
  const goal = teamGoalText(team, run);
  const criteria = teamSuccessCriteriaText(team, run);
  const plan = teamPlanText(run);
  const roster = team.members.slice(0, 5).map(member => `
    <div class="team-roster-pill" title="${escapeHtml(member.role || member.rules || member.name)}">
      <span>${escapeHtml(member.icon || "ID")}</span>${escapeHtml(member.name)}
    </div>`).join("");
  overview.innerHTML = `
    <div class="team-run-overview-head">
      <span class="team-mode-chip">${escapeHtml(teamRunModeLabel(mode))}</span>
      <span>${escapeHtml(team.members.length)} 身份 · ${escapeHtml(workflowEdges(team).length)} 交接线</span>
    </div>
    ${goal ? `<div class="team-run-field"><span>目标</span><strong>${escapeHtml(summarizeText(goal, 110))}</strong></div>` : ""}
    ${criteria ? `<div class="team-run-field"><span>验收</span><strong>${escapeHtml(summarizeText(criteria, 110))}</strong></div>` : ""}
    <div class="team-roster-strip">${roster || `<span class="team-run-muted">暂无身份</span>`}</div>
    ${plan ? `<div class="team-plan-card"><div class="team-plan-card-head">${run.planAccepted ? "已采纳计划" : "最近计划"}</div><div class="team-plan-preview">${escapeHtml(summarizeText(plan, 220))}</div></div>` : ""}
  `;
  panel.append(overview);

  // Tab switcher
  const tabs = document.createElement("div");
  tabs.className = "team-right-tabs";
  tabs.innerHTML = `
    <button class="team-right-tab is-active" data-tab="props">属性</button>
    <button class="team-right-tab" data-tab="chat">对话</button>
    <button class="team-right-tab" data-tab="log">记录 ${run.stepHistory?.length ? `(${run.stepHistory.length})` : ""}</button>
  `;
  panel.append(tabs);

  // Tab content containers
  const propsBody = document.createElement("div");
  propsBody.className = "team-right-body";
  const chatBody = document.createElement("div");
  chatBody.className = "team-right-body team-chat-panel";
  chatBody.style.display = "none";
  const logBody = document.createElement("div");
  logBody.className = "team-right-body";
  logBody.style.display = "none";
  panel.append(propsBody, chatBody, logBody);
  settingsBody.append(panel);

  // Tab switching
  tabs.addEventListener("click", e => {
    const btn = e.target.closest(".team-right-tab");
    if (!btn) return;
    tabs.querySelectorAll(".team-right-tab").forEach(b => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    const tab = btn.dataset.tab;
    propsBody.style.display = tab === "props" ? "" : "none";
    chatBody.style.display = tab === "chat" ? "" : "none";
    logBody.style.display = tab === "log" ? "" : "none";
  });

  // Properties tab
  if (step) {
    propsBody.innerHTML = `
      <div class="team-prop-section">
        <div class="team-prop-row"><label>名称</label><input class="team-config-input" id="nodeNameInput" value="${escapeHtml(step.name || "")}"></div>
        <div class="team-prop-row"><label>类型</label><select class="team-config-select" id="nodeTypeSelect">${nodeTypeOptions(step.nodeType || "work").map(o => `<option value="${o.value}" ${o.selected ? "selected" : ""}>${o.label}</option>`).join("")}</select></div>
        <div class="team-prop-row"><label>身份</label><select class="team-config-select" id="nodeMemberSelect">${memberOptions(team, step.memberId || "").map(o => `<option value="${o.value}" ${o.selected ? "selected" : ""}>${o.label}</option>`).join("")}</select></div>
        <label class="team-check-row"><input type="checkbox" id="nodeApprovalInput" ${step.requiresApproval ? "checked" : ""}> <span>完成后需要人工确认再交接</span></label>
        <div class="team-prop-row"><label>指令</label><textarea class="team-config-textarea" id="nodeInstructionInput">${escapeHtml(step.instruction || "")}</textarea></div>
        <div class="team-prop-row"><label>路由判断</label><textarea class="team-config-textarea" id="nodeDecisionInput" placeholder="满意输出 DECISION: pass，不满意输出 DECISION: revise">${escapeHtml(step.decisionInstruction || "")}</textarea></div>
        <div class="team-prop-actions">
          <button class="st-btn t-btn--link" id="markEntryBtn">设为入口</button>
          <button class="st-btn t-btn--link" id="markFinalBtn">设为输出</button>
          <button class="st-btn t-btn--danger t-btn--sm" id="deleteNodeBtn">删除</button>
          <button class="st-btn t-btn--primary t-btn--sm" id="saveNodeConfigBtn">保存</button>
        </div>
      </div>
    `;
    propsBody.querySelector("#markEntryBtn").addEventListener("click", () => markNode(team, step, "entryStepId", renderSettingsTab));
    propsBody.querySelector("#markFinalBtn").addEventListener("click", () => markNode(team, step, "finalStepId", renderSettingsTab));
    propsBody.querySelector("#deleteNodeBtn").addEventListener("click", () => deleteNodeDlg(team, step, renderSettingsTab));
    propsBody.querySelector("#saveNodeConfigBtn").addEventListener("click", async () => {
      const r = await safeBridge("updateTeamStep", null, team.id, step.id, {
        name: propsBody.querySelector("#nodeNameInput").value,
        nodeType: propsBody.querySelector("#nodeTypeSelect").value,
        memberId: propsBody.querySelector("#nodeMemberSelect").value,
        requiresApproval: propsBody.querySelector("#nodeApprovalInput").checked,
        instruction: propsBody.querySelector("#nodeInstructionInput").value,
        decisionInstruction: propsBody.querySelector("#nodeDecisionInput").value,
      });
      if (r.ok) { toast("已保存", "success"); await refresh(renderSettingsTab); }
      else toast(r.error || "保存失败", "error");
    });
  } else {
    propsBody.innerHTML = `<div class="slist-sub" style="padding:16px;">点击画布中的节点查看和编辑属性。</div>`;
  }

  // Execution log tab
  renderExecutionLogContent(team, run, logBody);

  // Conversation tab - show messages grouped by identity
  renderConversationTab(team, run, chatBody, deps);
}

function renderExecutionLogContent(team, run, container) {
  const history = run.stepHistory || [];
  const activeStep = run.running ? stepById(team, run.currentStepId) : null;

  if (!history.length && !run.running && !run.error) {
    container.innerHTML = `
      <div class="team-log-empty">
        <div class="team-log-empty-icon">▶</div>
        <div class="team-log-empty-text">运行工作流后，执行记录会显示在这里</div>
      </div>`;
    return;
  }

  // Running step
  if (run.running && activeStep) {
    const member = memberById(team, activeStep.memberId);
    const nc = nodeColor(activeStep.nodeType || "work");
    const row = document.createElement("div");
    row.className = "team-log-card is-executing";
    row.innerHTML = `
      <div class="team-log-card-bar" style="background:${nc.bar};"></div>
      <div class="team-log-card-head">
        <div class="team-log-avatar" style="background:${nc.bg};border-color:${nc.border};color:${nc.icon};">${escapeHtml(member?.icon || "ID")}</div>
        <div class="team-log-info">
          <span class="team-log-name">${escapeHtml(activeStep.name)}</span>
          <span class="team-log-meta">${escapeHtml(member?.name || "未绑定")}</span>
        </div>
        <span class="team-log-status-badge team-log-status-running">执行中...</span>
      </div>
      <div class="team-log-body">
        <div class="team-log-progress"><div class="team-log-progress-bar"></div></div>
      </div>
    `;
    container.append(row);
  }

  // Completed steps (newest first)
  for (const item of [...history].reverse()) {
    const step = stepById(team, item.stepId);
    const member = step ? memberById(team, step.memberId) : null;
    const next = item.nextStepId ? stepById(team, item.nextStepId) : null;
    const nc = item.stepId === "__team_plan"
      ? { bg: "rgba(99,102,241,0.12)", border: "rgba(129,140,248,0.45)", bar: "#818cf8", icon: "#a5b4fc" }
      : nodeColor(step?.nodeType || "work");
    const displayName = step?.name || item.stepName || item.stepId;
    const displayMemberName = member?.name || item.memberName || "";
    const displayIcon = member?.icon || (item.stepId === "__team_plan" ? "PLN" : "ID");
    const row = document.createElement("div");
    row.className = `team-log-card${item.status === "error" ? " team-log-error" : ""}`;
    const preview = item.outputPreview || summarizeText(item.output || item.error, 220);
    const timeStr = item.timestamp ? new Date(item.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
    const duration = item.durationMs ? `${Math.round(item.durationMs / 1000)}s` : "";
    const model = [item.providerName, item.model].filter(Boolean).join(" · ");
    const route = item.routeCondition ? `${conditionLabel(item.routeCondition)}${next ? ` → ${next.name}` : ""}` : "";
    const auditEvents = normalizeAuditEvents(item.auditEvents);
    const changedFiles = normalizeChangedFiles(item.changedFiles);
    const decisionHtml = item.decision ? `<span class="team-log-decision team-log-decision-${item.decision}">${item.decision}</span>` : "";
    row.innerHTML = `
      <div class="team-log-card-bar" style="background:${item.status === "error" ? "#ef4444" : nc.bar};opacity:0.5;"></div>
      <div class="team-log-card-head">
        <div class="team-log-avatar" style="background:${nc.bg};border-color:${nc.border};color:${nc.icon};">${escapeHtml(displayIcon)}</div>
        <div class="team-log-info">
          <span class="team-log-name">${escapeHtml(displayName)}</span>
          <span class="team-log-meta">${escapeHtml(displayMemberName)}${timeStr ? ` · ${timeStr}` : ""}${duration ? ` · ${duration}` : ""}</span>
        </div>
        <div class="team-log-badges">
          ${decisionHtml}
          <span class="team-log-status-badge ${item.status === "error" ? "team-status-is-error" : "team-log-status-done"}">${item.status === "error" ? "!" : "✓"}</span>
        </div>
      </div>
      <div class="team-log-body">
        <div class="team-log-evidence">
          ${model ? `<span>${escapeHtml(model)}</span>` : ""}
          ${item.identityName ? `<span>${escapeHtml(item.identityName)}</span>` : ""}
          ${item.agentRuntimeName || item.agentRuntimeId ? `<span>${escapeHtml(item.agentRuntimeName || item.agentRuntimeId)}</span>` : ""}
          ${item.cwd ? `<span title="${escapeHtml(item.cwd)}">${escapeHtml(compactPath(item.cwd))}</span>` : ""}
          ${route ? `<span>${escapeHtml(route)}</span>` : ""}
          ${changedFiles.length ? `<span>${changedFiles.length} files</span>` : ""}
          ${auditEvents.length ? `<span>${auditEvents.length} events</span>` : ""}
        </div>
        <div class="team-log-preview">${escapeHtml(preview || "--")}</div>
      </div>
    `;
    row.querySelector(".team-log-preview")?.addEventListener("click", () => {
      row.querySelector(".team-log-preview").classList.toggle("is-expanded");
    });
    container.append(row);
  }

  // Error
  if (run.error) {
    const err = document.createElement("div");
    err.className = "team-log-card team-log-error";
    err.innerHTML = `
      <div class="team-log-card-bar" style="background:#ef4444;"></div>
      <div class="team-log-card-head">
        <div class="team-log-avatar" style="background:rgba(239,68,68,0.1);border-color:#ef4444;color:#f87171;">✗</div>
        <div class="team-log-info">
          <span class="team-log-name">错误</span>
        </div>
      </div>
      <div class="team-log-body">
        <div class="team-log-preview" style="white-space:normal;color:#f87171;">${escapeHtml(run.error)}</div>
      </div>
    `;
    container.append(err);
  }

  // Completed
  if (run.completed && !run.running) {
    const done = document.createElement("div");
    done.className = "team-log-card team-log-done";
    done.innerHTML = `
      <div class="team-log-card-bar" style="background:#10b981;"></div>
      <div class="team-log-card-head">
        <div class="team-log-avatar" style="background:rgba(16,185,129,0.1);border-color:#10b981;color:#34d399;">✓</div>
        <div class="team-log-info">
          <span class="team-log-name">工作流已完成</span>
          <span class="team-log-meta">${history.length} 个步骤</span>
        </div>
      </div>
    `;
    container.append(done);
  }
}

function renderConversationTab(team, run, container, deps) {
  const conversation = run.conversation || [];

  // Chat messages area
  const messagesArea = document.createElement("div");
  messagesArea.className = "team-chat-messages";

  if (!conversation.length && !run.running) {
    messagesArea.innerHTML = `
      <div class="team-log-empty">
        <div class="team-log-empty-icon">💬</div>
        <div class="team-log-empty-text">输入任务开始对话，每个身份的回复会显示在这里</div>
      </div>`;
  } else {
    // Show each step's conversation as a chat bubble
  for (const item of [...conversation].reverse()) {
    const step = stepById(team, item.stepId);
    const member = step ? memberById(team, step.memberId) : null;
    const nc = item.stepId === "__team_plan"
      ? { bg: "rgba(99,102,241,0.12)", border: "rgba(129,140,248,0.45)", icon: "#a5b4fc" }
      : nodeColor(step?.nodeType || "work");
    const displayIcon = member?.icon || (item.stepId === "__team_plan" ? "PLN" : "ID");
    const displayName = member?.name || item.memberName || step?.name || "未知";
    const displayStepName = step?.name || item.stepName || "";
    const output = String(item.output || "").trim();
    if (!output) continue;

    const card = document.createElement("div");
    card.className = "team-chat-card";

    // Header: avatar + name + time
    const timeStr = item.timestamp ? new Date(item.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "";
    const prompt = String(item.prompt || "").trim();
    const promptPreview = prompt.length > 120 ? prompt.slice(0, 120) + "..." : prompt;
    card.innerHTML = `
      <div class="team-chat-head">
        <div class="team-chat-avatar" style="background:${nc.bg};border-color:${nc.border};color:${nc.icon};">${escapeHtml(displayIcon)}</div>
        <div class="team-chat-info">
          <span class="team-chat-name">${escapeHtml(displayName)}</span>
          <span class="team-chat-step">${escapeHtml(displayStepName)}</span>
        </div>
        <span class="team-chat-time">${timeStr}</span>
      </div>
      ${promptPreview ? `<div class="team-chat-prompt"><span class="team-chat-prompt-label">任务</span>${escapeHtml(promptPreview)}</div>` : ""}
      <div class="team-chat-body"></div>
    `;

    // Render output as markdown-like content
    const body = card.querySelector(".team-chat-body");
    const lines = output.split("\n");
    let inCode = false;
    let codeBlock = null;
    for (const line of lines) {
      if (line.trim().startsWith("```")) {
        if (inCode && codeBlock) {
          body.append(codeBlock);
          codeBlock = null;
          inCode = false;
        } else {
          inCode = true;
          codeBlock = document.createElement("div");
          codeBlock.className = "team-chat-code";
        }
        continue;
      }
      if (inCode && codeBlock) {
        codeBlock.append(document.createTextNode(line + "\n"));
      } else {
        const p = document.createElement("div");
        p.className = "team-chat-line";
        p.textContent = line;
        body.append(p);
      }
    }
    if (codeBlock) body.append(codeBlock);

    // DECISION badge
    if (item.decision) {
      const badge = document.createElement("span");
      badge.className = `team-log-decision team-log-decision-${item.decision}`;
      badge.textContent = `DECISION: ${item.decision}`;
      card.querySelector(".team-chat-head").append(badge);
    }

    messagesArea.append(card);
  }

  // Currently running step with streaming output
  if (run.running) {
    const activeStep = stepById(team, run.currentStepId);
    if (activeStep) {
      const member = memberById(team, activeStep.memberId);
      const nc = nodeColor(activeStep.nodeType || "work");
      const card = document.createElement("div");
      card.className = "team-chat-card is-executing";
      card.innerHTML = `
        <div class="team-chat-head">
          <div class="team-chat-avatar" style="background:${nc.bg};border-color:${nc.border};color:${nc.icon};">${escapeHtml(member?.icon || "ID")}</div>
          <div class="team-chat-info">
            <span class="team-chat-name">${escapeHtml(member?.name || "未知")}</span>
            <span class="team-chat-step">${escapeHtml(activeStep.name)}</span>
          </div>
          <span class="team-log-status-badge team-log-status-running">执行中</span>
        </div>
        <div class="team-chat-body team-streaming-body">
          <div class="team-chat-typing"><span></span><span></span><span></span></div>
        </div>
      `;
      messagesArea.append(card);

      // Poll streaming buffer and update the body
      const streamBody = card.querySelector(".team-streaming-body");
      const streamInterval = setInterval(() => {
        const buf = getAssistantBuffer();
        if (buf && streamBody) {
          const preview = buf.length > 2000 ? buf.slice(-2000) : buf;
          streamBody.textContent = preview;
          streamBody.scrollTop = streamBody.scrollHeight;
        }
        if (!run.running) clearInterval(streamInterval);
      }, 500);
    }
  }
  }

  container.append(messagesArea);

  // ── Composer (matches main chat style) ──
  const selectedStep = stepById(team, activeStepId(team));
  const selectedMember = selectedStep ? memberById(team, selectedStep.memberId) : null;
  const isSingleNode = selectedMember && !run.running;

  const composerWrap = document.createElement("div");
  composerWrap.className = "team-chat-composer-wrap";
  const composer = document.createElement("form");
  composer.className = "team-chat-composer";

  const targetLabel = isSingleNode
    ? `<div class="team-chat-target">→ ${escapeHtml(selectedMember.name)} <span class="team-chat-target-step">${escapeHtml(selectedStep.name)}</span></div>`
    : "";

  composer.innerHTML = `
    ${targetLabel}
    <div class="team-chat-composer-top">
      <textarea class="team-chat-textarea" rows="1" placeholder="${isSingleNode ? `和 ${escapeHtml(selectedMember.name)} 对话...` : "输入任务交给开始身份..."}" ${run.running ? "disabled" : ""}></textarea>
    </div>
    <div class="team-chat-composer-foot">
      <div class="team-chat-foot-left">
        ${isSingleNode ? `<span class="team-chat-mode-tag">单身份</span>` : `<span class="team-chat-mode-tag">${escapeHtml(teamRunModeLabel(effectiveTeamRunMode(team, run)))}</span>`}
      </div>
      <div class="team-chat-foot-right">
        ${run.running
          ? `<button type="button" class="team-chat-send-btn is-stop" title="停止"><svg viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1.5"/></svg></button>`
          : `<button type="submit" class="team-chat-send-btn is-send" title="运行"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M8.5 2.5L13.5 8L8.5 13.5M13 8H3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></button>`
        }
      </div>
    </div>
  `;
  composerWrap.append(composer);
  container.append(composerWrap);

  const textarea = composer.querySelector(".team-chat-textarea");
  function autoSize() {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(80, textarea.scrollHeight) + "px";
  }
  textarea.addEventListener("input", autoSize);

  composer.addEventListener("submit", e => {
    e.preventDefault();
    const val = textarea.value.trim();
    if (!val) return;

    if (isSingleNode) {
      // Single identity chat
      runSingleIdentityChat(team, selectedStep, selectedMember, val, run, deps);
    } else {
      // Full workflow
      run.task = val;
      save();
      startTeamRun(team, val, deps);
    }
  });

  if (run.running) {
    composer.querySelector(".team-chat-send-btn").addEventListener("click", e => {
      e.preventDefault();
      stopWorkflow(team.id);
    });
  }
}

function renderMindmap(team, deps) {
  const { settingsBody, renderSettingsTab } = deps;
  const run = runState(team.id);
  const activeId = activeStepId(team);
  const canvas = document.createElement("div");
  canvas.className = "team-map-canvas";

  // Zoom wrapper
  let zoom = 1;
  const content = document.createElement("div");
  content.className = "team-map-content";
  content.style.cssText = `transform-origin:0 0;width:${CANVAS_W}px;height:${CANVAS_H}px;position:relative;`;

  const spacer = document.createElement("div");
  spacer.style.cssText = `position:absolute;left:0;top:0;width:${CANVAS_W}px;height:${CANVAS_H}px;pointer-events:none;`;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(CANVAS_W));
  svg.setAttribute("height", String(CANVAS_H));
  svg.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;";
  // Arrow markers for different edge types
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  defs.innerHTML = `
    <marker id="arrow_default" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6" fill="#475569" /></marker>
    <marker id="arrow_pass" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6" fill="#10b981" /></marker>
    <marker id="arrow_approve" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6" fill="#10b981" /></marker>
    <marker id="arrow_yes" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6" fill="#10b981" /></marker>
    <marker id="arrow_revise" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6" fill="#ef4444" /></marker>
    <marker id="arrow_reject" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6" fill="#ef4444" /></marker>
    <marker id="arrow_no" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6" fill="#ef4444" /></marker>
  `;
  svg.append(defs);

  // Edge click to edit, right-click to delete
  svg.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-edge-id]");
    if (!target) return;
    event.stopPropagation();
    const edgeId = target.dataset.edgeId;
    const edge = workflowEdges(team).find(e => e.id === edgeId);
    if (!edge) return;
    const fromStep = stepById(team, edge.from);
    const toStep = stepById(team, edge.to);
    const result = await showModal("编辑交接线", [
      { key: "condition", label: "条件", type: "select", value: edge.condition || "default", options: conditionOptions(edge.condition) },
      { key: "label", label: "说明", value: edge.label || "", placeholder: "例如：测试不满意返工" },
    ]);
    if (!result) return;
    const edges = workflowEdges(team).map(e => e.id === edgeId ? { ...e, condition: result.condition || "default", label: result.label || "" } : e);
    await saveGraph(team, { workflowEdges: edges }, deps.renderSettingsTab);
  });
  svg.addEventListener("contextmenu", async (event) => {
    const target = event.target.closest("[data-edge-id]");
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    const edgeId = target.dataset.edgeId;
    const edge = workflowEdges(team).find(e => e.id === edgeId);
    if (!edge) return;
    const fromStep = stepById(team, edge.from);
    const toStep = stepById(team, edge.to);
    if (!await showConfirm("删除连线", `删除从「${fromStep?.name || "?"}」到「${toStep?.name || "?"}」的连线？`)) return;
    await deleteEdge(team, edge, deps.renderSettingsTab);
  });

  content.append(spacer, svg);
  canvas.append(content);

  // Zoom controls
  const zoomBar = document.createElement("div");
  zoomBar.className = "team-zoom-bar";
  const zoomLabel = document.createElement("span");
  zoomLabel.className = "team-zoom-label";
  zoomLabel.textContent = "100%";
  function applyZoom() {
    content.style.transform = `scale(${zoom})`;
    content.style.width = `${CANVAS_W * zoom}px`;
    content.style.height = `${CANVAS_H * zoom}px`;
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }
  const zoomIn = document.createElement("button");
  zoomIn.className = "team-zoom-btn";
  zoomIn.textContent = "+";
  zoomIn.title = "放大";
  zoomIn.addEventListener("click", () => { zoom = Math.min(2, zoom + 0.15); applyZoom(); });
  const zoomOut = document.createElement("button");
  zoomOut.className = "team-zoom-btn";
  zoomOut.textContent = "−";
  zoomOut.title = "缩小";
  zoomOut.addEventListener("click", () => { zoom = Math.max(0.3, zoom - 0.15); applyZoom(); });
  const zoomReset = document.createElement("button");
  zoomReset.className = "team-zoom-btn";
  zoomReset.textContent = "⊙";
  zoomReset.title = "重置";
  zoomReset.addEventListener("click", () => { zoom = 1; applyZoom(); });
  zoomBar.append(zoomOut, zoomLabel, zoomIn, zoomReset);
  canvas.append(zoomBar);

  // Scroll wheel zoom
  canvas.addEventListener("wheel", e => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      zoom = Math.min(2, Math.max(0.3, zoom + delta));
      applyZoom();
    }
  }, { passive: false });

  canvas.addEventListener("dragover", event => {
    if (event.dataTransfer?.types?.includes("text/team-node-type") || event.dataTransfer?.types?.includes("text/team-member-id")) event.preventDefault();
  });
  canvas.addEventListener("drop", event => {
    const type = event.dataTransfer?.getData("text/team-node-type") || event.dataTransfer?.getData("text/plain");
    const memberId = event.dataTransfer?.getData("text/team-member-id");
    if (!type && !memberId) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const rawX = event.clientX - rect.left + canvas.scrollLeft;
    const rawY = event.clientY - rect.top + canvas.scrollTop;
    const position = { x: Math.max(20, rawX / zoom), y: Math.max(20, rawY / zoom) };
    if (memberId) addNodeFromMember(team, memberId, position, renderSettingsTab);
    else addNodeFromComponent(team, type, position, renderSettingsTab);
  });
  canvas.addEventListener("pointerdown", event => {
    if (event.button !== 0 || !canPanTeamCanvasTarget(event.target, canvas)) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const originLeft = canvas.scrollLeft;
    const originTop = canvas.scrollTop;
    canvas.classList.add("is-panning");
    const onMove = moveEvent => {
      canvas.scrollLeft = originLeft - (moveEvent.clientX - startX);
      canvas.scrollTop = originTop - (moveEvent.clientY - startY);
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      canvas.classList.remove("is-panning");
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });
  settingsBody.append(canvas);

  // Minimap
  const MINIMAP_W = 150, MINIMAP_H = 90;
  const minimap = document.createElement("canvas");
  minimap.width = MINIMAP_W;
  minimap.height = MINIMAP_H;
  minimap.className = "team-minimap";
  minimap.style.cssText = `position:absolute;bottom:12px;right:12px;width:${MINIMAP_W}px;height:${MINIMAP_H}px;border:1px solid rgba(255,255,255,0.1);border-radius:6px;background:rgba(15,18,24,0.85);z-index:10;cursor:pointer;`;
  canvas.style.position = "relative";
  canvas.append(minimap);

  const hasCanvasCtx = typeof minimap.getContext === "function";
  function drawMinimap() {
    if (!hasCanvasCtx) return;
    const ctx = minimap.getContext("2d");
    ctx.clearRect(0, 0, MINIMAP_W, MINIMAP_H);
    const scaleX = MINIMAP_W / CANVAS_W;
    const scaleY = MINIMAP_H / CANVAS_H;
    // Draw nodes as small rectangles
    for (const step of team.workflow) {
      const x = (step.x || 80) * scaleX;
      const y = (step.y || 80) * scaleY;
      const w = NODE_W * scaleX;
      const h = NODE_H * scaleY;
      const nc = nodeColor(step.nodeType || "work");
      ctx.fillStyle = nc.bar || "#475569";
      ctx.fillRect(x, y, Math.max(w, 3), Math.max(h, 2));
    }
    // Draw viewport rectangle
    const scrollLeft = canvas.scrollLeft || 0;
    const scrollTop = canvas.scrollTop || 0;
    const viewW = canvas.clientWidth;
    const viewH = canvas.clientHeight;
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 1;
    ctx.strokeRect(scrollLeft * scaleX, scrollTop * scaleY, viewW * scaleX, viewH * scaleY);
  }
  drawMinimap();

  // Click minimap to navigate
  minimap.addEventListener("click", (event) => {
    const rect = minimap.getBoundingClientRect();
    const clickX = (event.clientX - rect.left) / MINIMAP_W;
    const clickY = (event.clientY - rect.top) / MINIMAP_H;
    canvas.scrollLeft = clickX * CANVAS_W - canvas.clientWidth / 2;
    canvas.scrollTop = clickY * CANVAS_H - canvas.clientHeight / 2;
    drawMinimap();
  });

  // Update minimap on scroll
  canvas.addEventListener("scroll", drawMinimap);

  function edgeStyle(condition) {
    const styles = {
      default: { color: "#475569", dash: "", width: 1.5 },
      pass: { color: "#10b981", dash: "", width: 1.5 },
      approve: { color: "#10b981", dash: "", width: 1.5 },
      yes: { color: "#10b981", dash: "", width: 1.5 },
      revise: { color: "#ef4444", dash: "6,3", width: 1.5 },
      reject: { color: "#ef4444", dash: "6,3", width: 1.5 },
      no: { color: "#ef4444", dash: "6,3", width: 1.5 },
    };
    return styles[condition] || styles.default;
  }

  function drawEdges() {
    const edges = workflowEdges(team);
    const layouts = layoutWorkflowEdgesForRender(team, edges);
    let html = defs.outerHTML;
    // Draw flow animation dots for running edges
    const activeEdges = [];
    if (run.running && run.currentStepId) {
      for (const edge of edges) {
        if (edge.to === run.currentStepId || edge.from === run.currentStepId) {
          activeEdges.push(edge);
        }
      }
    }
    for (const layout of layouts) {
      const { edge, x1, y1, x2, y2, cp, offsetX, offsetY, labelX, labelY } = layout;
      const d = `M ${x1} ${y1} C ${x1 + cp + offsetX} ${y1 + offsetY}, ${x2 - cp + offsetX} ${y2 + offsetY}, ${x2} ${y2}`;
      const es = edgeStyle(edge.condition);
      const isActive = activeEdges.some(e => e.id === edge.id);
      const strokeOpacity = isActive ? "1" : "0.6";
      const markerId = `arrow_${edge.condition || "default"}`;
      html += `<path d="${d}" fill="none" stroke="${es.color}" stroke-width="${es.width}"${es.dash ? ` stroke-dasharray="${es.dash}"` : ""} marker-end="url(#${markerId})" opacity="${strokeOpacity}" data-edge-id="${edge.id}" style="pointer-events:auto;cursor:pointer;stroke-linecap:round;"/>`;
      // Label
      const iconPrefix = (edge.condition === "pass" || edge.condition === "approve" || edge.condition === "yes") ? "✓ " : (edge.condition === "revise" || edge.condition === "reject" || edge.condition === "no") ? "✗ " : "";
      const label = iconPrefix + conditionLabel(edge.condition);
      if (label !== "默认") {
        const lx = labelX;
        const ly = labelY;
        const labelBg = edge.condition === "revise" || edge.condition === "reject" || edge.condition === "no" ? "rgba(239,68,68,0.12)" : edge.condition === "pass" || edge.condition === "approve" || edge.condition === "yes" ? "rgba(16,185,129,0.12)" : "rgba(100,116,139,0.12)";
        const labelColor = es.color;
        const labelWidth = Math.max(36, label.length * 12 + 14);
        html += `<rect x="${lx - labelWidth / 2}" y="${ly - 9}" width="${labelWidth}" height="18" rx="4" fill="${labelBg}" stroke="rgba(15,18,24,0.92)" stroke-width="2" data-edge-id="${edge.id}" style="pointer-events:auto;cursor:pointer;" />`;
        html += `<text x="${lx}" y="${ly + 4}" font-size="10" fill="${labelColor}" text-anchor="middle" font-weight="600" data-edge-id="${edge.id}" style="pointer-events:auto;cursor:pointer;">${escapeHtml(label)}</text>`;
      }
      // Flow dots for active edges
      if (isActive) {
        html += `<circle r="3" fill="${es.color}" opacity="0.9"><animateMotion dur="1.5s" repeatCount="indefinite" path="${d}" /></circle>`;
        html += `<circle r="2" fill="${es.color}" opacity="0.5"><animateMotion dur="1.5s" repeatCount="indefinite" path="${d}" begin="0.3s" /></circle>`;
      }
    }
    svg.innerHTML = html;
  }

  for (const step of team.workflow) {
    const member = memberById(team, step.memberId);
    const done = Boolean(run.outputs?.[step.id]);
    const hasError = (run.stepHistory || []).some(h => h.stepId === step.id && h.status === "error");
    const isCurrentRunning = run.running && step.id === run.currentStepId;
    const isActive = step.id === activeId;
    const nc = nodeColor(step.nodeType || "work");
    const node = document.createElement("div");
    node.className = `team-node-card${isCurrentRunning ? " is-running" : ""}${done ? " is-done" : ""}${hasError ? " is-error" : ""}${isActive ? " is-selected" : ""}`;
    node.dataset.stepId = step.id;
    node.style.cssText = `position:absolute;left:${step.x || 80}px;top:${step.y || 80}px;width:${NODE_W}px;min-height:${NODE_H}px;`;
    const statusClass = isCurrentRunning ? "is-running" : hasError ? "is-error" : done ? "is-done" : "is-idle";
    const statusText = isCurrentRunning ? "执行中" : hasError ? "失败" : done ? "已完成" : "等待中";
    const providerLabel = member?.providerId ? data.providers.find(p => p.id === member.providerId)?.model || "" : "";
    const typeName = nodeTypeOptions(step.nodeType || "work").find(item => item.value === (step.nodeType || "work"))?.label || "执行";
    const isEntry = step.id === team.entryStepId;
    const isFinal = step.id === team.finalStepId;
    const badgeHtml = isEntry ? '<span class="team-node-badge team-node-badge-entry">入口</span>' : isFinal ? '<span class="team-node-badge team-node-badge-final">输出</span>' : "";
    const instructPreview = (step.instruction || typeName).slice(0, 24);
    node.innerHTML = `
      <div class="team-node-bar" style="background:${nc.bar};"></div>
      <div class="team-node-port team-node-port-in" title="输入"></div>
      <div class="team-node-port team-node-port-out" title="输出"></div>
      <div class="team-node-body">
        <div class="team-node-head">
          <div class="team-node-avatar" style="background:${nc.bg};border-color:${nc.border};color:${nc.icon};">${escapeHtml(member?.icon || "ID")}</div>
          <div class="team-node-info">
            <div class="team-node-name">${escapeHtml(step.name)}${badgeHtml}</div>
            <div class="team-node-meta"><span class="team-node-status ${statusClass}"></span>${escapeHtml(statusText)}${providerLabel ? ` · ${escapeHtml(providerLabel)}` : ""}</div>
          </div>
        </div>
        <div class="team-node-preview">${escapeHtml(instructPreview)}</div>
      </div>
    `;
    // Click to select
    node.addEventListener("click", event => {
      if (event.target.closest("button") || event.target.closest(".team-node-port")) return;
      if (!run.running) {
        run.currentStepId = step.id;
        run.updatedAt = Date.now();
        save();
      }
      renderSettingsTab();
    });
    // Port click: start/end connection (also supports drag-to-connect)
    node.querySelector(".team-node-port-in")?.addEventListener("click", event => {
      event.stopPropagation();
      if (state.teamConnectFrom) {
        const fromId = state.teamConnectFrom;
        state.teamConnectFrom = "";
        save();
        connectNodes(team, fromId, step.id, deps.renderSettingsTab);
      }
    });
    node.querySelector(".team-node-port-out")?.addEventListener("pointerdown", event => {
      event.stopPropagation();
      event.preventDefault();
      // Start drag-to-connect
      const fromStep = step;
      const fromX = (fromStep.x || 80) + NODE_W;
      const fromY = (fromStep.y || 80) + NODE_H / 2;
      // Create temporary drag line
      let dragLine = svg.querySelector(".team-drag-line");
      if (!dragLine) {
        dragLine = document.createElementNS("http://www.w3.org/2000/svg", "path");
        dragLine.classList.add("team-drag-line");
        dragLine.setAttribute("fill", "none");
        dragLine.setAttribute("stroke", "#3b82f6");
        dragLine.setAttribute("stroke-width", "2");
        dragLine.setAttribute("stroke-dasharray", "6,3");
        dragLine.setAttribute("opacity", "0.8");
        dragLine.style.pointerEvents = "none";
        svg.appendChild(dragLine);
      }
      const onMove = moveEvent => {
        const rect = canvas.getBoundingClientRect();
        const toX = (moveEvent.clientX - rect.left + canvas.scrollLeft) / zoom;
        const toY = (moveEvent.clientY - rect.top + canvas.scrollTop) / zoom;
        const cp = Math.max(50, Math.abs(toX - fromX) * 0.5);
        dragLine.setAttribute("d", `M ${fromX} ${fromY} C ${fromX + cp} ${fromY}, ${toX - cp} ${toY}, ${toX} ${toY}`);
      };
      const onUp = async upEvent => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        dragLine.remove();
        // Check if we're over an input port
        const target = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
        const targetPort = target?.closest(".team-node-port-in");
        const targetNode = target?.closest(".team-node-card");
        if (targetPort && targetNode) {
          const toStepId = targetNode.dataset.stepId;
          if (toStepId && toStepId !== fromStep.id) {
            await connectNodes(team, fromStep.id, toStepId, deps.renderSettingsTab);
          }
        }
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
    // Right-click context
    node.addEventListener("contextmenu", event => {
      event.preventDefault();
      const fromId = state.teamConnectFrom;
      if (fromId && fromId !== step.id) {
        state.teamConnectFrom = "";
        save();
        connectNodes(team, fromId, step.id, renderSettingsTab);
      }
    });
    // Drag to move
    node.addEventListener("pointerdown", event => {
      if (event.target.closest("button") || event.target.closest(".team-node-port")) return;
      const startX = event.clientX;
      const startY = event.clientY;
      const originX = step.x || 0;
      const originY = step.y || 0;
      node.style.cursor = "grabbing";
      const onMove = moveEvent => {
        step.x = Math.max(20, originX + moveEvent.clientX - startX);
        step.y = Math.max(20, originY + moveEvent.clientY - startY);
        node.style.left = `${step.x}px`;
        node.style.top = `${step.y}px`;
        drawEdges();
      };
      const onUp = async () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        node.style.cursor = "grab";
        await safeBridge("updateTeamStep", null, team.id, step.id, { x: step.x, y: step.y });
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
    content.append(node);
  }
  drawEdges();

  // Keyboard shortcuts on canvas
  canvas.setAttribute("tabindex", "0");
  canvas.addEventListener("keydown", event => {
    const selStep = stepById(team, activeStepId(team));
    if (event.key === "Delete" || event.key === "Backspace") {
      if (selStep) {
        event.preventDefault();
        // Shake animation before delete
        const el = canvas.querySelector(".team-node-card.is-selected");
        if (el) {
          el.classList.add("is-deleting");
          setTimeout(() => deleteNodeDlg(team, selStep, renderSettingsTab), 200);
        } else {
          deleteNodeDlg(team, selStep, renderSettingsTab);
        }
      }
    }
    if (event.key === "Escape") {
      state.teamConnectFrom = "";
      run.currentStepId = "";
      save();
      renderSettingsTab();
    }
    if (event.key === "r" || event.key === "R") {
      if (!event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        if (run.running) { stopWorkflow(team.id); }
        else {
          if (run.task?.trim()) startTeamRun(team, run.task, deps);
        }
      }
    }
  });
}

function makeCollapsible(title, contentFn, defaultOpen = true) {
  const card = document.createElement("div");
  card.className = "scard";
  const head = document.createElement("div");
  head.className = `scard-head team-collapsible-head${defaultOpen ? " is-open" : ""}`;
  head.innerHTML = `<span class="scard-title">${escapeHtml(title)}</span><span class="team-collapse-icon">▸</span>`;
  const body = document.createElement("div");
  body.className = "team-collapsible-body";
  body.style.display = defaultOpen ? "" : "none";
  contentFn(body);
  head.addEventListener("click", () => {
    const open = body.style.display === "none";
    body.style.display = open ? "" : "none";
    head.classList.toggle("is-open", open);
  });
  card.append(head, body);
  return card;
}


function renderTeamDetail(team, deps) {
  const { settingsBody, renderSettingsTab } = deps;
  const run = runState(team.id);
  const workbench = document.createElement("div");
  workbench.className = "team-workbench";

  // ── Left sidebar (collapsible) ──
  const sidebar = document.createElement("div");
  sidebar.className = "team-sidebar";
  const toggleBtn = document.createElement("button");
  toggleBtn.className = "team-sidebar-toggle";
  toggleBtn.textContent = "☰";
  toggleBtn.title = "展开/折叠";
  const sidebarItems = document.createElement("div");
  sidebarItems.className = "team-sidebar-items";
  sidebar.append(toggleBtn, sidebarItems);

  // Sidebar toggle
  toggleBtn.addEventListener("click", () => {
    sidebar.classList.toggle("is-expanded");
  });

  // Populate sidebar with collapsible sections
  function makeSidebarSection(title, items, defaultOpen = true) {
    const sec = document.createElement("div");
    sec.className = "team-sidebar-section";
    const head = document.createElement("div");
    head.className = `team-sidebar-head${defaultOpen ? " is-open" : ""}`;
    head.innerHTML = `<span class="team-sidebar-label">${escapeHtml(title)}</span><span class="team-sidebar-arrow">▸</span>`;
    const body = document.createElement("div");
    body.className = "team-sidebar-body";
    body.style.display = defaultOpen ? "" : "none";
    for (const fn of items) fn(body);
    head.addEventListener("click", () => {
      const open = body.style.display === "none";
      body.style.display = open ? "" : "none";
      head.classList.toggle("is-open", open);
    });
    sec.append(head, body);
    return sec;
  }

  sidebarItems.append(makeSidebarSection("身份", [body => {
    for (const member of team.members) {
      const item = document.createElement("div");
      item.className = "team-sidebar-item";
      item.draggable = true;
      item.innerHTML = `<div class="team-sidebar-icon" style="background:var(--td-bg-color-container-active);color:var(--td-text-color-secondary);">${escapeHtml(member.icon || "ID")}</div><span class="team-sidebar-label">${escapeHtml(member.name)}</span>`;
      item.addEventListener("click", () => addNodeFromMember(team, member.id, null, renderSettingsTab));
      item.addEventListener("dragstart", e => {
        e.dataTransfer?.setData("text/team-member-id", member.id);
        e.dataTransfer?.setData("text/plain", member.id);
      });
      body.append(item);
    }
    if (!team.members.length) {
      const empty = document.createElement("div");
      empty.className = "team-sidebar-label";
      empty.style.cssText = "padding:4px 8px;font-size:10px;color:var(--td-text-color-disabled);";
      empty.textContent = "暂无身份";
      body.append(empty);
    }
  }], true));

  sidebarItems.append(makeSidebarSection("组件", [body => {
    for (const comp of COMPONENTS) {
      const item = document.createElement("div");
      item.className = "team-sidebar-item";
      item.draggable = true;
      item.innerHTML = `<div class="team-sidebar-icon" style="background:${comp.color}22;color:${comp.color};">${escapeHtml(comp.icon)}</div><span class="team-sidebar-label">${escapeHtml(comp.name)}</span>`;
      item.addEventListener("click", () => addNodeFromComponent(team, comp.type, null, renderSettingsTab));
      item.addEventListener("dragstart", e => {
        e.dataTransfer?.setData("text/team-node-type", comp.type);
        e.dataTransfer?.setData("text/plain", comp.type);
      });
      body.append(item);
    }
  }], true));

  // ── Center: topbar + canvas + composer ──
  const center = document.createElement("div");
  center.className = "team-panel-center";

  // Top bar (minimal)
  const topbar = document.createElement("div");
  topbar.className = "team-topbar";
  const doneCount = Object.keys(run.outputs || {}).length;
  const totalCount = team.workflow.filter(s => s.nodeType !== "start").length;
  const projectPath = team.cwd || state.cwd || "";
  const shortPath = projectPath ? (projectPath.length > 30 ? "..." + projectPath.slice(-27) : projectPath) : "未设置项目";
  const mode = effectiveTeamRunMode(team, run);
  topbar.innerHTML = `
    <select class="team-topbar-select" id="teamSelect">${data.teams.map(t => `<option value="${t.id}" ${t.id === team.id ? "selected" : ""}>${escapeHtml(t.name)}</option>`).join("")}</select>
    <span class="team-topbar-path" title="${escapeHtml(projectPath)}">📁 ${escapeHtml(shortPath)}</span>
    <span class="team-topbar-mode">${escapeHtml(teamRunModeLabel(mode))}</span>
    <span class="team-topbar-info">${team.members.length} 身份 · ${team.workflow.length} 节点${run.running ? ` · ${doneCount}/${totalCount}` : ""}</span>
    <button class="team-composer-btn" id="editTeamBtn" title="设置">⚙</button>
  `;
  topbar.querySelector("#teamSelect")?.addEventListener("change", e => {
    state.selectedTeamId = e.target.value;
    save();
    renderSettingsTab();
  });
  topbar.querySelector("#editTeamBtn")?.addEventListener("click", () => editTeamDlg(team, renderSettingsTab));
  center.append(topbar);

  // Canvas
  renderMindmap(team, { ...deps, settingsBody: center });

  // Bottom composer
  const composer = document.createElement("div");
  composer.className = "team-composer team-run-control";
  const modeDef = TEAM_RUN_MODES.find(item => item.id === mode) || TEAM_RUN_MODES[0];
  const showGoalFields = mode === "goal";
  const planPreview = teamPlanText(run);
  composer.innerHTML = `
    <div class="team-composer-main">
      <div class="team-mode-tabs" role="tablist">
        ${TEAM_RUN_MODES.map(item => `<button type="button" class="team-mode-tab${item.id === mode ? " is-active" : ""}" data-mode="${item.id}" ${run.running ? "disabled" : ""}>${escapeHtml(item.label)}</button>`).join("")}
      </div>
      <input class="team-composer-input" id="teamTaskInput" placeholder="${escapeHtml(modeDef.placeholder)}" value="${escapeHtml(run.task || "")}">
      ${showGoalFields ? `
        <div class="team-goal-grid">
          <input class="team-composer-input" id="teamGoalInput" placeholder="目标" value="${escapeHtml(teamGoalText(team, run))}">
          <input class="team-composer-input" id="teamCriteriaInput" placeholder="验收标准" value="${escapeHtml(teamSuccessCriteriaText(team, run))}">
        </div>
      ` : ""}
      ${mode === "plan" && planPreview ? `
        <div class="team-plan-inline">
          <span>${escapeHtml(summarizeText(planPreview, 160))}</span>
          <button type="button" class="team-mini-btn" id="acceptPlanRunBtn">采用并执行</button>
        </div>
      ` : ""}
    </div>
    <div class="team-composer-actions">
      <button class="team-composer-btn" id="resetRunBtn" title="清空">↺</button>
      ${run.running
        ? `<button class="team-run-btn is-stop" id="stopWorkflowBtn" title="停止">■</button>`
        : run.paused
          ? `<button class="team-run-btn is-retry" id="retryStepBtn" title="重试失败步骤">↻</button>`
          : `<button class="team-run-btn" id="startFlowBtn" title="${mode === "plan" ? "生成计划" : "运行"}">▶</button>`
      }
    </div>
  `;
  composer.querySelectorAll("[data-mode]").forEach(btn => {
    btn.addEventListener("click", () => {
      run.mode = btn.dataset.mode;
      run.updatedAt = Date.now();
      save();
      renderSettingsTab();
    });
  });
  composer.querySelector("#teamTaskInput")?.addEventListener("input", e => {
    run.task = e.target.value || "";
    run.updatedAt = Date.now();
    save();
  });
  composer.querySelector("#teamGoalInput")?.addEventListener("input", e => {
    run.goal = e.target.value || "";
    run.updatedAt = Date.now();
    save();
  });
  composer.querySelector("#teamCriteriaInput")?.addEventListener("input", e => {
    run.successCriteria = e.target.value || "";
    run.updatedAt = Date.now();
    save();
  });
  composer.querySelector("#acceptPlanRunBtn")?.addEventListener("click", () => acceptPlanAndRun(team, deps));
  if (run.running) {
    composer.querySelector("#stopWorkflowBtn")?.addEventListener("click", () => stopWorkflow(team.id));
  } else if (run.paused) {
    composer.querySelector("#retryStepBtn")?.addEventListener("click", () => retryStep(team, deps));
    composer.querySelector("#resetRunBtn")?.addEventListener("click", () => resetRun(team, renderSettingsTab));
  } else {
    composer.querySelector("#startFlowBtn")?.addEventListener("click", () => {
      startTeamRun(team, run.task, deps);
    });
    composer.querySelector("#resetRunBtn")?.addEventListener("click", () => resetRun(team, renderSettingsTab));
  }
  center.append(composer);

  // ── Right panel ──
  const right = document.createElement("div");
  right.className = "team-panel-right";
  renderRightPanel(team, { ...deps, settingsBody: right });

  workbench.append(sidebar, center, right);
  settingsBody.append(workbench);
}

export function renderTeamsSettings(deps) {
  const { settingsBody } = deps;
  if (!data.teams.length) {
    renderTeamList(deps);
    const empty = document.createElement("div");
    empty.className = "scard";
    empty.innerHTML = `
      <div class="slist-name">还没有 Team 工作流</div>
      <div class="slist-sub" style="white-space:normal;">Teams 是由用户绘制的身份脑图：先定义身份，再把身份节点连成问题交接流。第一次体验建议从轻量代码审查模板开始。</div>
      <div class="scard-actions" style="margin-top:10px;">
        <button class="st-btn t-btn--primary t-btn--sm" id="emptyReviewTemplateTeamBtn" type="button">创建代码审查模板</button>
        <button class="st-btn t-btn--primary t-btn--sm" id="emptyTemplateTeamBtn" type="button">创建 PM-Dev-QA 模板</button>
        <button class="st-btn t-btn--link" id="emptyCreateTeamBtn" type="button">空白 Team</button>
      </div>
    `;
    settingsBody.append(empty);
    empty.querySelector("#emptyReviewTemplateTeamBtn").addEventListener("click", () => createCodeReviewTemplate(deps.renderSettingsTab));
    empty.querySelector("#emptyTemplateTeamBtn").addEventListener("click", () => createPmDevQaTemplate(deps.renderSettingsTab));
    empty.querySelector("#emptyCreateTeamBtn").addEventListener("click", () => createTeamDlg(deps.renderSettingsTab));
    return;
  }

  if (!state.selectedTeamId || !data.teams.some(team => team.id === state.selectedTeamId)) {
    state.selectedTeamId = data.teams[0].id;
    save();
  }

  const team = selectedTeam();
  if (team) renderTeamDetail(team, deps);
}
