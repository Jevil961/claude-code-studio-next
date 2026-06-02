import { state, save } from "../state.js";
import { getBridge, safeBridge } from "../bridge.js";
import { toast } from "../helpers.js";
import { showModal, showConfirm } from "../modal.js";
import { escapeHtml } from "../../markdown.js";

export function renderGeneralSettings(deps) {
  const { settingsBody, renderSettingsTab, claudeSetupState, updateClaudeSetupState, showSetupBanner } = deps;
  const bridge = getBridge();

  const card = document.createElement("div");
  card.className = "scard";
  card.innerHTML = `
    <div class="modal-fields">
      <div class="modal-field"><label>Claude 路径<input id="gClaudePath" value="${escapeHtml(state.claudePath || "")}" placeholder="自动检测"></label></div>
      <div class="modal-field"><label>默认工作目录<input id="gDefaultCwd" value="${escapeHtml(state.defaultCwd || state.cwd || "")}" placeholder="选择目录"></label></div>
      <div class="modal-field"><label>Runner 策略<select id="gStrategy"><option value="strict">省内存：任务结束即关闭</option><option value="seamless">兼容：短暂复用后自动关闭</option></select></label></div>
    </div>
  `;
  settingsBody.append(card);
  card.querySelector("#gStrategy").value = state.runnerStrategy;
  card.querySelector("#gClaudePath").addEventListener("change", e => { state.claudePath = e.target.value.trim(); save(); toast("已保存", "success"); });
  card.querySelector("#gDefaultCwd").addEventListener("change", e => { state.defaultCwd = e.target.value.trim(); if (!state.cwd && state.defaultCwd) state.cwd = state.defaultCwd; save(); });
  card.querySelector("#gStrategy").addEventListener("change", e => { state.runnerStrategy = e.target.value; save(); });

  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:6px;margin-top:8px;";
  const chooseBtn = document.createElement("button");
  chooseBtn.className = "st-btn t-btn--link";
  chooseBtn.textContent = "选择目录";
  chooseBtn.addEventListener("click", async () => { const f = await bridge?.chooseFolder?.(); if (f) { state.defaultCwd = f; if (!state.cwd) state.cwd = f; save(); renderSettingsTab(); } });
  const resetBtn = document.createElement("button");
  resetBtn.className = "st-btn t-btn--danger t-btn--sm";
  resetBtn.textContent = "重置 UI";
  resetBtn.addEventListener("click", async () => { if (!await showConfirm("重置", "确定重置？")) return; localStorage.removeItem("ccs-v6"); location.reload(); });
  const detectBtn = document.createElement("button");
  detectBtn.className = "st-btn t-btn--primary t-btn--sm";
  detectBtn.textContent = "检测 Claude";
  detectBtn.addEventListener("click", async () => {
    const r = await safeBridge("checkClaude", null, state.claudePath);
    const d = r.data || {};
    if (d.claudePath) state.claudePath = d.claudePath;
    save();
    toast(d.ok ? `已检测：${d.version || d.claudePath}` : (d.error || "未找到 Claude"), d.ok ? "success" : "error");
    renderSettingsTab();
  });
  actions.append(detectBtn, chooseBtn, resetBtn);
  settingsBody.append(actions);

  // ── Claude Setup Section ──
  (async () => {
    const cs = (await safeBridge("getClaudeSetup", null))?.data || {};
    const detectR = await safeBridge("detectClaude", null, state.claudePath);
    const current = detectR?.data || {};
    updateClaudeSetupState({ ...current, dismissed: cs.dismissed });

    const vSection = document.createElement("div");
    vSection.className = "scard";
    vSection.style.cssText = "margin-top:12px;";
    const statusColor = current.installed ? "var(--td-success-color)" : "var(--td-error-color)";
    const statusText = current.installed
      ? `已安装${current.version ? " v" + current.version : ""}`
      : "未安装";
    const statusDetail = current.installed ? (current.claudePath || "自动检测") : "启动时自动提醒安装";

    vSection.innerHTML = `
      <div class="scard-head"><span class="scard-title">Claude Code 环境</span></div>
      <div class="slist-sub" style="margin-bottom:8px;">
        通过 npm 安装 <code>@anthropic-ai/claude-code</code>。启动时自动检测并提醒。
      </div>
      <div style="display:flex;align-items:center;gap:8px;padding:8px 0;">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusColor};"></span>
        <span style="font-weight:600;">${statusText}</span>
        <span style="color:var(--td-text-color-disabled);font-size:11px;">${statusDetail}</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
        <button class="st-btn t-btn--link" id="gDetectClaudeBtn">重新检测</button>
        ${!current.installed ? `<button class="st-btn t-btn--primary t-btn--sm" id="gInstallNowBtn">立即安装</button>` : ""}
        ${cs.dismissed ? `<button class="st-btn t-btn--warning t-btn--sm" id="gResetSetupBtn">重新开启提醒</button>` : ""}
      </div>
    `;
    settingsBody.append(vSection);

    vSection.querySelector("#gDetectClaudeBtn")?.addEventListener("click", async () => {
      const r = await safeBridge("detectClaude", null, state.claudePath);
      const d = r?.data || {};
      updateClaudeSetupState(d);
      if (!d.installed && !claudeSetupState.dismissed) showSetupBanner(d);
      renderSettingsTab();
    });

    vSection.querySelector("#gInstallNowBtn")?.addEventListener("click", async () => {
      // Show a simple modal to pick version, then install
      const versionsR = await safeBridge("fetchClaudeVersions", null);
      const versions = versionsR?.data?.versions || [];
      const latest = versionsR?.data?.latest || "";
      const options = [{ value: "", label: "latest (最新)" }];
      if (versions.length) {
        options.push(...versions.map(v => ({ value: v, label: v + (v === latest ? " (最新)" : "") })));
      }
      const result = await showModal("安装 Claude Code", [
        { key: "version", label: "版本", type: "select", options, value: "" },
        { key: "note", label: "", value: "将通过 npm install -g @anthropic-ai/claude-code 安装。\n安装过程可能需要几分钟，请耐心等待。", type: "textarea" },
      ]);
      if (!result) return;
      const r = await safeBridge("installClaude", null, result.version || "");
      if (r.ok) {
        toast(`开始安装 Claude Code ${result.version || "latest"}...`, "info");
        // Listen for progress
        const handler = (payload = {}) => {
          if (payload.status === "done" && payload.ok) {
            toast(`安装完成 v${payload.version || ""}`, "success");
            bridge.onClaudeInstallProgress?.(() => {});
          } else if (payload.status === "failed") {
            toast("安装失败: " + (payload.error || ""), "error");
            bridge.onClaudeInstallProgress?.(() => {});
          }
        };
        if (bridge?.onClaudeInstallProgress) {
          const unsub = bridge.onClaudeInstallProgress((p) => {
            handler(p);
            if (p.status === "done" || p.status === "failed") unsub?.();
          });
        }
      } else {
        toast(r.error || "启动安装失败", "error");
      }
    });

    vSection.querySelector("#gResetSetupBtn")?.addEventListener("click", async () => {
      await safeBridge("resetSetup", null);
      updateClaudeSetupState({ dismissed: false });
      toast("安装提醒已重新开启", "success");
      renderSettingsTab();
    });
  })();
}
