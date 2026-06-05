import { data, state } from "./state.js";
import { getBridge } from "./bridge.js";
import { $, basename, toast } from "./helpers.js";
import { escapeHtml, renderMarkdown, renderInlineMarkdown } from "../markdown.js";
import { renderSkeleton } from "./skeleton.js";

// Module-local state
export let attachedFiles = [];
let replayOverlay = null;

// Dependency injection
let deps = {};
export function configure(d) { deps = d; }

export function setAttachedFiles(v) { attachedFiles = v; }
export function getAttachedFiles() { return attachedFiles; }

export function renderMessages() {
  const transcript = $("#transcript");
  transcript.innerHTML = "";
  if (!state.messages.length) {
    const hasProvider = Boolean(data.providers.length);
    const hasProject = Boolean(state.cwd);
    const checklist = [
      { done: hasProvider, label: "配置 Provider" },
      { done: hasProject, label: "选择项目目录" },
      { done: true, label: "输入任务并发送" },
    ];
    transcript.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon" aria-hidden="true">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M7 8h10M7 12h7M7 16h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><rect x="4" y="4" width="16" height="16" rx="4" stroke="currentColor" stroke-width="1.7"/></svg>
        </div>
        <b>把第一个工程任务交给 Claude Code</b>
        <span>${hasProject ? "描述你要分析、修改或生成的目标；我会把项目目录、身份和附件一起传给运行器。" : "先添加一个代码目录，再描述你希望 Claude Code 完成的工作。"}</span>
        <div class="empty-checklist">
          ${checklist.map(item => `<span class="${item.done ? "is-done" : ""}">${item.done ? "✓" : "•"} ${item.label}</span>`).join("")}
        </div>
        <div class="empty-actions">
          ${hasProject ? "" : '<button class="st-btn t-btn--primary t-btn--sm" id="emptyAddProject" type="button">添加项目</button>'}
          <button class="st-btn t-btn--primary t-btn--sm" id="emptyFocusPrompt" type="button">输入任务</button>
          <button class="st-btn t-btn--link" id="emptyOpenProviders" type="button">配置 Provider</button>
          <button class="st-btn t-btn--link" id="emptyOpenTeams" type="button">打开 Teams</button>
        </div>
      </div>
    `;
    transcript.querySelector("#emptyAddProject")?.addEventListener("click", () => document.querySelector("#addFolderBtn")?.click());
    transcript.querySelector("#emptyFocusPrompt")?.addEventListener("click", () => $("#promptInput")?.focus());
    transcript.querySelector("#emptyOpenProviders")?.addEventListener("click", () => deps.openSettings?.("providers"));
    transcript.querySelector("#emptyOpenTeams")?.addEventListener("click", () => deps.openTeamsBuilder?.());
    return;
  }
  const tpl = $("#tplMessage");
  const bridge = getBridge();
  const currentRunId = deps.getCurrentRunId?.() || "";
  for (const [i, msg] of state.messages.entries()) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.classList.add(msg.role);
    node.id = `msg-${i}`;
    node.classList.add('msg-anchor');
    node.setAttribute('aria-label', msg.role === 'user' ? '用户消息' : 'AI 回复');
    const content = node.querySelector(".msg-content");

    // Add copy button to message
    const msgBody = node.querySelector(".msg-body");
    const copyBtn = document.createElement("button");
    copyBtn.className = "msg-copy-btn";
    copyBtn.title = "复制";
    copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M3 11V3h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;
    copyBtn.addEventListener("click", async () => {
      const text = (msg.content || "").trim();
      if (!text) return;
      await bridge?.copyText?.(text);
      copyBtn.classList.add("copied");
      setTimeout(() => copyBtn.classList.remove("copied"), 1200);
    });
    msgBody.append(copyBtn);

    if (msg.role === "user") {
      content.innerHTML = renderMarkdown(msg.content || "");
    } else {
      // AI: check for thinking data
      const thinking = msg.thinking || [];
      const hasThinking = thinking.length > 0;
      const isLast = i === state.messages.length - 1;
      const isRunning = !!currentRunId;

      if (hasThinking) {
        const panel = document.createElement("div");
        const expanded = isRunning && isLast;
        panel.className = `thinking-panel${expanded ? " is-expanded" : ""}`;
        panel.innerHTML = `
          <button class="thinking-toggle" type="button">
            <span class="thinking-icon">▶</span>
            <span class="thinking-label">思考过程</span>
            ${isRunning && isLast ? '<span class="thinking-dot"></span>' : `<span class="thinking-status">${thinking.length} 步</span>`}
          </button>
          <div class="thinking-body">${thinking.map(t => `<div>${renderInlineMarkdown(t)}</div>`).join("")}</div>
        `;
        panel.querySelector(".thinking-toggle").addEventListener("click", () => {
          panel.classList.toggle("is-expanded");
        });
        content.append(panel);
      }

      // Render markdown content
      const mdDiv = document.createElement("div");
      mdDiv.innerHTML = renderMarkdown(msg.content || "");
      content.append(mdDiv);
      if (Array.isArray(msg.recoveryActions) && msg.recoveryActions.length) {
        content.append(renderRecoveryActions(msg.recoveryActions));
      }
    }

    transcript.append(node);
  }
  transcript.scrollTop = transcript.scrollHeight;
}

function renderRecoveryActions(actions) {
  const wrap = document.createElement("div");
  wrap.className = "msg-recovery-actions";
  for (const action of actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `msg-recovery-btn${action.tone === "primary" ? " is-primary" : ""}`;
    btn.textContent = action.label || "操作";
    btn.addEventListener("click", () => handleRecoveryAction(action.action));
    wrap.append(btn);
  }
  return wrap;
}

function handleRecoveryAction(action) {
  if (action === "retry") deps.retryLastPrompt?.();
  else if (action === "diagnostics") deps.openSettings?.("diagnostics");
  else if (action === "security") deps.openSettings?.("diagnostics");
  else if (action === "replay") openReplayPanel();
  else if (action === "providers") deps.openSettings?.("providers");
}

function lastAssistantMessage() {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (state.messages[i]?.role === "assistant") return state.messages[i];
  }
  return null;
}

export function startReplayRun(meta = {}) {
  const msg = lastAssistantMessage();
  if (!msg) return;
  msg.replay = {
    id: meta.runId || crypto.randomUUID(),
    status: "running",
    startedAt: Date.now(),
    finishedAt: 0,
    meta: {
      prompt: meta.prompt || "",
      cwd: meta.cwd || state.cwd || "",
      permissionMode: meta.permissionMode || state.permissionMode || "auto",
      provider: meta.provider || "",
      sessionId: meta.sessionId || state.selectedSession || "",
      source: meta.source || "chat",
    },
    events: [],
    touchedFiles: [],
  };
  save();
}

export function recordReplayEvent(event = {}) {
  const msg = lastAssistantMessage();
  if (!msg?.replay) return;
  const item = {
    type: event.type || "info",
    title: event.title || "事件",
    detail: event.detail || "",
    at: event.at || Date.now(),
  };
  msg.replay.events.push(item);
  if (Array.isArray(event.paths)) {
    const next = new Set(msg.replay.touchedFiles || []);
    event.paths.forEach(path => { if (path) next.add(path); });
    msg.replay.touchedFiles = [...next].slice(0, 80);
  }
  if (msg.replay.events.length > 240) msg.replay.events = msg.replay.events.slice(-240);
  save();
}

export function finishReplayRun(result = {}) {
  const msg = lastAssistantMessage();
  if (!msg?.replay) return;
  msg.replay.status = result.ok ? "done" : "error";
  msg.replay.finishedAt = Date.now();
  if (result.error || result.stderr) msg.replay.error = String(result.error || result.stderr).slice(0, 1000);
  save();
}

function replayRuns() {
  return (state.messages || [])
    .map((msg, messageIndex) => ({ messageIndex, replay: msg.replay, content: msg.content || "" }))
    .filter(item => item.replay)
    .reverse();
}

function replayDuration(replay) {
  const end = replay.finishedAt || Date.now();
  const seconds = Math.max(1, Math.round((end - replay.startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function replayStatusLabel(status) {
  if (status === "done") return "已完成";
  if (status === "error") return "失败";
  return "运行中";
}

function replayEventIcon(type) {
  if (type === "success") return "OK";
  if (type === "error") return "ER";
  if (type === "warn") return "!";
  if (type === "tool") return "TL";
  return "IN";
}

function renderReplayDetail(run) {
  const detail = replayOverlay?.querySelector("#replayDetail");
  if (!detail) return;
  if (!run) {
    detail.innerHTML = `<div class="replay-empty">当前对话还没有可回放的运行记录。</div>`;
    return;
  }
  const replay = run.replay;
  const events = replay.events || [];
  const touchedFiles = replay.touchedFiles || [];
  detail.innerHTML = `
    <div class="replay-detail-head">
      <div>
        <b>${escapeHtml(replay.meta?.source === "agent-task" ? "Agent Task" : "Claude Code Run")} · ${replayStatusLabel(replay.status)}</b>
        <span>${escapeHtml(replay.meta?.cwd || "--")}</span>
      </div>
      <div class="replay-stats">
        <span>${events.length} 事件</span>
        <span>${touchedFiles.length} 文件</span>
        <span>${replayDuration(replay)}</span>
      </div>
    </div>
    <div class="replay-meta-grid">
      <div><span>权限</span><b>${escapeHtml(replay.meta?.permissionMode || "auto")}</b></div>
      <div><span>Provider</span><b>${escapeHtml(replay.meta?.provider || "--")}</b></div>
      <div><span>Session</span><b>${escapeHtml(replay.meta?.sessionId || "--")}</b></div>
    </div>
    ${touchedFiles.length ? `<div class="replay-files">${touchedFiles.slice(0, 16).map(path => `<button type="button" class="replay-file" title="${escapeHtml(path)}">${escapeHtml(basename(path))}</button>`).join("")}</div>` : ""}
    <div class="replay-events">
      ${events.length ? events.map(item => `
        <div class="replay-event is-${escapeHtml(item.type || "info")}">
          <span class="replay-event-icon">${replayEventIcon(item.type)}</span>
          <div>
            <b>${escapeHtml(item.title || "事件")}</b>
            ${item.detail ? `<span>${escapeHtml(item.detail)}</span>` : ""}
            <em>${new Date(item.at || replay.startedAt).toLocaleTimeString()}</em>
          </div>
        </div>
      `).join("") : `<div class="replay-empty">这次运行没有捕获到事件。</div>`}
    </div>
  `;
  const bridge = getBridge();
  [...detail.querySelectorAll(".replay-file")].forEach((node, index) => {
    node.addEventListener("click", () => bridge?.openPath?.(touchedFiles[index]));
  });
}

function ensureReplayOverlay() {
  if (replayOverlay) return replayOverlay;
  replayOverlay = document.createElement("div");
  replayOverlay.className = "replay-overlay";
  replayOverlay.id = "sessionReplayOverlay";
  replayOverlay.innerHTML = `
    <div class="replay-dialog" role="dialog" aria-modal="true" aria-label="会话回放">
      <div class="replay-head">
        <div>
          <b>会话回放</b>
          <span>复盘每次 Claude Code 运行的权限、工具调用、变更材料和结束状态。</span>
        </div>
        <button class="topbar-btn" id="closeReplayBtn" type="button" title="关闭">×</button>
      </div>
      <div class="replay-tools">
        <input id="replaySearchInput" type="search" placeholder="搜索提示词、事件、文件...">
        <div class="replay-filter" id="replayFilter">
          <button class="is-active" data-filter="all" type="button">全部</button>
          <button data-filter="running" type="button">运行中</button>
          <button data-filter="done" type="button">完成</button>
          <button data-filter="error" type="button">失败</button>
        </div>
        <button class="st-btn t-btn--link t-btn--sm" id="copyReplayAuditBtn" type="button" disabled>复制审计</button>
      </div>
      <div class="replay-layout">
        <div class="replay-list" id="replayList"></div>
        <div class="replay-detail" id="replayDetail"></div>
      </div>
    </div>
  `;
  document.body.append(replayOverlay);
  replayOverlay.addEventListener("click", e => {
    if (e.target === replayOverlay) closeReplayPanel();
  });
  replayOverlay.querySelector("#closeReplayBtn")?.addEventListener("click", closeReplayPanel);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && replayOverlay?.classList.contains("is-open")) closeReplayPanel();
  });
  return replayOverlay;
}

export function openReplayPanel() {
  const overlay = ensureReplayOverlay();
  const allRuns = replayRuns();
  const list = overlay.querySelector("#replayList");
  const input = overlay.querySelector("#replaySearchInput");
  const filters = overlay.querySelector("#replayFilter");
  const copyBtn = overlay.querySelector("#copyReplayAuditBtn");
  overlay.classList.add("is-open");
  if (!allRuns.length) {
    list.innerHTML = `<div class="replay-empty">运行一次任务后，这里会出现可复盘时间线。</div>`;
    renderReplayDetail(null);
    return;
  }
  let active = 0;
  let filter = "all";
  let query = "";
  let activeRun = null;
  const matches = (run) => {
    const replay = run.replay;
    if (filter !== "all" && replay.status !== filter) return false;
    if (!query) return true;
    const haystack = [
      replay.status,
      replay.meta?.prompt,
      replay.meta?.cwd,
      replay.meta?.provider,
      ...(replay.touchedFiles || []),
      ...(replay.events || []).flatMap(item => [item.title, item.detail]),
    ].join(" ").toLowerCase();
    return haystack.includes(query);
  };
  const paint = () => {
    const runs = allRuns.filter(matches);
    if (active >= runs.length) active = 0;
    if (!runs.length) {
      list.innerHTML = `<div class="replay-empty">没有匹配的运行记录。</div>`;
      activeRun = null;
      copyBtn.disabled = true;
      renderReplayDetail(null);
      return;
    }
    list.innerHTML = runs.map((run, index) => `
      <button class="replay-run${index === active ? " is-active" : ""}" data-index="${index}" type="button">
        <span>${replayStatusLabel(run.replay.status)}</span>
        <b>${escapeHtml((run.replay.meta?.prompt || run.content || "Claude Code Run").slice(0, 82))}</b>
        <em>${new Date(run.replay.startedAt).toLocaleString()} · ${replayDuration(run.replay)}</em>
      </button>
    `).join("");
    [...list.querySelectorAll(".replay-run")].forEach(btn => {
      btn.addEventListener("click", () => {
        active = Number(btn.dataset.index || 0);
        paint();
      });
    });
    activeRun = runs[active];
    copyBtn.disabled = false;
    renderReplayDetail(activeRun);
  };
  copyBtn.onclick = async () => {
    if (!activeRun) return;
    const text = JSON.stringify(activeRun.replay, null, 2);
    const r = await getBridge()?.copyText?.(text);
    toast(r?.ok ? "回放审计 JSON 已复制" : "复制失败", r?.ok ? "success" : "error");
  };
  input.value = "";
  input.oninput = () => {
    query = input.value.trim().toLowerCase();
    active = 0;
    paint();
  };
  filters.querySelectorAll("button").forEach(btn => {
    btn.onclick = () => {
      filter = btn.dataset.filter || "all";
      filters.querySelectorAll("button").forEach(item => item.classList.toggle("is-active", item === btn));
      active = 0;
      paint();
    };
  });
  paint();
}

export function closeReplayPanel() {
  replayOverlay?.classList.remove("is-open");
}

export function addAttachments(paths) {
  const next = paths.map(path => String(path || "").trim()).filter(Boolean);
  if (!next.length) return;
  attachedFiles = [...new Set([...attachedFiles, ...next])];
  renderAttachments();
  deps.renderArtifacts?.();
}

export function renderAttachments() {
  const tray = $("#attachmentTray");
  if (!tray) return;
  tray.classList.toggle("has-items", attachedFiles.length > 0);
  tray.innerHTML = "";
  attachedFiles.forEach((path, index) => {
    const chip = document.createElement("div");
    chip.className = "attachment-chip";
    chip.innerHTML = `<span title="${escapeHtml(path)}">${escapeHtml(basename(path))}</span><button type="button" title="移除">x</button>`;
    chip.querySelector("button").addEventListener("click", () => {
      attachedFiles = attachedFiles.filter((_, i) => i !== index);
      renderAttachments();
      deps.renderArtifacts?.();
    });
    tray.append(chip);
  });
}

export function promptWithAttachments(prompt) {
  if (!attachedFiles.length) return prompt;
  const files = attachedFiles.map(path => `- ${path}`).join("\n");
  return `${prompt}\n\n附加文件/多模态输入：\n${files}\n\n请根据这些本地文件路径读取、分析或处理相关内容；如果是图片、PDF、音频或其他非文本文件，请按 Claude Code 支持的方式使用这些文件。`;
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

function conversationTitle() {
  const project = data.projects.find(p => p.id === state.selectedProject);
  const base = project?.name || basename(state.cwd) || "conversation";
  return String(base).replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "") || "conversation";
}

export function buildConversationAudit() {
  const provider = data.providers.find(p => p.current) || data.providers[0] || null;
  const identity = data.identities.find(i => i.active) || null;
  const git = data.diagnostics?.git || null;
  return {
    exportedAt: new Date().toISOString(),
    project: { cwd: state.cwd || "", selectedProject: state.selectedProject || "" },
    session: { id: state.selectedSession || "", path: state.selectedSessionPath || "", mode: state.mode || "normal" },
    runtime: {
      provider: provider ? { id: provider.id, name: provider.name, model: provider.model || "" } : null,
      identity: identity ? { id: identity.id, name: identity.name, icon: identity.icon || "" } : null,
      permissionMode: state.permissionMode || "auto",
      runnerStrategy: state.runnerStrategy || "",
      git,
    },
    attachments: [...attachedFiles],
    messages: (state.messages || []).map((msg, index) => ({
      index,
      role: msg.role,
      content: msg.content || "",
      contentLength: String(msg.content || "").length,
      replay: msg.replay ? {
        id: msg.replay.id,
        status: msg.replay.status,
        startedAt: msg.replay.startedAt,
        finishedAt: msg.replay.finishedAt,
        meta: msg.replay.meta,
        touchedFiles: msg.replay.touchedFiles || [],
        events: msg.replay.events || [],
      } : null,
    })),
  };
}

function conversationToMarkdown(audit) {
  const lines = [
    `# Claude Code Studio Conversation`,
    "",
    `- Exported: ${audit.exportedAt}`,
    `- Project: ${audit.project.cwd || "--"}`,
    `- Session: ${audit.session.id || "--"}`,
    `- Provider: ${audit.runtime.provider?.name || "--"}${audit.runtime.provider?.model ? ` / ${audit.runtime.provider.model}` : ""}`,
    `- Identity: ${audit.runtime.identity?.name || "--"}`,
    `- Permission: ${audit.runtime.permissionMode}`,
  ];
  if (audit.runtime.git?.ok) {
    lines.push(`- Git: ${audit.runtime.git.branch || "detached"} · ${audit.runtime.git.dirty ? `${audit.runtime.git.changedFiles} changed` : "clean"}`);
  }
  if (audit.attachments.length) {
    lines.push("", "## Attachments", ...audit.attachments.map(path => `- ${path}`));
  }
  lines.push("", "## Messages");
  for (const msg of audit.messages) {
    lines.push("", `### ${msg.role === "user" ? "User" : "Assistant"} ${msg.index + 1}`, "", msg.content || "");
    if (msg.replay?.events?.length) {
      lines.push("", "#### Run Replay");
      lines.push(`- Status: ${msg.replay.status}`);
      lines.push(`- Permission: ${msg.replay.meta?.permissionMode || "--"}`);
      lines.push(`- Duration: ${replayDuration(msg.replay)}`);
      if (msg.replay.touchedFiles?.length) lines.push(`- Files: ${msg.replay.touchedFiles.length}`);
      for (const event of msg.replay.events.slice(-80)) {
        lines.push(`- ${new Date(event.at).toLocaleTimeString()} · ${event.title}${event.detail ? `: ${event.detail}` : ""}`);
      }
    }
  }
  return lines.join("\n");
}

export async function exportConversation(format = "md") {
  if (!state.messages.length) {
    toast("当前还没有可导出的对话。", "info");
    return;
  }
  const audit = buildConversationAudit();
  const title = conversationTitle();
  if (format === "json") {
    downloadText(`${title}-conversation.json`, JSON.stringify(audit, null, 2), "application/json");
  } else {
    downloadText(`${title}-conversation.md`, conversationToMarkdown(audit), "text/markdown");
  }
  toast("对话已导出", "success");
}
