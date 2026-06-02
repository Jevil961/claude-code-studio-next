import { data, save, state } from "../state.js";
import { safeBridge } from "../bridge.js";
import { toast } from "../helpers.js";
import { showConfirm, showModal } from "../modal.js";
import { escapeHtml } from "../../markdown.js";
import { loadIdentities, loadProviders, loadTeams } from "../data-loader.js";

const NODE_W = 190;
const NODE_H = 96;
const CANVAS_W = 1800;
const CANVAS_H = 1100;
const COMPONENTS = [
  { type: "start", name: "开始", icon: "S", instruction: "接收右侧任务输入，并交给第一位处理身份。" },
  { type: "intake", name: "身份处理", icon: "ID", instruction: "接收上游输入，按身份规则处理后交接给下一个节点。" },
  { type: "work", name: "执行任务", icon: "WK", instruction: "根据上游要求完成执行、修改或实现，并输出交接说明。" },
  { type: "review", name: "测试判断", icon: "QA", instruction: "检查上游结果。满意输出 DECISION: pass；不满意输出 DECISION: revise。" },
  { type: "approval", name: "审核判断", icon: "OK", instruction: "审核结果是否可交付。通过输出 DECISION: approve；不通过输出 DECISION: reject。" },
  { type: "final", name: "输出结果", icon: "OUT", instruction: "形成给用户的最终结果或交付摘要。" },
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
  const match = String(text || "").match(/DECISION\s*[:：]\s*(yes|no|pass|revise|approve|reject|default)/i);
  return match ? match[1].toLowerCase() : "";
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

function runState(teamId) {
  state.teamRuns ||= {};
  state.teamRuns[teamId] ||= { task: "", currentStepId: "", outputs: {}, completed: false, updatedAt: Date.now() };
  return state.teamRuns[teamId];
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
  await Promise.allSettled([loadTeams(), loadProviders(), loadIdentities()]);
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
  if (member?.permissionMode) deps.setPerm?.(member.permissionMode);
  deps.updateFooter?.();
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
  run.currentStepId = team.entryStepId || team.workflow[0]?.id || "";
  run.outputs = {};
  run.completed = false;
  run.updatedAt = Date.now();
  save();
  renderSettingsTab();
}

async function createTeamDlg(renderSettingsTab) {
  const result = await showModal("创建 Team 脑图", [
    { key: "name", label: "名称", value: "WorkBuddy Team" },
    { key: "description", label: "描述", value: "", type: "textarea" },
    { key: "rules", label: "团队规则", value: "", type: "textarea", placeholder: "所有身份共同遵守的规则、交接标准、最终输出标准" },
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
    rules: [
      "所有身份必须只处理自己职责内的事情。",
      "交接给下一身份前，要给出清楚的输入、已完成内容和剩余风险。",
      "评审类身份必须在最后一行输出 DECISION: pass 或 DECISION: revise。",
      "审核类身份必须在最后一行输出 DECISION: approve 或 DECISION: reject。",
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
    rules: "先复述目标、补齐约束、拆出验收标准。最终审核时只关注是否满足用户问题。",
    permissionMode: "plan",
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
    permissionMode: "plan",
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
    instruction: "接收用户原始问题，不要求用户懂怎么分配。把问题转成清晰需求、范围、约束和验收标准，然后交给开发。",
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

async function editTeamDlg(team, renderSettingsTab) {
  const result = await showModal("编辑 Team", [
    { key: "name", label: "名称", value: team.name || "" },
    { key: "description", label: "描述", value: team.description || "", type: "textarea" },
    { key: "rules", label: "团队规则", value: team.rules || "", type: "textarea" },
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

function renderTeamList({ settingsBody, renderSettingsTab }) {
  const wrap = document.createElement("div");
  wrap.className = "scard";
  wrap.innerHTML = `<div class="scard-head"><span class="scard-title">Teams</span><div class="scard-actions"><button class="st-btn t-btn--link" id="templateTeamBtn">PM-Dev-QA 模板</button><button class="st-btn t-btn--primary t-btn--sm" id="createTeamBtn">创建 Team</button></div></div>`;
  settingsBody.append(wrap);
  wrap.querySelector("#createTeamBtn").addEventListener("click", () => createTeamDlg(renderSettingsTab));
  wrap.querySelector("#templateTeamBtn").addEventListener("click", () => createPmDevQaTemplate(renderSettingsTab));

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

function renderComponentPalette(team, deps) {
  const { settingsBody, renderSettingsTab } = deps;
  const card = document.createElement("div");
  card.className = "scard";
  card.innerHTML = `
    <div class="scard-head"><span class="scard-title">组件</span></div>
    <div class="slist-sub" style="white-space:normal;margin-bottom:8px;">点击组件添加到画布，或拖到中间画布的具体位置。</div>
    <div class="team-component-grid">
      ${COMPONENTS.map(item => `
        <button class="team-component" draggable="true" data-type="${item.type}" type="button">
          <b>${escapeHtml(item.icon)} ${escapeHtml(item.name)}</b>
          <span>${escapeHtml(item.instruction)}</span>
        </button>
      `).join("")}
    </div>
  `;
  for (const btn of card.querySelectorAll(".team-component")) {
    btn.addEventListener("click", () => addNodeFromComponent(team, btn.dataset.type, null, renderSettingsTab));
    btn.addEventListener("dragstart", event => {
      event.dataTransfer?.setData("text/team-node-type", btn.dataset.type);
      event.dataTransfer?.setData("text/plain", btn.dataset.type);
    });
  }
  settingsBody.append(card);
}

function renderHeader(team, deps) {
  const { settingsBody, renderSettingsTab } = deps;
  const run = runState(team.id);
  const current = stepById(team, activeStepId(team));
  const header = document.createElement("div");
  header.className = "scard";
  header.innerHTML = `
    <div class="scard-head">
      <span class="scard-title">运行任务</span>
      <div class="scard-actions"><button class="st-btn t-btn--link" id="editTeamBtn">编辑 Team</button></div>
    </div>
    <div class="team-run-composer">
      <textarea id="teamTaskInput" placeholder="输入任务，然后从 Start 节点运行...">${escapeHtml(run.task || "")}</textarea>
      <div class="team-run-actions">
        <span class="slist-sub" style="white-space:normal;">${escapeHtml(current?.name || "未选择节点")}${run.completed ? " · 已完成" : ""}</span>
        <div class="scard-actions">
          <button class="st-btn t-btn--link" id="resetRunBtn" type="button">清空</button>
          <button class="st-btn t-btn--link" id="acceptOutputBtn" type="button">采纳并交接</button>
          <button class="st-btn t-btn--link" id="runCurrentBtn" type="button">运行当前</button>
          <button class="st-btn t-btn--primary t-btn--sm" id="startFlowBtn" type="button">从开始运行</button>
        </div>
      </div>
    </div>
    <div class="slist-sub" style="margin-top:8px;white-space:normal;">当前节点：${escapeHtml(current?.name || "未选择")} ${run.completed ? "· 已完成" : ""}</div>
    <div class="slist-sub" style="margin-top:4px;white-space:normal;">${escapeHtml(team.description || "左侧拖组件，中间连线，右侧输入任务并运行。")}</div>
  `;
  settingsBody.append(header);
  header.querySelector("#teamTaskInput").addEventListener("input", event => {
    run.task = event.currentTarget.value || "";
    run.updatedAt = Date.now();
    save();
  });
  header.querySelector("#startFlowBtn").addEventListener("click", () => {
    const entry = stepById(team, team.entryStepId) || team.workflow[0];
    if (!entry) {
      toast("请先在画布添加 Start 或入口节点", "error");
      return;
    }
    run.currentStepId = entry.id;
    run.outputs = {};
    run.completed = false;
    run.updatedAt = Date.now();
    save();
    prepareNode(team, entry, deps);
  });
  header.querySelector("#runCurrentBtn").addEventListener("click", () => current ? prepareNode(team, current, deps) : toast("请先添加并选择节点", "error"));
  header.querySelector("#acceptOutputBtn").addEventListener("click", () => acceptAndHandoff(team, deps));
  header.querySelector("#resetRunBtn").addEventListener("click", () => resetRun(team, renderSettingsTab));
  header.querySelector("#editTeamBtn").addEventListener("click", () => editTeamDlg(team, renderSettingsTab));
}

function renderNodeInspector(team, deps) {
  const { settingsBody, renderSettingsTab } = deps;
  const step = stepById(team, activeStepId(team));
  const card = document.createElement("div");
  card.className = "scard";
  if (!step) {
    card.innerHTML = `<div class="scard-head"><span class="scard-title">节点配置</span></div><div class="slist-sub">在画布中选择一个节点进行配置。</div>`;
    settingsBody.append(card);
    return;
  }
  card.innerHTML = `
    <div class="scard-head">
      <span class="scard-title">节点配置</span>
      <div class="scard-actions">
        <button class="st-btn t-btn--link" id="markEntryBtn">设为开始</button>
        <button class="st-btn t-btn--link" id="markFinalBtn">设为输出</button>
        <button class="st-btn t-btn--primary t-btn--sm" id="saveNodeConfigBtn">保存</button>
      </div>
    </div>
    <label class="slist-sub" style="display:block;white-space:normal;margin-top:8px;">名称</label>
    <input class="team-config-input" id="nodeNameInput" value="${escapeHtml(step.name || "")}">
    <label class="slist-sub" style="display:block;white-space:normal;margin-top:8px;">组件类型</label>
    <select class="team-config-select" id="nodeTypeSelect">${nodeTypeOptions(step.nodeType || "work").map(option => `<option value="${option.value}" ${option.selected ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select>
    <label class="slist-sub" style="display:block;white-space:normal;margin-top:8px;">身份</label>
    <select class="team-config-select" id="nodeMemberSelect">${memberOptions(team, step.memberId || "").map(option => `<option value="${option.value}" ${option.selected ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select>
    <label class="slist-sub" style="display:block;white-space:normal;margin-top:8px;">任务/处理说明</label>
    <textarea class="team-config-textarea" id="nodeInstructionInput">${escapeHtml(step.instruction || "")}</textarea>
    <label class="slist-sub" style="display:block;white-space:normal;margin-top:8px;">判断/路由说明</label>
    <textarea class="team-config-textarea" id="nodeDecisionInput" placeholder="例如：满意输出 DECISION: pass，不满意输出 DECISION: revise">${escapeHtml(step.decisionInstruction || "")}</textarea>
  `;
  settingsBody.append(card);
  card.querySelector("#markEntryBtn").addEventListener("click", () => markNode(team, step, "entryStepId", renderSettingsTab));
  card.querySelector("#markFinalBtn").addEventListener("click", () => markNode(team, step, "finalStepId", renderSettingsTab));
  card.querySelector("#saveNodeConfigBtn").addEventListener("click", async () => {
    const r = await safeBridge("updateTeamStep", null, team.id, step.id, {
      name: card.querySelector("#nodeNameInput").value,
      nodeType: card.querySelector("#nodeTypeSelect").value,
      memberId: card.querySelector("#nodeMemberSelect").value,
      instruction: card.querySelector("#nodeInstructionInput").value,
      decisionInstruction: card.querySelector("#nodeDecisionInput").value,
    });
    if (r.ok) {
      toast("节点配置已保存", "success");
      await refresh(renderSettingsTab);
    } else toast(r.error || "节点保存失败", "error");
  });
}

function renderMindmap(team, deps) {
  const { settingsBody, renderSettingsTab } = deps;
  const run = runState(team.id);
  const activeId = activeStepId(team);
  const card = document.createElement("div");
  card.className = "scard team-map-card";
  card.innerHTML = `
    <div class="scard-head">
      <span class="scard-title">身份脑图</span>
      <div class="scard-actions">
        <button class="st-btn t-btn--primary t-btn--sm" id="addNodeBtn">添加节点</button>
        <button class="st-btn t-btn--link" id="addMemberBtn">添加身份</button>
      </div>
    </div>
    <div class="slist-sub">拖动节点排布脑图；点“连接”先选来源，再点目标；入口节点接收你的问题，最终节点给你正式输出。</div>
  `;
  const canvas = document.createElement("div");
  canvas.className = "team-map-canvas";
  canvas.style.cssText = "position:relative;height:560px;margin-top:10px;overflow:auto;border:1px solid var(--td-border-level-2-color);background:var(--td-bg-color-container);border-radius:8px;";
  const spacer = document.createElement("div");
  spacer.style.cssText = `position:absolute;left:0;top:0;width:${CANVAS_W}px;height:${CANVAS_H}px;pointer-events:none;`;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(CANVAS_W));
  svg.setAttribute("height", String(CANVAS_H));
  svg.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;";
  canvas.append(spacer, svg);
  canvas.addEventListener("dragover", event => {
    if (event.dataTransfer?.types?.includes("text/team-node-type") || event.dataTransfer?.types?.includes("text/team-member-id")) event.preventDefault();
  });
  canvas.addEventListener("drop", event => {
    const type = event.dataTransfer?.getData("text/team-node-type") || event.dataTransfer?.getData("text/plain");
    const memberId = event.dataTransfer?.getData("text/team-member-id");
    if (!type && !memberId) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const position = {
      x: Math.max(20, event.clientX - rect.left + canvas.scrollLeft),
      y: Math.max(20, event.clientY - rect.top + canvas.scrollTop),
    };
    if (memberId) addNodeFromMember(team, memberId, position, renderSettingsTab);
    else addNodeFromComponent(team, type, position, renderSettingsTab);
  });
  canvas.addEventListener("pointerdown", event => {
    if (event.target !== canvas && event.target !== svg) return;
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
  card.append(canvas);
  settingsBody.append(card);

  card.querySelector("#addNodeBtn").addEventListener("click", () => nodeDlg(team, null, renderSettingsTab));
  card.querySelector("#addMemberBtn").addEventListener("click", () => memberDlg(team, null, renderSettingsTab));

  function drawEdges() {
    svg.innerHTML = workflowEdges(team).map(edge => {
      const from = stepById(team, edge.from);
      const to = stepById(team, edge.to);
      if (!from || !to) return "";
      const x1 = (from.x || 0) + NODE_W;
      const y1 = (from.y || 0) + NODE_H / 2;
      const x2 = to.x || 0;
      const y2 = (to.y || 0) + NODE_H / 2;
      const mid = Math.max(40, Math.abs(x2 - x1) / 2);
      const d = `M ${x1} ${y1} C ${x1 + mid} ${y1}, ${x2 - mid} ${y2}, ${x2} ${y2}`;
      const labelX = (x1 + x2) / 2;
      const labelY = (y1 + y2) / 2 - 8;
      return `<path d="${d}" fill="none" stroke="var(--td-brand-color)" stroke-width="2"/><circle cx="${x2}" cy="${y2}" r="4" fill="var(--td-brand-color)"/><text x="${labelX}" y="${labelY}" font-size="11" fill="currentColor">${conditionLabel(edge.condition)}</text>`;
    }).join("");
  }

  for (const step of team.workflow) {
    const member = memberById(team, step.memberId);
    const done = Boolean(run.outputs?.[step.id]);
    const node = document.createElement("div");
    node.className = "team-node-card";
    node.style.cssText = `position:absolute;left:${step.x || 80}px;top:${step.y || 80}px;width:${NODE_W}px;min-height:${NODE_H}px;padding:10px;border:1px solid ${step.id === activeId ? "var(--td-brand-color)" : "var(--td-border-level-2-color)"};border-radius:8px;background:var(--td-bg-color-container);box-shadow:var(--td-shadow-1);cursor:grab;z-index:2;`;
    node.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <div class="slist-icon">${escapeHtml(member?.icon || "ID")}</div>
        <div style="min-width:0;">
          <div class="slist-name">${escapeHtml(step.name)}</div>
          <div class="slist-sub">${escapeHtml(memberLabel(team, step.memberId))}</div>
        </div>
      </div>
      <div class="slist-sub" style="margin-top:6px;">${escapeHtml(nodeTypeOptions(step.nodeType || "work").find(item => item.value === (step.nodeType || "work"))?.label || "执行处理")} · ${escapeHtml(step.instruction || "未填写节点指令")}</div>
      <div class="slist-sub" style="margin-top:6px;">${step.id === team.entryStepId ? "入口 " : ""}${step.id === team.finalStepId ? "最终 " : ""}${done ? "已采纳" : "待处理"}</div>
      <div class="slist-actions" style="margin-top:8px;">
        <button class="st-btn t-btn--primary t-btn--sm" data-act="run">运行</button>
        <button class="st-btn t-btn--link" data-act="connect">连接</button>
        <button class="st-btn t-btn--danger t-btn--sm" data-act="delete">删除</button>
      </div>
    `;
    node.querySelector('[data-act="run"]').addEventListener("click", event => { event.stopPropagation(); prepareNode(team, step, deps); });
    node.querySelector('[data-act="connect"]').addEventListener("click", event => {
      event.stopPropagation();
      if (!state.teamConnectFrom) {
        state.teamConnectFrom = step.id;
        save();
        toast(`连接起点：${step.name}。再点目标节点的“连接”。`, "info");
        return;
      }
      const fromId = state.teamConnectFrom;
      state.teamConnectFrom = "";
      save();
      connectNodes(team, fromId, step.id, renderSettingsTab);
    });
    node.querySelector('[data-act="delete"]').addEventListener("click", event => { event.stopPropagation(); deleteNodeDlg(team, step, renderSettingsTab); });
    node.addEventListener("click", () => {
      run.currentStepId = step.id;
      run.updatedAt = Date.now();
      save();
      renderSettingsTab();
    });
    node.addEventListener("pointerdown", event => {
      if (event.target.closest("button")) return;
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
    canvas.append(node);
  }
  drawEdges();
}

function renderMembers(team, deps) {
  const { settingsBody, renderSettingsTab } = deps;
  const card = document.createElement("div");
  card.className = "scard";
  card.innerHTML = `
    <div class="scard-head">
      <span class="scard-title">身份库</span>
      <div class="scard-actions"><button class="st-btn t-btn--primary t-btn--sm" id="addMemberFromLibraryBtn">添加身份</button></div>
    </div>
    <div class="slist-sub" style="white-space:normal;margin-bottom:8px;">拖到画布即可生成绑定身份的处理节点。</div>
    <div class="team-member-palette"></div>
  `;
  settingsBody.append(card);
  card.querySelector("#addMemberFromLibraryBtn").addEventListener("click", () => memberDlg(team, null, renderSettingsTab));
  const list = card.querySelector(".team-member-palette");
  for (const member of team.members) {
    const row = document.createElement("div");
    row.className = "team-member-chip";
    row.draggable = true;
    row.innerHTML = `
      <div class="slist-icon">${escapeHtml(member.icon || "ID")}</div>
      <div class="slist-body">
        <div class="slist-name">${escapeHtml(member.name)}</div>
        <div class="slist-sub">${escapeHtml(member.role || "")}</div>
        <div class="slist-sub">${escapeHtml(providerName(member.providerId))} / ${escapeHtml(identityName(member.identityId))}</div>
      </div>
      <div class="slist-actions">
        <button class="st-btn t-btn--link" data-act="edit">编辑</button>
        <button class="st-btn t-btn--danger t-btn--sm" data-act="delete">删除</button>
      </div>
    `;
    row.addEventListener("click", event => {
      if (event.target.closest("button[data-act]")) return;
      addNodeFromMember(team, member.id, null, renderSettingsTab);
    });
    row.addEventListener("dragstart", event => {
      event.dataTransfer?.setData("text/team-member-id", member.id);
      event.dataTransfer?.setData("text/plain", member.id);
    });
    row.querySelector('[data-act="edit"]').addEventListener("click", event => { event.stopPropagation(); memberDlg(team, member, renderSettingsTab); });
    row.querySelector('[data-act="delete"]').addEventListener("click", event => { event.stopPropagation(); deleteMemberDlg(team, member, renderSettingsTab); });
    list.append(row);
  }
  if (!team.members.length) {
    const empty = document.createElement("div");
    empty.className = "slist-sub";
    empty.style.whiteSpace = "normal";
    empty.textContent = "还没有身份。先添加项目经理、开发、测试等身份，再拖到画布。";
    list.append(empty);
  }
}

function renderEdges(team, deps) {
  const { settingsBody, renderSettingsTab } = deps;
  const card = document.createElement("div");
  card.className = "scard";
  const options = stepOptions(team);
  card.innerHTML = `
    <div class="scard-head"><span class="scard-title">交接线</span></div>
    <div class="team-edge-builder">
      <select class="team-config-select" id="edgeFromSelect">${options.map(option => `<option value="${option.value}">${escapeHtml(option.label)}</option>`).join("")}</select>
      <select class="team-config-select" id="edgeToSelect">${options.map(option => `<option value="${option.value}">${escapeHtml(option.label)}</option>`).join("")}</select>
      <select class="team-config-select" id="edgeConditionSelect">${conditionOptions("default").map(option => `<option value="${option.value}">${escapeHtml(option.label)}</option>`).join("")}</select>
      <input class="team-config-input" id="edgeLabelInput" placeholder="交接说明，例如：测试不满意返工">
      <button class="st-btn t-btn--primary t-btn--sm" id="quickAddEdgeBtn" type="button">添加连线</button>
    </div>
    <div class="slist-sub" style="white-space:normal;margin-top:8px;">条件连线用于循环：例如测试 revise 回开发，pass 到项目经理。</div>
  `;
  settingsBody.append(card);
  card.querySelector("#quickAddEdgeBtn").addEventListener("click", async () => {
    const from = card.querySelector("#edgeFromSelect").value;
    const to = card.querySelector("#edgeToSelect").value;
    const condition = card.querySelector("#edgeConditionSelect").value || "default";
    const label = card.querySelector("#edgeLabelInput").value || "";
    if (!from || !to || from === to) {
      toast("请选择不同的来源和目标节点", "error");
      return;
    }
    const edges = workflowEdges(team);
    if (edges.some(edge => edge.from === from && edge.to === to && edge.condition === condition)) {
      toast("这条连线已存在", "info");
      return;
    }
    await saveGraph(team, { workflowEdges: [...edges, { from, to, condition, label }] }, renderSettingsTab);
  });
  for (const edge of workflowEdges(team)) {
    const row = document.createElement("div");
    row.className = "slist-item team-edge-row";
    row.innerHTML = `
      <div class="slist-icon">→</div>
      <div class="slist-body">
        <div class="slist-name">${escapeHtml(stepById(team, edge.from)?.name || "未知")} → ${escapeHtml(stepById(team, edge.to)?.name || "未知")}</div>
        <div class="slist-sub">${escapeHtml(conditionLabel(edge.condition))}${edge.label ? ` · ${escapeHtml(edge.label)}` : ""}</div>
      </div>
      <div class="slist-actions"><button class="st-btn t-btn--danger t-btn--sm" data-act="delete">删除</button></div>
    `;
    row.querySelector('[data-act="delete"]').addEventListener("click", () => deleteEdge(team, edge, renderSettingsTab));
    settingsBody.append(row);
  }
}

function renderTeamDetail(team, deps) {
  const { settingsBody } = deps;
  const workbench = document.createElement("div");
  workbench.className = "team-workbench";
  const left = document.createElement("div");
  const center = document.createElement("div");
  const right = document.createElement("div");
  left.className = "team-panel";
  center.className = "team-panel";
  right.className = "team-panel";
  workbench.append(left, center, right);
  settingsBody.append(workbench);
  renderTeamList({ ...deps, settingsBody: left });
  renderComponentPalette(team, { ...deps, settingsBody: left });
  renderMembers(team, { ...deps, settingsBody: left });
  renderMindmap(team, { ...deps, settingsBody: center });
  renderHeader(team, { ...deps, settingsBody: right });
  renderNodeInspector(team, { ...deps, settingsBody: right });
  renderEdges(team, { ...deps, settingsBody: right });
}

export function renderTeamsSettings(deps) {
  const { settingsBody } = deps;
  if (!data.teams.length) {
    renderTeamList(deps);
    const empty = document.createElement("div");
    empty.className = "slist-sub";
    empty.style.padding = "10px 2px";
    empty.textContent = "Teams 是由用户绘制的身份脑图：先定义身份，再把身份节点连成问题交接流。";
    settingsBody.append(empty);
    return;
  }

  if (!state.selectedTeamId || !data.teams.some(team => team.id === state.selectedTeamId)) {
    state.selectedTeamId = data.teams[0].id;
    save();
  }

  const team = selectedTeam();
  if (team) renderTeamDetail(team, deps);
}
