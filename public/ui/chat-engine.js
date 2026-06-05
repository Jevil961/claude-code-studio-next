import { data, save, state } from "./state.js";
import { getBridge, safeBridge, curProvider } from "./bridge.js";
import { $, toast } from "./helpers.js";
import { escapeHtml } from "../markdown.js";
import { checkSlashTrigger, handleSlashKeydown, hideSlashPopup, isSlashVisible } from "./slash-commands.js";
import { sendNotification } from "./notifications.js";

// Module-local state
export let currentRunId = "";
export let assistantBuffer = "";
export let liveThinking = [];
let stepDoneResolve = null;

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

async function handleLocalCommand(prompt) {
  const pluginMatch = prompt.match(/^\/plugin(?:\s+(.+))?$/i);
  if (pluginMatch) {
    const name = pluginMatch[1]?.trim();
    if (!name) {
      deps.openSettings?.("plugins");
      toast("输入 /plugin name@marketplace 可直接调用 Claude CLI 安装官方插件。", "info");
      return true;
    }
    toast(`正在安装插件：${name}`);
    const r = await safeBridge("installPluginByName", null, name);
    if (r.ok) {
      toast(`插件已安装：${name}`, "success");
      await deps.loadPlugins?.();
      deps.openSettings?.("plugins");
    } else {
      toast(r.error || "插件安装失败，请确认名称来自官方 Claude 插件市场。", "error");
    }
    return true;
  }
  if (/^\/replay$/i.test(prompt)) {
    deps.openReplayPanel?.();
    return true;
  }
  if (/^\/security$/i.test(prompt)) {
    deps.openSettings?.("diagnostics");
    return true;
  }
  if (/^\/window$/i.test(prompt)) {
    const r = await getBridge()?.openWorkspaceWindow?.(state.cwd || "");
    toast(r?.ok ? "已打开新的本地工作区窗口" : (r?.error || "当前运行环境不支持多窗口"), r?.ok ? "success" : "error");
    return true;
  }
  return false;
}

export async function submitPrompt(e) {
  e?.preventDefault();
  if (currentRunId) {
    toast("当前任务还在运行，请先停止或等待完成。", "info");
    return;
  }
  const prompt = $("#promptInput").value.trim();
  if (!prompt) return;
  if (await handleLocalCommand(prompt)) {
    $("#promptInput").value = "";
    autosize();
    return;
  }
  if (!state.cwd) { toast("请先选择或添加一个项目目录。", "error"); return; }
  const providerReady = Boolean(curProvider());
  if (!providerReady) {
    toast("还没有配置 Provider。可以继续尝试使用默认 Claude，但建议先配置模型服务。", "info");
  }
  const git = data.diagnostics?.git;
  if (git?.ok && git.counts?.conflicted) {
    toast("当前 Git 工作区存在冲突，请先解决冲突再运行 Agent。", "error");
    return;
  }
  if (!state.claudePath && !data.diagnostics?.claudePath) {
    toast("尚未检测到 Claude Code，可到诊断页检测或安装。", "info");
  }
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
  setRunning(true);
  pushThink("正在准备项目上下文与当前身份");

  if (!bridge?.runClaude) {
    deps.addTimeline?.("error", "启动失败", "桌面桥接还没有准备好");
    updateLast("桌面桥接还没有准备好。请稍等几秒后重试，或打开诊断页检查运行环境。");
    setLastRecoveryActions([
      { label: "打开诊断", action: "diagnostics", tone: "primary" },
      { label: "重试", action: "retry" },
    ]);
    setRunning(false);
    return;
  }
  const activeId = data.identities.find(i => i.active);
  if (activeId) await safeBridge("syncIdentitySkills", null, activeId.id);
  const canResume = await deps.validateActiveSession?.();
  const resumeSessionId = canResume ? state.selectedSession || "" : "";
  deps.startReplayRun?.({
    runId: currentRunId,
    prompt: finalPrompt,
    cwd: state.cwd,
    permissionMode: state.permissionMode || "auto",
    provider: p?.name || "",
    sessionId: resumeSessionId,
    source: "chat",
  });
  deps.addTimeline?.("info", "提交任务", deps.compactPath?.(state.cwd));

  let r;
  try {
    r = await bridge.runClaude({
      runId: currentRunId, prompt: finalPrompt, cwd: state.cwd, claudePath: state.claudePath,
      mode: resumeSessionId ? "continue" : (state.mode === "continue" ? "normal" : state.mode),
      permissionMode: state.permissionMode || "auto",
      runnerStrategy: state.runnerStrategy || "seamless",
      providerId: p?.id || "", sessionId: resumeSessionId,
      clientSessionKey: resumeSessionId || state.clientSessionKey, extraArgs: [],
    });
  } catch (error) {
    r = { ok: false, error: error?.message || String(error || "runClaude failed") };
  }
  if (!r.ok) {
    if (r.code === "SESSION_MISSING") deps.recoverMissingSession?.(r.error);
    deps.addTimeline?.("error", "准备失败", friendlyRunError(r.error));
    deps.finishReplayRun?.({ ok: false, error: r.error || "runClaude failed" });
    updateLast(`失败：${friendlyRunError(r.error)}`);
    setLastRecoveryActions([
      { label: "重试", action: "retry", tone: "primary" },
      { label: "打开诊断", action: "diagnostics" },
      { label: "查看回放", action: "replay" },
    ]);
    setRunning(false);
  } else {
    clearLastRecoveryActions();
    deps.setAttachedFiles?.([]);
    deps.renderAttachments?.();
    deps.renderArtifacts?.();
  }
}

