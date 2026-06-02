import { data, save, state } from "./state.js";
import { getBridge, safeBridge, curProvider } from "./bridge.js";
import { $, toast } from "./helpers.js";
import { escapeHtml } from "../markdown.js";

// Module-local state
export let currentRunId = "";
export let assistantBuffer = "";
export let liveThinking = [];

// Dependency injection
let deps = {};
export function configure(d) { deps = d; }

export function getCurrentRunId() { return currentRunId; }
export function getAssistantBuffer() { return assistantBuffer; }
export function getLiveThinking() { return liveThinking; }

export function setMode(m) { state.mode = m; save(); }

export function setPerm(pm) {
  state.permissionMode = pm;
  save();
  const pill = $("#modePill");
  const labels = { plan: "Plan", auto: "Auto", bypass: "Bypass" };
  pill.textContent = labels[pm] || "Auto";
  pill.className = `mode-pill${pm === "plan" ? " is-plan" : pm === "bypass" ? " is-bypass" : ""}`;
  deps.updatePermDropdown?.(pm);
}

export async function submitPrompt(e) {
  e?.preventDefault();
  const prompt = $("#promptInput").value.trim();
  if (!prompt) return;
  if (!state.cwd) { toast("请先在设置中选择项目", "error"); return; }
  state.pendingPlanPrompt = state.permissionMode === "plan" ? prompt : "";
  save();
  const bridge = getBridge();
  const p = curProvider();
  if (p) await deps.switchProvider?.(p.id);
  $("#promptInput").value = "";
  autosize();
  const finalPrompt = deps.promptWithAttachments?.(prompt) || prompt;
  state.messages.push({ role: "user", content: finalPrompt }, { role: "assistant", content: "" });
  save();
  deps.renderMessages?.();
  assistantBuffer = "";
  liveThinking = [];
  currentRunId = crypto.randomUUID();
  deps.setRunTimeline?.([]);
  deps.setRunTouchedFiles?.([]);
  deps.setLastTimelineKey?.("");
  deps.addTimeline?.("info", "提交任务", deps.compactPath?.(state.cwd));
  setRunning(true);
  pushThink("正在准备项目上下文与当前身份");

  if (!bridge?.runClaude) { updateLast("桥接未就绪"); setRunning(false); return; }
  const activeId = data.identities.find(i => i.active);
  if (activeId) await safeBridge("syncIdentitySkills", null, activeId.id);
  const canResume = await deps.validateActiveSession?.();
  const resumeSessionId = canResume ? state.selectedSession || "" : "";

  const r = await bridge.runClaude({
    runId: currentRunId, prompt: finalPrompt, cwd: state.cwd, claudePath: state.claudePath,
    mode: resumeSessionId ? "continue" : (state.mode === "continue" ? "normal" : state.mode),
    permissionMode: state.permissionMode || "auto",
    runnerStrategy: state.runnerStrategy || "seamless",
    providerId: p?.id || "", sessionId: resumeSessionId,
    clientSessionKey: resumeSessionId || state.clientSessionKey, extraArgs: [],
  });
  if (!r.ok) {
    if (r.code === "SESSION_MISSING") deps.recoverMissingSession?.(r.error);
    deps.addTimeline?.("error", "准备失败", friendlyRunError(r.error));
    updateLast(`失败：${friendlyRunError(r.error)}`);
    setRunning(false);
  } else {
    deps.setAttachedFiles?.([]);
    deps.renderAttachments?.();
    deps.renderArtifacts?.();
  }
}

export function setRunning(on) {
  const btn = $("#runStopBtn");
  if (on) {
    btn.className = "run-stop-btn is-stop";
    btn.textContent = "■";
    btn.title = "停止";
    btn.type = "button";
  } else {
    btn.className = "run-stop-btn is-send";
    btn.textContent = "↑";
    btn.title = "发送";
    btn.type = "submit";
  }
  $("#runnerPill").textContent = on ? "运行中" : "未连接";
  $("#runnerPill").className = `cfoot-pill${on ? " is-busy" : ""}`;
  deps.renderContextStack?.();
}

