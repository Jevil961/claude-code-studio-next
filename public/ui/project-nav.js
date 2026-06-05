import { data, save, sessMeta, state } from "./state.js";
import { safeBridge, selProject } from "./bridge.js";
import { $, basename, fmtTime, hlMatch, searchable, toast } from "./helpers.js";
import { showConfirm, showModal } from "./modal.js";
import { escapeHtml } from "../markdown.js";

// Dependency injection
let deps = {};
export function configure(d) { deps = d; }

export function decodeProjectDisplay(name) {
  try {
    if (name.length >= 3 && name[1] === "-" && name[2] === "-") return name[0] + ":\\" + name.slice(3).replace(/-/g, "\\");
    return name.replace(/-/g, "/");
  } catch { return name; }
}

export function renderProjects() {
  const list = $("#projectList");
  list.innerHTML = "";
  const term = state.searchTerm;
  const initialLoadDone = deps.getInitialLoadDone?.() || false;
  const projects = data.projects.filter(proj => {
    const hay = searchable(`${proj.path} ${proj.name}`);
    return !term || hay.includes(term);
  });
  for (const proj of projects.slice(0, 20)) {
    const displayName = proj.path ? basename(proj.path) : decodeProjectDisplay(proj.name || proj.id);
    const node = document.createElement("button");
    node.className = `conv-item${proj.id === state.selectedProject ? " is-active" : ""}`;
    node.type = "button";
    node.innerHTML = `<div class="conv-item-body"><div class="conv-item-title" title="${escapeHtml(proj.path || decodeProjectDisplay(proj.name || ""))}">${hlMatch(displayName, term)}</div><div class="conv-item-time">${proj.sessionCount || 0} 轮 · ${fmtTime(proj.updatedAt)}</div></div>`;
    node.addEventListener("click", () => selectProject(proj));
    list.append(node);
  }
  if (!list.children.length) {
    list.innerHTML = initialLoadDone
      ? `<div class="mini-empty"><b>${term ? "没有匹配项目" : "还没有项目"}</b><span>${term ? "换个关键词，或添加新的项目目录。" : "添加一个代码目录后，Claude Code 才知道在哪里执行任务。"}</span><button class="st-btn t-btn--link t-btn--sm" id="emptyAddProjectBtn" type="button">添加项目</button></div>`
      : `<div class="mini-empty"><b>正在加载项目</b><span>首次扫描可能需要一点时间。</span></div>`;
    list.querySelector("#emptyAddProjectBtn")?.addEventListener("click", () => document.querySelector("#addFolderBtn")?.click());
  }
}

export function selectProject(proj) {
  const changedProject = state.selectedProject && state.selectedProject !== proj.id;
  state.selectedProject = proj.id;
  state.cwd = proj.path;
  if (changedProject || !state.selectedSession) {
    state.selectedSession = "";
    state.selectedSessionPath = "";
    state.clientSessionKey = crypto.randomUUID();
    state.messages = [];
    state.mode = "normal";
  } else {
    state.mode = "continue";
  }
  save();
  deps.setMode?.(state.mode);
  renderProjects();
  renderConvs();
  deps.renderMessages?.();
  deps.updateFooter?.();
}

export function renderConvs() {
  const list = $("#convList");
  list.innerHTML = "";
  const tpl = $("#tplConv");
  const proj = selProject();
  const term = state.searchTerm;
  const initialLoadDone = deps.getInitialLoadDone?.() || false;
  const sessions = (proj?.sessions || [])
    .filter(s => !sessMeta(s.id).archived && !sessMeta(s.id).deleted)
    .sort((a, b) => Number(!!sessMeta(b.id).pinned) - Number(!!sessMeta(a.id).pinned) || (b.updatedAt || 0) - (a.updatedAt || 0));
  // Apply filter
  const filter = state.convFilter || 'all';
  const filteredSessions = sessions.filter(s => {
    const m = sessMeta(s.id);
    if (filter === 'pinned') return m.pinned;
    if (filter === 'recent') {
      const today = new Date(); today.setHours(0,0,0,0);
      return (s.updatedAt || 0) * 1000 >= today.getTime();
    }
    if (filter === 'archived') return m.archived;
    return true;
  });

  const visibleSessions = filteredSessions.filter(s => {
    const m = sessMeta(s.id);
    const title = m.title || s.title || s.id;
    return !term || searchable(`${title} ${s.id}`).includes(term);
  });
  for (const s of visibleSessions.slice(0, 30)) {
    const m = sessMeta(s.id);
    const title = m.title || s.title || s.id;
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.classList.toggle("is-active", s.id === state.selectedSession);
    node.querySelector(".conv-item-title").innerHTML = hlMatch(title, term);
    node.querySelector(".conv-item-time").textContent = fmtTime(s.updatedAt);
    node.querySelector(".conv-item-badge").textContent = m.pinned ? "置顶" : "";
    node.addEventListener("click", () => selectSession(proj, s));
    node.addEventListener("contextmenu", e => {
      e.preventDefault();
      showConvContextMenu(e, s, proj);
    });
    list.append(node);
  }
  if (!list.children.length) {
    list.innerHTML = initialLoadDone
      ? `<div class="mini-empty"><b>${proj ? "还没有对话" : "先选择项目"}</b><span>${proj ? "从底部输入框提交第一个任务，对话会自动出现在这里。" : "选择或添加项目后，历史对话会按更新时间展示。"}</span>${proj ? '<button class="st-btn t-btn--link t-btn--sm" id="emptyFocusPromptBtn" type="button">开始任务</button>' : ""}</div>`
      : `<div class="mini-empty"><b>正在加载对话</b><span>正在读取 Claude 项目索引。</span></div>`;
    list.querySelector("#emptyFocusPromptBtn")?.addEventListener("click", () => document.querySelector("#promptInput")?.focus());
  }
}