export function isRunning() { return currentRunId !== ""; }

export async function runStepAsync(prompt, { providerId, permissionMode, cwd } = {}) {
  if (!prompt) return { ok: false, output: "", error: "empty prompt" };
  const bridge = getBridge();
  if (!bridge?.runClaude) return { ok: false, output: "", error: "bridge not ready" };

  // Push user + assistant messages
  state.messages.push({ role: "user", content: prompt }, { role: "assistant", content: "" });
  save();
  deps.renderMessages?.();

  assistantBuffer = "";
  liveThinking = [];
  currentRunId = crypto.randomUUID();
  deps.setRunTimeline?.([]);
  deps.setRunTouchedFiles?.([]);
  deps.setLastTimelineKey?.("");
  const provider = data.providers.find(p => p.id === providerId) || curProvider();
  deps.startReplayRun?.({
    runId: currentRunId,
    prompt,
    cwd: cwd || state.cwd,
    permissionMode: permissionMode || state.permissionMode || "auto",
    provider: provider?.name || "",
    sessionId: "",
    source: "agent-task",
  });
  setRunning(true);
  pushThink("正在准备项目上下文");

  const r = await bridge.runClaude({
    runId: currentRunId, prompt, cwd: cwd || state.cwd, claudePath: state.claudePath || "",
    mode: "normal", permissionMode: permissionMode || state.permissionMode || "auto",
    runnerStrategy: state.runnerStrategy || "seamless",
    providerId: providerId || "", sessionId: "", clientSessionKey: state.clientSessionKey, extraArgs: [],
  });

  if (!r.ok) {
    deps.addTimeline?.("error", "准备失败", friendlyRunError(r.error));
    deps.finishReplayRun?.({ ok: false, error: r.error || "runClaude failed" });
    setRunning(false);
    return { ok: false, output: "", error: r.error || "runClaude failed" };
  }

  // Wait for claude:done event
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      stepDoneResolve = null;
      setRunning(false);
      resolve({ ok: false, output: assistantBuffer, error: "timeout" });
    }, 300000); // 5 min timeout per step

    stepDoneResolve = (result) => {
      clearTimeout(timeout);
      resolve(result);
    };
  });
}

export function setRunning(on) {
  const btn = $("#runStopBtn");
  if (btn) {
    if (on) {
      btn.className = "run-stop-btn is-stop";
      btn.innerHTML = '<span aria-hidden="true">■</span>';
      btn.title = "停止";
      btn.setAttribute('aria-label', '停止运行');
      btn.type = "button";
    } else {
      btn.className = "run-stop-btn is-send";
      btn.innerHTML = '<span aria-hidden="true">↑</span>';
      btn.title = "发送";
      btn.setAttribute('aria-label', '发送消息');
      btn.type = "submit";
    }
  }
  const pill = $("#runnerPill");
  if (pill) {
    pill.textContent = on ? "运行中" : "未连接";
    pill.className = `cfoot-pill${on ? " is-busy" : ""}`;
  }
  deps.renderContextStack?.();
}

export function updateLast(content) {
  const last = state.messages[state.messages.length - 1];
  if (last?.role === "assistant") { last.content = content; save(); deps.renderMessages?.(); }
}

function setLastRecoveryActions(actions = []) {
  const last = state.messages[state.messages.length - 1];
  if (last?.role !== "assistant") return;
  last.recoveryActions = actions;
  save();
  deps.renderMessages?.();
}

