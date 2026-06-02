import { data, save, state } from "../state.js";
import { safeBridge } from "../bridge.js";
import { toast } from "../helpers.js";
import { showConfirm, showModal } from "../modal.js";
import { escapeHtml } from "../../markdown.js";
import { loadIdentities, loadProviders, loadTeams } from "../data-loader.js";

function selectedTeam() {
  return data.teams.find(team => team.id === state.selectedTeamId) || data.teams[0] || null;
}

function memberName(team, memberId) {
  const member = team.members.find(item => item.id === memberId);
  return member ? `${member.icon || "ID"} ${member.name}` : "未分配成员";
}

function providerName(providerId) {
  return data.providers.find(provider => provider.id === providerId)?.name || "默认 Provider";
}

function identityName(identityId) {
  return data.identities.find(identity => identity.id === identityId)?.name || "不绑定身份";
}

function runState(teamId) {
  state.teamRuns ||= {};
  state.teamRuns[teamId] ||= { task: "", outputs: {}, updatedAt: Date.now() };
  return state.teamRuns[teamId];
}

function providerOptions(value = "") {
  return [
    { value: "", label: "使用当前 Provider" },
    ...data.providers.map(provider => ({ value: provider.id, label: `${provider.name}${provider.model ? ` · ${provider.model}` : ""}` })),
  ].map(option => ({ ...option, selected: option.value === value }));
}

function identityOptions(value = "") {
  return [
    { value: "", label: "不绑定身份" },
    ...data.identities.map(identity => ({ value: identity.id, label: `${identity.icon || "ID"} ${identity.name}` })),
  ].map(option => ({ ...option, selected: option.value === value }));
}

function memberOptions(team, value = "") {
  return [
    { value: "", label: "未分配成员" },
    ...team.members.map(member => ({ value: member.id, label: `${member.icon || "ID"} ${member.name}` })),
  ].map(option => ({ ...option, selected: option.value === value }));
}

function boolSelect(value) {
  return [
    { value: "true", label: "需要人工确认" },
    { value: "false", label: "无需人工确认" },
  ].map(option => ({ ...option, selected: option.value === String(value !== false) }));
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
  if (member?.identityId) {
    await deps.switchIdentity?.(member.identityId);
  }
  if (member?.permissionMode) {
    deps.setPerm?.(member.permissionMode);
  }
  deps.updateFooter?.();
}

async function prepareStep(team, step, deps) {
  const run = runState(team.id);
  if (!run.task) {
    const result = await showModal("启动 Team 工作流", [
      { key: "task", label: "任务", value: "", type: "textarea", placeholder: "输入这个 Team 要共同完成的任务" },
    ]);
    if (!result?.task?.trim()) return;
    run.task = result.task.trim();
    run.outputs ||= {};
    run.updatedAt = Date.now();
    save();
  }

  const r = await safeBridge("composeTeamStepPrompt", null, {
    teamId: team.id,
    stepId: step.id,
    task: run.task,
    previousOutputs: run.outputs || {},
  });
  if (!r.ok || !r.data?.prompt) {
    toast(r.error || "生成步骤提示词失败", "error");
    return;
  }

  await switchMemberContext(r.data.member, deps);
  const input = document.querySelector("#promptInput");
  if (input) {
    input.value = r.data.prompt;
    input.dispatchEvent(new Event("input"));
    input.focus();
  }
  document.querySelector("#settingsPage")?.classList.remove("is-open");
  toast(`已准备步骤：${step.name}`, "success");
}

async function acceptLastOutput(team, step, renderSettingsTab) {
  const last = lastAssistantMessage();
  if (!last) {
    toast("没有可采纳的助手输出", "error");
    return;
  }
  const run = runState(team.id);
  run.outputs ||= {};
  run.outputs[step.id] = String(last.content || "").trim();
  run.updatedAt = Date.now();
  save();
  toast(`已采纳：${step.name}`, "success");
  renderSettingsTab();
}