export function updateLast(content) {
  const last = state.messages[state.messages.length - 1];
  if (last?.role === "assistant") { last.content = content; save(); deps.renderMessages?.(); }
}

export function friendlyProgress(text) {
  return String(text || "")
    .replace(/启动中/g, "准备上下文")
    .replace(/启动/g, "准备")
    .replace(/复用 runner/gi, "继续处理")
    .replace(/runner/gi, "工作进程")
    .replace(/进程已退出/g, "已完成");
}

export function pushThink(v) {
  const text = friendlyProgress(v);
  if (!text || liveThinking[liveThinking.length - 1] === text) return;
  liveThinking.push(text);
  if (liveThinking.length > 8) liveThinking.shift();
  const last = state.messages[state.messages.length - 1];
  if (last?.role === "assistant") last.thinking = [...liveThinking];
  deps.renderMessages?.();
}

export function clearThink() {
  if (liveThinking.length) {
    const last = state.messages[state.messages.length - 1];
    if (last?.role === "assistant") last.thinking = [...liveThinking];
    liveThinking = [];
    save();
    deps.renderMessages?.();
  }
}

export function autosize() {
  const ta = $("#promptInput");
  ta.style.height = "auto";
  ta.style.height = `${Math.min(90, ta.scrollHeight)}px`;
}

export function onClaudeEvent(payload) {
  if (payload.runId !== currentRunId) return;
  deps.timelineFromClaudeEvent?.(payload.event, payload);
  const sid = payload.event?.session_id || payload.event?.sessionId;
  if (sid && !state.selectedSession) { state.selectedSession = sid; save(); }
  if (payload.progress) {
    const label = friendlyProgress(payload.progress);
    const hot = payload.status === "running" || label.includes("继续");
    $("#runnerPill").textContent = label;
    $("#runnerPill").className = `cfoot-pill ${hot ? "is-hot" : "is-busy"}`;
  }
  if (payload.activity) pushThink(payload.activity);
  else if (payload.progress && !payload.text) pushThink(payload.progress);
  if (payload.text) { clearThink(); if (payload.partial && payload.text.startsWith(assistantBuffer)) assistantBuffer = payload.text; else if (!assistantBuffer.endsWith(payload.text)) assistantBuffer += payload.text; updateLast(assistantBuffer); return; }
  if (payload.event?.type === "result" && payload.event?.result && !assistantBuffer) { clearThink(); assistantBuffer = payload.event.result; updateLast(assistantBuffer); }
}

export function onClaudeStderr(p) {
  if (p.runId !== currentRunId || assistantBuffer) return;
  const text = String(p.text || "").trim().slice(0, 120);
  if (text) deps.addTimeline?.("warn", "进程输出", text);
  pushThink(`${text}`);
}

export function handleAskUser(payload) {
  if (payload.runId !== currentRunId) return;
  const bridge = getBridge();
  const { toolUseId, questions } = payload;
  const overlay = $("#askOverlay");
  const container = $("#askQuestions");
  container.innerHTML = "";
  for (const q of questions) {
    const label = document.createElement("div");
    label.className = "ask-question-label";
    label.textContent = q.question || "请选择";
    container.appendChild(label);
    const opts = document.createElement("div");
    opts.className = "ask-options";
    for (const opt of (q.options || [])) {
      const btn = document.createElement("div");
      btn.className = "ask-option";
      btn.innerHTML = `<div class="ask-option-label">${escapeHtml(opt.label || "")}</div>${opt.description ? `<div class="ask-option-desc">${escapeHtml(opt.description)}</div>` : ""}`;
      btn.addEventListener("click", async () => {
        overlay.classList.remove("is-open");
        deps.addTimeline?.("info", "用户选择", opt.label);
        await safeBridge("answerQuestion", null, { runId: currentRunId, toolUseId, answer: opt.label });
      });
      opts.appendChild(btn);
    }
    container.appendChild(opts);
  }
  overlay.classList.add("is-open");
}

