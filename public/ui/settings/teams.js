import { data, save, state } from "../state.js";
import { safeBridge } from "../bridge.js";
import { toast } from "../helpers.js";
import { showConfirm, showModal } from "../modal.js";
import { escapeHtml } from "../../markdown.js";
import { loadIdentities, loadProviders, loadTeams } from "../data-loader.js";

const NODE_W = 190;
const NODE_H = 96;

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
  }[condition] || condition;
}

function conditionOptions(value = "default") {
  return ["default", "revise", "pass", "approve", "reject"].map(condition => ({
    value: condition,
    label: conditionLabel(condition),
    selected: condition === value,
  }));
}

function nodeTypeOptions(value = "work") {
  return [
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
  const match = String(text || "").match(/DECISION\s*[:：]\s*(pass|revise|approve|reject|default)/i);
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
  if (step.id === team.finalStepId && ["approve", "pass"].includes(decision)) {
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
  const intake = await safeBridge("createTeamStep", null, teamId, {
    name: "需求澄清",
    nodeType: "intake",
    memberId: pm.data.member.id,
    x: 80,
    y: 150,
    instruction: "接收用户原始问题，不要求用户懂怎么分配。把问题转成清晰需求、范围、约束和验收标准，然后交给开发。",
  });
  const build = await safeBridge("createTeamStep", null, teamId, {
    name: "开发实现",
    nodeType: "work",
    memberId: dev.data.member.id,
    x: 340,
    y: 150,
    instruction: "根据上游需求或测试返工意见完成实现/修改。输出改动点、关键文件、验证方式和仍需测试关注的风险。",
  });
  const test = await safeBridge("createTeamStep", null, teamId, {
    name: "测试验收",
    nodeType: "review",
    memberId: qa.data.member.id,
    x: 600,
    y: 150,
    instruction: "验证开发输出是否满足验收标准。发现问题就给开发可执行返工意见；满意才允许通过。",
    decisionInstruction: "如果仍需开发修改，最后一行输出 DECISION: revise。如果测试满意，最后一行输出 DECISION: pass。",
  });
  const audit = await safeBridge("createTeamStep", null, teamId, {
    name: "项目审核",
    nodeType: "approval",
    memberId: pm.data.member.id,
    x: 860,
    y: 150,
    instruction: "审核测试通过后的结果是否真正解决用户问题。通过则形成给用户的正式交付说明，不通过则给开发返工意见。",
    decisionInstruction: "如果可交付，最后一行输出 DECISION: approve。如果仍需返工，最后一行输出 DECISION: reject。",
  });
  if (!intake.ok || !build.ok || !test.ok || !audit.ok) {
    toast("模板节点创建失败", "error");
    await refresh(renderSettingsTab);
    return;
  }
  await safeBridge("updateTeamWorkflow", null, teamId, {
    entryStepId: intake.data.step.id,
    finalStepId: audit.data.step.id,
    workflowEdges: [
      { from: intake.data.step.id, to: build.data.step.id, condition: "default", label: "需求交给开发" },
      { from: build.data.step.id, to: test.data.step.id, condition: "default", label: "开发完成交给测试" },
      { from: test.data.step.id, to: build.data.step.id, condition: "revise", label: "测试不满意返工" },
      { from: test.data.step.id, to: audit.data.step.id, condition: "pass", label: "测试满意进入项目审核" },
      { from: audit.data.step.id, to: build.data.step.id, condition: "reject", label: "项目审核不通过返工" },
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

function renderHeader(team, deps) {
  const { settingsBody, renderSettingsTab } = deps;
  const run = runState(team.id);
  const current = stepById(team, activeStepId(team));
  const header = document.createElement("div");
  header.className = "scard";
  header.innerHTML = `
    <div class="scard-head">
      <span class="scard-title">${escapeHtml(team.name)}</span>
      <div class="scard-actions">
        <button class="st-btn t-btn--link" id="teamTaskBtn">问题</button>
        <button class="st-btn t-btn--primary t-btn--sm" id="runCurrentBtn">交给当前身份</button>
        <button class="st-btn t-btn--link" id="acceptOutputBtn">采纳并交接</button>
        <button class="st-btn t-btn--link" id="resetRunBtn">重来</button>
        <button class="st-btn t-btn--link" id="editTeamBtn">编辑</button>
      </div>
    </div>
    <div class="slist-sub">${escapeHtml(team.description || "先创建身份，再拖拽节点绘制脑图；连线决定问题如何交接。")}</div>
    <div class="slist-sub" style="margin-top:4px;">当前问题：${escapeHtml(run.task || "未设置")} · 当前身份：${escapeHtml(current?.name || "未选择")} ${run.completed ? "· 已到最终输出" : ""}</div>
  `;
  settingsBody.append(header);
  header.querySelector("#teamTaskBtn").addEventListener("click", async () => {
    const result = await showModal("Team 问题", [{ key: "task", label: "问题", value: run.task || "", type: "textarea" }]);
    if (!result) return;
    run.task = result.task || "";
    run.currentStepId = activeStepId(team);
    run.completed = false;
    run.updatedAt = Date.now();
    save();
    renderSettingsTab();
  });
  header.querySelector("#runCurrentBtn").addEventListener("click", () => current ? prepareNode(team, current, deps) : toast("请先添加并选择节点", "error"));
  header.querySelector("#acceptOutputBtn").addEventListener("click", () => acceptAndHandoff(team, deps));
  header.querySelector("#resetRunBtn").addEventListener("click", () => resetRun(team, renderSettingsTab));
  header.querySelector("#editTeamBtn").addEventListener("click", () => editTeamDlg(team, renderSettingsTab));
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
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "1200");
  svg.setAttribute("height", "760");
  svg.style.cssText = "position:absolute;inset:0;pointer-events:none;";
  canvas.append(svg);
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
        <button class="st-btn t-btn--link" data-act="entry">入口</button>
        <button class="st-btn t-btn--link" data-act="final">最终</button>
        <button class="st-btn t-btn--link" data-act="edit">编辑</button>
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
    node.querySelector('[data-act="entry"]').addEventListener("click", event => { event.stopPropagation(); markNode(team, step, "entryStepId", renderSettingsTab); });
    node.querySelector('[data-act="final"]').addEventListener("click", event => { event.stopPropagation(); markNode(team, step, "finalStepId", renderSettingsTab); });
    node.querySelector('[data-act="edit"]').addEventListener("click", event => { event.stopPropagation(); nodeDlg(team, step, renderSettingsTab); });
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
  const title = document.createElement("div");
  title.style.cssText = "margin:14px 0 6px;font-size:12px;font-weight:700;color:var(--td-text-color-secondary);";
  title.textContent = "身份库";
  settingsBody.append(title);

  for (const member of team.members) {
    const card = document.createElement("div");
    card.className = "slist-item";
    card.innerHTML = `
      <div class="slist-icon">${escapeHtml(member.icon || "ID")}</div>
      <div class="slist-body">
        <div class="slist-name">${escapeHtml(member.name)}</div>
        <div class="slist-sub">${escapeHtml(member.role || "")}</div>
        <div class="slist-sub">${escapeHtml(providerName(member.providerId))} / ${escapeHtml(identityName(member.identityId))} / ${escapeHtml(member.permissionMode || "auto")}</div>
      </div>
      <div class="slist-actions">
        <button class="st-btn t-btn--link" data-act="edit">编辑</button>
        <button class="st-btn t-btn--danger t-btn--sm" data-act="delete">删除</button>
      </div>
    `;
    card.querySelector('[data-act="edit"]').addEventListener("click", () => memberDlg(team, member, renderSettingsTab));
    card.querySelector('[data-act="delete"]').addEventListener("click", () => deleteMemberDlg(team, member, renderSettingsTab));
    settingsBody.append(card);
  }
}

function renderEdges(team, deps) {
  const { settingsBody, renderSettingsTab } = deps;
  const title = document.createElement("div");
  title.style.cssText = "margin:14px 0 6px;font-size:12px;font-weight:700;color:var(--td-text-color-secondary);";
  title.textContent = "交接线";
  settingsBody.append(title);
  for (const edge of workflowEdges(team)) {
    const row = document.createElement("div");
    row.className = "slist-item";
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
  renderMembers(team, { ...deps, settingsBody: left });
  renderMindmap(team, { ...deps, settingsBody: center });
  renderHeader(team, { ...deps, settingsBody: right });
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
