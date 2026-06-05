import { data, save, sessMeta, state } from "./state.js";
import { getBridge } from "./bridge.js";
import { $, basename, fmtTime, searchable } from "./helpers.js";
import { escapeHtml } from "../markdown.js";

// Dependency injection
let deps = {};
export function configure(d) { deps = d; }

export function openSearchPanel() {
  const panel = $("#searchPanel");
  panel.classList.add("is-open");
  const input = $("#globalSearchInput");
  input.value = state.searchTerm || "";
  renderSearchResults(input.value);
  setTimeout(() => input.focus(), 0);
}

export function closeSearchPanel() {
  $("#searchPanel")?.classList.remove("is-open");
}

export function collectSearchResults(term) {
  const q = searchable(term);
  const results = [];
  if (!q) return results;
  const bridge = getBridge();
  for (const project of data.projects) {
    if (searchable(`${project.path} ${project.name}`).includes(q)) {
      results.push({ type: "项目", title: basename(project.path || project.name), sub: project.path || project.name, action: () => deps.selectProject?.(project) });
    }
    for (const session of project.sessions || []) {
      const title = sessMeta(session.id).title || session.title || session.id;
      if (searchable(`${title} ${session.id} ${project.path}`).includes(q)) {
        results.push({ type: "对话", title, sub: `${basename(project.path || project.name)} · ${fmtTime(session.updatedAt)}`, action: () => deps.selectSession?.(project, session) });
      }
    }
  }
  for (const msg of state.messages || []) {
    if (searchable(msg.content).includes(q)) {
      results.push({ type: "当前对话", title: String(msg.content || "").slice(0, 80), sub: msg.role, action: closeSearchPanel });
    }
  }
  for (const plugin of data.plugins || []) {
    if (searchable(`${plugin.name} ${plugin.path}`).includes(q)) {
      results.push({ type: "插件", title: plugin.name, sub: plugin.path || "", action: () => bridge?.openPath?.(plugin.path) });
    }
  }
  for (const identity of data.identities || []) {
    if (searchable(`${identity.name} ${identity.description}`).includes(q)) {
      results.push({ type: "身份", title: identity.name, sub: identity.description || "", action: () => deps.switchIdentity?.(identity.id) });
    }
  }
  for (const team of data.teams || []) {
    const memberText = (team.members || []).map(member => `${member.name} ${member.role} ${member.rules}`).join(" ");
    const workflowText = (team.workflow || []).map(step => `${step.name} ${step.instruction} ${step.decisionInstruction}`).join(" ");
    if (searchable(`${team.name} ${team.description} ${team.rules} ${memberText} ${workflowText}`).includes(q)) {
      results.push({
        type: "Team",
        title: team.name,
        sub: `${team.members?.length || 0} 身份 · ${team.workflow?.length || 0} 节点`,
        action: () => { state.selectedTeamId = team.id; save(); deps.openTeamsBuilder?.(); },
      });
    }
  }
  for (const task of data.agentTasks || []) {
    if (searchable(`${task.title} ${task.prompt} ${task.cwd} ${task.branch} ${task.worktreePath}`).includes(q)) {
      results.push({
        type: "Agent Task",
        title: task.title,
        sub: `${task.status || "draft"} · ${task.branch || task.cwd || ""}`,
        action: () => deps.openSettings?.("tasks"),
      });
    }
  }
  return results.slice(0, 40);
}

export function renderSearchResults(term) {
  const body = $("#searchResults");
  if (!body) return;
  const results = collectSearchResults(term);
  state.searchTerm = term;
  save();
  deps.renderProjects?.();
  deps.renderConvs?.();
  if (!results.length) {
    body.innerHTML = `<div style="padding:16px;color:var(--td-text-color-disabled);font-size:12px;text-align:center;">${term ? "没有搜索结果" : "输入关键词搜索项目、对话、插件、身份和当前消息"}</div>`;
    return;
  }
  body.innerHTML = "";
  for (const result of results) {
    const item = document.createElement("button");
    item.className = "search-result";
    item.type = "button";
    item.innerHTML = `<b>${escapeHtml(result.title || "")}</b><span>${result.type} · ${escapeHtml(result.sub || "")}</span>`;
    item.addEventListener("click", async () => {
      await result.action?.();
      closeSearchPanel();
    });
    body.append(item);
  }
}