async function createTeamDlg(renderSettingsTab) {
  const result = await showModal("创建 Team", [
    { key: "name", label: "名称", value: "新 Team" },
    { key: "description", label: "描述", value: "", type: "textarea" },
    { key: "rules", label: "团队规则", value: "", type: "textarea", placeholder: "所有成员共同遵守的规则、输出格式、交接约束" },
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
  if (!await showConfirm("删除 Team", `确定删除「${team.name}」？`)) return;
  const r = await safeBridge("deleteTeam", null, team.id);
  if (r.ok) {
    if (state.selectedTeamId === team.id) state.selectedTeamId = "";
    save();
    toast("Team 已删除", "success");
    await refresh(renderSettingsTab);
  } else toast(r.error || "删除失败", "error");
}

async function memberDlg(team, member, renderSettingsTab) {
  const result = await showModal(member ? "编辑成员" : "添加成员", [
    { key: "name", label: "名称", value: member?.name || "新成员" },
    { key: "icon", label: "标识", value: member?.icon || "ID" },
    { key: "role", label: "职责", value: member?.role || "", type: "textarea" },
    { key: "rules", label: "成员规则", value: member?.rules || "", type: "textarea", placeholder: "这个成员自己的行为准则、输出格式、注意事项" },
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
  if (r.ok) { toast(member ? "成员已更新" : "成员已添加", "success"); await refresh(renderSettingsTab); }
  else toast(r.error || "保存失败", "error");
}

async function deleteMemberDlg(team, member, renderSettingsTab) {
  if (!await showConfirm("删除成员", `确定删除「${member.name}」？相关步骤会变为未分配。`)) return;
  const r = await safeBridge("deleteTeamMember", null, team.id, member.id);
  if (r.ok) { toast("成员已删除", "success"); await refresh(renderSettingsTab); }
  else toast(r.error || "删除失败", "error");
}

async function stepDlg(team, step, renderSettingsTab) {
  const result = await showModal(step ? "编辑步骤" : "添加步骤", [
    { key: "name", label: "步骤名", value: step?.name || "新步骤" },
    { key: "memberId", label: "执行成员", type: "select", value: step?.memberId || "", options: memberOptions(team, step?.memberId || "") },
    { key: "instruction", label: "步骤指令", value: step?.instruction || "", type: "textarea", placeholder: "这一步要这个成员完成什么" },
    { key: "requiresApproval", label: "人工确认", type: "select", value: String(step?.requiresApproval !== false), options: boolSelect(step?.requiresApproval) },
  ]);
  if (!result?.name?.trim()) return;
  result.requiresApproval = result.requiresApproval !== "false";
  const method = step ? "updateTeamStep" : "createTeamStep";
  const args = step ? [team.id, step.id, result] : [team.id, result];
  const r = await safeBridge(method, null, ...args);
  if (r.ok) { toast(step ? "步骤已更新" : "步骤已添加", "success"); await refresh(renderSettingsTab); }
  else toast(r.error || "保存失败", "error");
}

async function deleteStepDlg(team, step, renderSettingsTab) {
  if (!await showConfirm("删除步骤", `确定删除「${step.name}」？`)) return;
  const r = await safeBridge("deleteTeamStep", null, team.id, step.id);
  if (r.ok) { toast("步骤已删除", "success"); await refresh(renderSettingsTab); }
  else toast(r.error || "删除失败", "error");
}

function renderTeamList({ settingsBody, renderSettingsTab }) {
  const wrap = document.createElement("div");
  wrap.className = "scard";
  wrap.innerHTML = `<div class="scard-head"><span class="scard-title">Teams</span><div class="scard-actions"><button class="st-btn t-btn--primary t-btn--sm" id="createTeamBtn">创建 Team</button></div></div>`;
  settingsBody.append(wrap);
  wrap.querySelector("#createTeamBtn").addEventListener("click", () => createTeamDlg(renderSettingsTab));

  for (const team of data.teams) {
    const row = document.createElement("div");
    row.className = "slist-item" + (team.id === selectedTeam()?.id ? " is-active" : "");
    row.innerHTML = `
      <div class="slist-icon">TM</div>
      <div class="slist-body">
        <div class="slist-name">${escapeHtml(team.name)}</div>
        <div class="slist-sub">${team.members.length} 成员 / ${team.workflow.length} 步骤 · ${escapeHtml(team.description || "")}</div>
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

function renderTeamDetail(team, deps) {
  const { settingsBody, renderSettingsTab } = deps;
  const run = runState(team.id);
  const header = document.createElement("div");
  header.className = "scard";
  header.innerHTML = `
    <div class="scard-head">
      <span class="scard-title">${escapeHtml(team.name)}</span>
      <div class="scard-actions">
        <button class="st-btn t-btn--link" id="teamTaskBtn">任务</button>
        <button class="st-btn t-btn--link" id="editTeamBtn">编辑</button>
        <button class="st-btn t-btn--primary t-btn--sm" id="addMemberBtn">添加成员</button>
        <button class="st-btn t-btn--link" id="addStepBtn">添加步骤</button>
      </div>
    </div>
    <div class="slist-sub">${escapeHtml(team.description || "用户自定义团队：成员规则、模型和 workflow 都由你决定。")}</div>
    <div class="slist-sub" style="margin-top:4px;">当前任务：${escapeHtml(run.task || "未设置")}</div>
  `;
  settingsBody.append(header);
  header.querySelector("#teamTaskBtn").addEventListener("click", async () => {
    const result = await showModal("Team 任务", [{ key: "task", label: "任务", value: run.task || "", type: "textarea" }]);
    if (!result) return;
    run.task = result.task || "";
    run.updatedAt = Date.now();
    save();
    renderSettingsTab();
  });
  header.querySelector("#editTeamBtn").addEventListener("click", () => editTeamDlg(team, renderSettingsTab));
  header.querySelector("#addMemberBtn").addEventListener("click", () => memberDlg(team, null, renderSettingsTab));
  header.querySelector("#addStepBtn").addEventListener("click", () => stepDlg(team, null, renderSettingsTab));

  const membersTitle = document.createElement("div");
  membersTitle.style.cssText = "margin:14px 0 6px;font-size:12px;font-weight:700;color:var(--td-text-color-secondary);";
  membersTitle.textContent = "成员";
  settingsBody.append(membersTitle);

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
  if (!team.members.length) {
    const empty = document.createElement("div");
    empty.className = "slist-sub";
    empty.textContent = "还没有成员。先添加一个成员，写规则并绑定模型/身份。";
    settingsBody.append(empty);
  }

  const stepsTitle = document.createElement("div");
  stepsTitle.style.cssText = "margin:14px 0 6px;font-size:12px;font-weight:700;color:var(--td-text-color-secondary);";
  stepsTitle.textContent = "工作流";
  settingsBody.append(stepsTitle);

  team.workflow.forEach((step, index) => {
    const hasOutput = Boolean(run.outputs?.[step.id]);
    const card = document.createElement("div");
    card.className = "slist-item";
    card.innerHTML = `
      <div class="slist-icon">${index + 1}</div>
      <div class="slist-body">
        <div class="slist-name">${escapeHtml(step.name)} ${step.requiresApproval ? '<span style="font-size:10px;color:var(--td-warning-color);">人工确认</span>' : ""}</div>
        <div class="slist-sub">${escapeHtml(memberName(team, step.memberId))}</div>
        <div class="slist-sub">${escapeHtml(step.instruction || "")}</div>
        <div class="slist-sub">${hasOutput ? "已采纳输出" : "未采纳输出"}</div>
      </div>
      <div class="slist-actions">
        <button class="st-btn t-btn--primary t-btn--sm" data-act="prepare">准备运行</button>
        <button class="st-btn t-btn--link" data-act="accept">采纳最后回复</button>
        <button class="st-btn t-btn--link" data-act="edit">编辑</button>
        <button class="st-btn t-btn--danger t-btn--sm" data-act="delete">删除</button>
      </div>
    `;
    card.querySelector('[data-act="prepare"]').addEventListener("click", () => prepareStep(team, step, deps));
    card.querySelector('[data-act="accept"]').addEventListener("click", () => acceptLastOutput(team, step, renderSettingsTab));
    card.querySelector('[data-act="edit"]').addEventListener("click", () => stepDlg(team, step, renderSettingsTab));
    card.querySelector('[data-act="delete"]').addEventListener("click", () => deleteStepDlg(team, step, renderSettingsTab));
    settingsBody.append(card);
  });
  if (!team.workflow.length) {
    const empty = document.createElement("div");
    empty.className = "slist-sub";
    empty.textContent = "还没有步骤。添加步骤后，就能按人工工作流逐步运行。";
    settingsBody.append(empty);
  }
}

export function renderTeamsSettings(deps) {
  const { settingsBody, renderSettingsTab } = deps;
  if (!data.teams.length) {
    renderTeamList(deps);
    const empty = document.createElement("div");
    empty.className = "slist-sub";
    empty.style.padding = "10px 2px";
    empty.textContent = "Teams 是用户自定义的身份工作流：你决定成员、规则、模型、Skills 身份和步骤顺序。";
    settingsBody.append(empty);
    return;
  }

  if (!state.selectedTeamId || !data.teams.some(team => team.id === state.selectedTeamId)) {
    state.selectedTeamId = data.teams[0].id;
    save();
  }

  renderTeamList(deps);
  const team = selectedTeam();
  if (team) renderTeamDetail(team, deps);
}