export function friendlyRunError(raw) {
  const text = String(raw || "").trim();
  if (/No conversation found with session ID/i.test(text)) {
    deps.recoverMissingSession?.(text);
    return "这个历史对话已经找不到了，我已切换到新对话。请重新发送这条任务。";
  }
  if (/ENOENT|not recognized|command not found|找不到/i.test(text)) return "没有找到 Claude Code。请到诊断页点击[检测 Claude]，或手动设置 Claude 路径。";
  if (/permission|denied|EPERM|EACCES/i.test(text)) return `权限不足：${text.slice(0, 220)}`;
  if (/timed out|timeout/i.test(text)) return "模型准备或响应超时，请检查网络、Provider 和当前项目目录。";
  return text ? text.slice(0, 260) : "工作进程结束，但没有提供错误信息。";
}

export function onClaudeDone(p) {
  if (p.runId !== currentRunId) return;

  if (p.retried && p.ok) {
    toast("连接已恢复", "success");
  }

  if (!p.ok && !assistantBuffer) {
    const errMsg = friendlyRunError(p.stderr || p.error);
    deps.addTimeline?.("error", "运行失败", errMsg);
    const retryMsg = p.retried ? "（已重试）" : "";
    updateLast(`连接中断${retryMsg}：${errMsg}`);
    pushThink("按 Enter 重新发送，或点击右下角状态重新连接");
  }

  if (p.ok && !assistantBuffer) {
    const stderr = String(p.stderr || "").trim();
    updateLast(stderr ? `任务已结束，但没有返回正文。\n\n诊断信息：${friendlyRunError(stderr)}` : "任务已结束，但这次没有返回正文。");
  }

  if (p.ok) deps.addTimeline?.("success", "运行结束", "已完成");

  currentRunId = "";
  setRunning(false);
  clearThink();

  const pill = $("#runnerPill");
  pill.textContent = p.keptAlive ? "复用" : (p.ok ? "就绪" : "断开");
  pill.className = `cfoot-pill${p.keptAlive ? " is-hot" : ""}${!p.ok ? " is-error" : ""}`;
}

export function initChatEngine() {
  const bridge = getBridge();

  // Runner pill reconnect
  $("#runnerPill").addEventListener("click", async () => {
    if (!bridge?.reconnectClaude) return;
    await bridge.reconnectClaude();
    toast("已断开所有 Runner 连接", "info");
    $("#runnerPill").textContent = "未连接";
    $("#runnerPill").className = "cfoot-pill";
    currentRunId = "";
    setRunning(false);
  });

  // Composer events
  $("#composer").addEventListener("submit", submitPrompt);
  $("#promptInput").addEventListener("input", autosize);
  $("#promptInput").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#composer").requestSubmit(); } });
  const composerBox = $(".composer");
  for (const eventName of ["dragenter", "dragover"]) {
    composerBox?.addEventListener(eventName, e => {
      e.preventDefault();
      composerBox.classList.add("is-dragging");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    composerBox?.addEventListener(eventName, e => {
      e.preventDefault();
      composerBox.classList.remove("is-dragging");
    });
  }
  composerBox?.addEventListener("drop", e => {
    const paths = [...(e.dataTransfer?.files || [])].map(file => file.path || file.name).filter(Boolean);
    deps.addAttachments?.(paths);
    if (paths.length) toast(`已添加 ${paths.length} 个文件`, "success");
  });

  // Bridge event subscriptions
  if (bridge) {
    bridge.onClaudeEvent(onClaudeEvent);
    bridge.onClaudeStderr(onClaudeStderr);
    bridge.onClaudeDone(onClaudeDone);
    bridge.onAskUser?.(handleAskUser);
  }
}
