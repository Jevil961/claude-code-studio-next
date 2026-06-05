import { data, state } from "./state.js";
import { getBridge } from "./bridge.js";
import { $, basename, fmtTime } from "./helpers.js";
import { escapeHtml } from "../markdown.js";
import { projectIndexState } from "./data-loader.js";

// Module-local state
export let runTimeline = [];
export let runTouchedFiles = [];
export let lastTimelineKey = "";

// Dependency injection
let deps = {};
export function configure(d) { deps = d; }

export function setRunTimeline(v) { runTimeline = v; }
export function setRunTouchedFiles(v) { runTouchedFiles = v; }
export function setLastTimelineKey(v) { lastTimelineKey = v; }

export function updateFooter() {
  const p = deps.curProvider?.();
  const active = data.identities.find(i => i.active);
  $("#providerInfo").textContent = p ? `${p.name} · ${p.model || ""}` : "未连接";
  $("#identityInfo").textContent = active ? `${active.icon || ""} ${active.name}` : "未设置身份";
  $("#cwdState").textContent = state.cwd || "未选择项目";
  const git = data.diagnostics?.git;
  const branchText = git?.ok ? `${git.branch || "detached"}${git.dirty ? ` · ${git.changedFiles} 改动` : " · clean"}` : "";
  $("#branchState").textContent = branchText;
  deps.updateModelLabel?.();
  renderContextStack();
}

export function compactPath(path) {
  const text = String(path || "");
  if (!text) return "--";
  if (text.length <= 42) return text;
  return `${text.slice(0, 18)}...${text.slice(-20)}`;
}

export function indexStatusLabel() {
  if (projectIndexState.status === "queued") return "等待刷新";
  if (projectIndexState.status === "scanning") return "后台扫描中";
  if (projectIndexState.status === "done") {
    const count = projectIndexState.stats?.scannedProjects;
    return count ? `已索引 ${count} 个项目` : "已刷新";
  }
  if (projectIndexState.status === "error") return "刷新失败";
  return data.projects.length ? `缓存 ${data.projects.length} 个项目` : "未索引";
}

export function appendKv(rows, key, value, tone = "") {
  rows.push(`<div class="ctx-row${tone ? ` is-${tone}` : ""}"><span>${escapeHtml(key)}</span><b title="${escapeHtml(String(value || ""))}">${escapeHtml(String(value || "--"))}</b></div>`);
}

export function renderContextStack() {
  const overview = $("#contextOverview");
  if (!overview) return;
  const provider = deps.curProvider?.();
  const identity = data.identities.find(i => i.active);
  const project = deps.selProject?.();
  const git = data.diagnostics?.git || null;
  const readyItems = [
    { ok: Boolean(provider), label: "Provider" },
    { ok: Boolean(state.cwd || project?.path), label: "Project" },
    { ok: Boolean(state.claudePath || data.diagnostics?.claudePath), label: "Claude" },
  ];
  const readyScore = readyItems.filter(item => item.ok).length;
  const rows = [];
  appendKv(rows, "Readiness", `${readyScore}/${readyItems.length} ${readyScore === readyItems.length ? "就绪" : "待配置"}`, readyScore === readyItems.length ? "" : "plan");
  appendKv(rows, "Provider", provider ? provider.name : "--");
  appendKv(rows, "Model", provider?.model || "--");
  appendKv(rows, "Identity", identity ? `${identity.icon || ""} ${identity.name}` : "--");
  appendKv(rows, "Project", project?.path ? basename(project.path) : (state.cwd ? basename(state.cwd) : "--"));
  if (git?.ok) appendKv(rows, "Git", `${git.branch || "detached"} · ${git.dirty ? `${git.changedFiles} 改动` : "clean"}`, git.counts?.conflicted ? "danger" : git.dirty ? "plan" : "");
  else appendKv(rows, "Git", git?.reason === "not-git-repo" ? "非 Git 项目" : "--");
  appendKv(rows, "Permission", state.permissionMode || "auto", state.permissionMode === "bypass" ? "danger" : state.permissionMode === "plan" ? "plan" : "");
  appendKv(rows, "MCP", `${data.mcp.filter(m => m.enabled !== false).length}/${data.mcp.length || 0}`);
  appendKv(rows, "Skills", String(data.skills.length || 0));
  appendKv(rows, "Plugins", String(data.plugins.length || 0));
  appendKv(rows, "Index", indexStatusLabel(), projectIndexState.status === "error" ? "danger" : projectIndexState.status === "scanning" ? "plan" : "");
  overview.innerHTML = rows.join("");
  renderRunTimeline();
  renderArtifacts();
}