export function showConvContextMenu(e, session, proj) {
  const ctx = $("#ctxMenu");
  const meta = sessMeta(session.id);
  ctx.innerHTML = `
    <button class="model-option" data-act="pin" type="button" role="menuitem">${meta.pinned ? "取消置顶" : "置顶"}</button>
    <button class="model-option" data-act="rename" type="button" role="menuitem">重命名</button>
    <button class="model-option" data-act="archive" type="button" role="menuitem">${meta.archived ? "取消归档" : "归档"}</button>
    <button class="model-option" data-act="export-md" type="button" role="menuitem">导出为 Markdown</button>
    <button class="model-option" data-act="export-json" type="button" role="menuitem">导出为 JSON</button>
    <div style="height:1px;background:var(--td-border-level-2-color);margin:3px 6px;"></div>
    <button class="model-option" data-act="delete" type="button" role="menuitem" style="color:var(--td-error-color);">删除</button>
  `;
  ctx.querySelectorAll("[data-act]").forEach(btn => {
    btn.addEventListener("click", async () => {
      ctx.classList.remove("is-open");
      const act = btn.dataset.act;
      if (act === "pin") { meta.pinned = !meta.pinned; save(); renderConvs(); }
      if (act === "archive") { meta.archived = !meta.archived; save(); renderConvs(); }
      if (act === "rename") {
        const result = await showModal("重命名对话", [
          { key: "title", label: "标题", value: meta.title || session.title || "" },
        ]);
        if (result?.title !== undefined) { meta.title = result.title || ""; save(); renderConvs(); }
      }
      if (act === "delete") {
        if (!await showConfirm("删除", `确定删除对话「${meta.title || session.title || session.id}」？\n\n注意：这会删除 ~/.claude/projects/ 下的对话文件。`)) return;
        meta.deleted = true;
        save();
        if (state.selectedSession === session.id) { state.selectedSession = ""; state.messages = []; state.selectedSessionPath = ""; state.mode = "normal"; save(); deps.renderMessages?.(); }
        renderConvs();
      }
      if (act === "export-md" || act === "export-json") {
        const sr = await safeBridge("readSession", null, session.id);
        if (!sr.ok || !sr.data?.messages) { toast("读取对话失败", "error"); return; }
        const msgs = sr.data.messages;
        const title = meta.title || session.title || session.id;
        let content, filename;
        if (act === "export-md") {
          content = msgs.map(m => `## ${m.role === 'user' ? 'User' : 'Assistant'}\n\n${m.content || ''}\n`).join('\n---\n\n');
          filename = `${title}.md`;
        } else {
          content = JSON.stringify({ title, messages: msgs }, null, 2);
          filename = `${title}.json`;
        }
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
        toast(`已导出：${filename}`, "success");
      }
    });
  });
  ctx.style.top = `${e.clientY}px`;
  ctx.style.left = `${e.clientX}px`;
  ctx.style.right = "auto";
  ctx.style.bottom = "auto";
  ctx.classList.add("is-open");
  setTimeout(() => document.addEventListener("click", () => ctx.classList.remove("is-open"), { once: true }), 0);
}

export function selectSession(proj, s) {
  state.selectedProject = proj.id;
  state.selectedSession = s.id;
  state.cwd = proj.path;
  state.mode = "continue";
  save();
  deps.setMode?.("continue");
  renderConvs();
  loadSession(s);
}

export async function loadSession(s) {
  const r = await safeBridge("readSession", null, s.id);
  if (!r.ok || !r.data) { (await import("./helpers.js")).toast(r.error || "读取失败", "error"); return; }
  if (r.data.exists === false) {
    recoverMissingSession(r.data.error);
    return;
  }
  state.messages = Array.isArray(r.data.messages) ? r.data.messages : [];
  state.selectedSessionPath = r.data.path || s.file || "";
  save();
  deps.renderMessages?.();
  deps.updateFooter?.();
}

export function recoverMissingSession(error) {
  state.selectedSession = "";
  state.selectedSessionPath = "";
  state.mode = "normal";
  state.clientSessionKey = crypto.randomUUID();
  save();
  renderConvs();
  deps.updateFooter?.();
  (async () => { (await import("./helpers.js")).toast("这个历史对话已经找不到了，已切换到新对话。", "error"); })();
  if (!state.messages.length) {
    state.messages = [{
      role: "assistant",
      content: `这个历史对话已经找不到了，可能被移动、删除，或 Claude 的会话索引已过期。\n\n我已经切换到新对话，不会再继续使用失效的 session。\n\n诊断信息：${error || "session missing"}`,
    }];
    save();
    deps.renderMessages?.();
  }
}

export function initProjectNav() {
  // Wire filter bar
  const filterBar = $('#convFilterBar');
  if (filterBar) {
    filterBar.querySelectorAll('.conv-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.convFilter = btn.dataset.filter;
        save();
        filterBar.querySelectorAll('.conv-filter-btn').forEach(b => b.classList.toggle('is-active', b === btn));
        renderConvs();
      });
    });
  }
}

export async function validateActiveSession() {
  if (!state.selectedSession) return true;
  const known = data.projects.some(project => (project.sessions || []).some(session => session.id === state.selectedSession));
  if (known) return true;
  const r = await safeBridge("validateSession", null, state.selectedSession);
  if (r.ok && r.data?.exists) return true;
  recoverMissingSession(r.data?.error || r.error);
  return false;
}
