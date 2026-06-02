import { data } from "../state.js";
import { safeBridge } from "../bridge.js";
import { toast, basename } from "../helpers.js";
import { escapeHtml } from "../../markdown.js";

export function renderRunnersSettings(deps) {
  const { settingsBody, renderSettingsTab, loadRunners } = deps;
  const toolbar = document.createElement("div");
  toolbar.className = "scard";
  toolbar.innerHTML = `<div class="scard-head"><span class="scard-title">Runner 状态中心</span><div class="scard-actions"><button class="st-btn t-btn--link" id="refreshRunnersBtn">刷新</button><button class="st-btn t-btn--danger t-btn--sm" id="stopAllRunnersBtn">全部断开</button></div></div>`;
  settingsBody.append(toolbar);
  toolbar.querySelector("#refreshRunnersBtn").addEventListener("click", async () => { await loadRunners(); renderSettingsTab(); });
  toolbar.querySelector("#stopAllRunnersBtn").addEventListener("click", async () => {
    const r = await safeBridge("reconnectClaude", null);
    if (r.ok) { toast("已断开全部 Runner", "success"); await loadRunners(); renderSettingsTab(); }
  });
  if (!data.runners.length) { const empty = document.createElement("div"); empty.className = "scard"; empty.innerHTML = `<div class="scard-title" style="color:var(--td-text-color-placeholder);">暂无活跃 Runner</div>`; settingsBody.append(empty); return; }
  for (const r of data.runners) {
    const card = document.createElement("div");
    card.className = "slist-item";
    card.innerHTML = `
      <div class="slist-icon">${r.busy ? "●" : "○"}</div>
      <div class="slist-body">
        <div class="slist-name">${escapeHtml(basename(r.cwd) || "Runner")} ${r.busy ? "运行中" : "空闲"}</div>
        <div class="slist-sub">PID ${r.pid || "--"} · ${r.permissionMode || "auto"} · ${r.runnerStrategy || "seamless"} · ${escapeHtml(r.effectiveCwd || r.cwd || "")}</div>
      </div>
      <div class="slist-actions"><button class="st-btn t-btn--danger t-btn--sm" data-act="stop">关闭</button></div>
    `;
    card.querySelector('[data-act="stop"]').addEventListener("click", async () => {
      const res = await safeBridge("stopRunner", null, r.key);
      if (res.ok) { toast("已关闭", "success"); await loadRunners(); renderSettingsTab(); }
    });
    settingsBody.append(card);
  }
}