function clearLastRecoveryActions() {
  const last = state.messages[state.messages.length - 1];
  if (last?.role !== "assistant" || !last.recoveryActions) return;
  delete last.recoveryActions;
  save();
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
    const rp = $("#runnerPill");
    if (rp) { rp.textContent = label; rp.className = `cfoot-pill ${hot ? "is-hot" : "is-busy"}`; }
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
    setLastRecoveryActions([
      { label: "重试", action: "retry", tone: "primary" },
      { label: "打开诊断", action: "diagnostics" },
      { label: "安全中心", action: "security" },
      { label: "查看回放", action: "replay" },
    ]);
    pushThink("按 Enter 重新发送，或点击右下角状态重新连接");
    // Show error toast with retry button
    toast(`运行失败：${errMsg}`, "error", () => retryLastPrompt());
    sendNotification("Claude Code Studio", `任务失败：${errMsg.slice(0, 80)}`);
  }

  if (p.ok && !assistantBuffer) {
    const stderr = String(p.stderr || "").trim();
    updateLast(stderr ? `任务已结束，但没有返回正文。\n\n诊断信息：${friendlyRunError(stderr)}` : "任务已结束，但这次没有返回正文。");
    setLastRecoveryActions([
      { label: "查看回放", action: "replay", tone: "primary" },
      { label: "重试", action: "retry" },
    ]);
  }

  if (p.ok) {
    if (assistantBuffer) clearLastRecoveryActions();
    deps.addTimeline?.("success", "运行结束", "已完成");
    sendNotification("Claude Code Studio", "任务已完成");
  }

  currentRunId = "";
  deps.finishReplayRun?.({ ok: p.ok, stderr: p.stderr || "", error: p.error || "" });
  setRunning(false);
  clearThink();

  const pill = $("#runnerPill");
  if (pill) {
    pill.textContent = p.keptAlive ? "复用" : (p.ok ? "就绪" : "断开");
    pill.className = `cfoot-pill${p.keptAlive ? " is-hot" : ""}${!p.ok ? " is-error" : ""}`;
  }

  // Resolve team workflow step promise
  if (stepDoneResolve) {
    const resolve = stepDoneResolve;
    stepDoneResolve = null;
    resolve({ ok: p.ok, output: assistantBuffer, stderr: p.stderr || "" });
  }
}

export function retryLastPrompt() {
  // Find last user message
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (state.messages[i].role === 'user') {
      const input = $("#promptInput");
      if (input) {
        input.value = state.messages[i].content;
        autosize();
        submitPrompt();
      }
      return;
    }
  }
}

// Input history
const inputHistory = [];
let historyIndex = -1;

function pushHistory(text) {
  if (!text.trim()) return;
  if (inputHistory[inputHistory.length - 1] === text) return;
  inputHistory.push(text);
  if (inputHistory.length > 50) inputHistory.shift();
  historyIndex = -1;
}

function navigateHistory(direction) {
  const input = $("#promptInput");
  if (!input) return;
  if (!inputHistory.length) return;

  if (direction === 'up') {
    if (historyIndex === -1) historyIndex = inputHistory.length - 1;
    else if (historyIndex > 0) historyIndex--;
  } else {
    if (historyIndex === -1) return;
    if (historyIndex < inputHistory.length - 1) historyIndex++;
    else { historyIndex = -1; input.value = ''; autosize(); return; }
  }

  input.value = inputHistory[historyIndex] || '';
  autosize();
  // Move cursor to end
  input.setSelectionRange(input.value.length, input.value.length);
}

export function initChatEngine() {
  const bridge = getBridge();

  // Runner pill reconnect
  $("#runnerPill")?.addEventListener("click", async () => {
    if (!bridge?.reconnectClaude) return;
    await bridge.reconnectClaude();
    toast("已断开所有 Runner 连接", "info");
    $("#runnerPill").textContent = "未连接";
    $("#runnerPill").className = "cfoot-pill";
    currentRunId = "";
    setRunning(false);
  });

  // Composer events
  $("#composer").addEventListener("submit", (e) => {
    const prompt = $("#promptInput").value.trim();
    if (prompt) pushHistory(prompt);
    submitPrompt(e);
  });
  $("#promptInput").addEventListener("input", autosize);
  $("#promptInput").addEventListener("input", (e) => checkSlashTrigger(e.target));
  $("#promptInput").addEventListener("keydown", e => {
    // Handle slash command navigation first
    if (isSlashVisible()) {
      if (handleSlashKeydown(e)) return;
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#composer").requestSubmit(); }
    if (e.key === "ArrowUp" && !e.shiftKey) {
      const input = $("#promptInput");
      if (input.selectionStart === 0) { e.preventDefault(); navigateHistory('up'); }
    }
    if (e.key === "ArrowDown" && !e.shiftKey) {
      const input = $("#promptInput");
      if (input.selectionStart === input.value.length) { e.preventDefault(); navigateHistory('down'); }
    }
  });
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
