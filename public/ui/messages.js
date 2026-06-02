import { state } from "./state.js";
import { getBridge } from "./bridge.js";
import { $, basename } from "./helpers.js";
import { escapeHtml, renderMarkdown, renderInlineMarkdown } from "../markdown.js";

// Module-local state
export let attachedFiles = [];

// Dependency injection
let deps = {};
export function configure(d) { deps = d; }

export function setAttachedFiles(v) { attachedFiles = v; }
export function getAttachedFiles() { return attachedFiles; }

export function renderMessages() {
  const transcript = $("#transcript");
  transcript.innerHTML = "";
  if (!state.messages.length) {
    transcript.innerHTML = `
      <div class="empty-state">
        <b>从一个项目任务开始</b>
        <span>先选择左侧项目目录，再描述你希望 Claude Code 完成的工作。需要多人协作时，可打开 Teams 工作流。</span>
        <div class="empty-actions">
          <button class="st-btn t-btn--primary t-btn--sm" id="emptyFocusPrompt" type="button">输入任务</button>
          <button class="st-btn t-btn--link" id="emptyOpenProviders" type="button">配置 Provider</button>
          <button class="st-btn t-btn--link" id="emptyOpenTeams" type="button">打开 Teams</button>
        </div>
      </div>
    `;
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
    }

    transcript.append(node);
  }
  transcript.scrollTop = transcript.scrollHeight;
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
      attachedFiles.splice(index, 1);
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