export function addTimeline(type, title, detail = "") {
  const key = `${type}:${title}:${detail}`;
  if (key === lastTimelineKey) return;
  lastTimelineKey = key;
  const item = { type, title, detail, at: Date.now() };
  runTimeline.unshift(item);
  runTimeline = runTimeline.slice(0, 60);
  deps.recordReplayEvent?.(item);
  renderRunTimeline();
}

export function renderRunTimeline() {
  const list = $("#runTimeline");
  const count = $("#timelineCount");
  if (!list) return;
  if (count) count.textContent = String(runTimeline.length);
  if (!runTimeline.length) {
    list.innerHTML = `<div class="ctx-empty">运行后会显示准备、工具调用、权限、错误和完成状态。</div>`;
    return;
  }
  list.innerHTML = runTimeline.map(item => `
    <div class="timeline-item is-${escapeHtml(item.type || "info")}">
      <span class="timeline-dot"></span>
      <div class="timeline-body">
        <b>${escapeHtml(item.title || "")}</b>
        ${item.detail ? `<span>${escapeHtml(item.detail)}</span>` : ""}
        <em>${fmtTime(Math.floor(item.at / 1000))}</em>
      </div>
    </div>
  `).join("");
}

export function renderArtifacts() {
  const list = $("#artifactList");
  const count = $("#artifactCount");
  if (!list) return;
  const attachedFiles = deps.getAttachedFiles?.() || [];
  const items = [
    ...attachedFiles.map(path => ({ type: "附件", path })),
    ...runTouchedFiles.map(path => ({ type: "变更", path })),
  ];
  if (count) count.textContent = String(items.length);
  if (!items.length) {
    list.innerHTML = `<div class="ctx-empty">拖拽文件或运行工具后，这里会沉淀材料与变更。</div>`;
    return;
  }
  list.innerHTML = items.slice(0, 12).map(item => `
    <button class="artifact-item" type="button" title="${escapeHtml(item.path)}">
      <span>${escapeHtml(item.type)}</span>
      <b>${escapeHtml(basename(item.path) || item.path)}</b>
      <em>${escapeHtml(compactPath(item.path))}</em>
    </button>
  `).join("");
  const bridge = getBridge();
  [...list.querySelectorAll(".artifact-item")].forEach((node, index) => {
    node.addEventListener("click", () => bridge?.openPath?.(items[index].path));
  });
}

export function collectPaths(value, out = []) {
  if (!value) return out;
  if (typeof value === "string") {
    if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("/") || value.includes("\\") || value.includes("/")) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach(v => collectPaths(v, out));
    return out;
  }
  if (typeof value === "object") {
    for (const [key, val] of Object.entries(value)) {
      if (/path|file|directory|dir/i.test(key)) collectPaths(val, out);
      else if (typeof val === "object") collectPaths(val, out);
    }
  }
  return out;
}

export function timelineFromClaudeEvent(event, payload = {}) {
  if (!event) return;
  if (event.type === "system" && event.subtype === "init") addTimeline("info", "工作区已就绪", "");
  if (event.type === "status" && payload.status) addTimeline("info", "准备中", deps.friendlyProgress?.(payload.progress || payload.status));
  if (event.type === "retry") addTimeline("warn", "连接重试", payload.progress || "");
  if (event.type === "assistant") {
    const content = event.message?.content || event.content || [];
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part?.type !== "tool_use") continue;
        const toolName = part.name || "tool";
        addTimeline("tool", "工具调用", toolName);
        const paths = collectPaths(part.input || {});
        for (const path of paths) {
          if (!runTouchedFiles.includes(path)) runTouchedFiles.unshift(path);
        }
        if (paths.length) deps.recordReplayEvent?.({ type: "tool", title: "关联文件", detail: `${toolName} · ${paths.length} 个路径`, at: Date.now(), paths });
      }
    }
  }
  if (event.type === "result") addTimeline("success", "运行完成", deps.friendlyProgress?.(payload.progress || ""));
  renderArtifacts();
}
