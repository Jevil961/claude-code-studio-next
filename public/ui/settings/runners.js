import { data } from "../state.js";
import { safeBridge } from "../bridge.js";
import { toast, basename } from "../helpers.js";
import { escapeHtml } from "../../markdown.js";

function ageLabel(ts) {
  if (!ts) return "--";
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

function runnerHealth(runner) {
  if (runner.lastError) return { label: "异常", tone: "danger", hint: runner.lastError };
  if (runner.busy || runner.currentRunId) return { label: "运行中", tone: "busy", hint: "正在处理当前任务" };
  if (runner.status === "retrying") return { label: "重试中", tone: "warn", hint: "连接中断后正在自动恢复" };
  return { label: "空闲", tone: "ok", hint: "可复用或等待自动回收" };
}

function runnerCounts(runners) {
  return {
    total: runners.length,
    busy: runners.filter(item => item.busy || item.currentRunId).length,
    error: runners.filter(item => item.lastError || item.status === "failed").length,
    idle: runners.filter(item => !item.busy && !item.currentRunId && !item.lastError).length,
  };
}

export function renderRunnersSettings(deps) {
  const { settingsBody, renderSettingsTab, loadRunners } = deps;
  const counts = runnerCounts(data.runners || []);
  const toolbar = document.createElement("div");
  toolbar.className = "scard";
  toolbar.innerHTML = `
    <div class="scard-head">
      <span class="scard-title">Runner 状态中心</span>
      <div class="scard-actions">
        <button class="st-btn t-btn--link" id="refreshRunnersBtn">刷新</button>
        <button class="st-btn t-btn--danger t-btn--sm" id="stopAllRunnersBtn">全部断开</button>
      </div>
    </div>
    <div class="runner-health-strip">
      <span>总数 ${counts.total}</span>
      <span>运行中 ${counts.busy}</span>
      <span>空闲 ${counts.idle}</span>
      <span>异常 ${counts.error}</span>
    </div>
  `;
  settingsBody.append(toolbar);
  toolbar.querySelector("#refreshRunnersBtn").addEventListener("click", async () => { await loadRunners(); renderSettingsTab(); });
  toolbar.querySelector("#stopAllRunnersBtn").addEventListener("click", async () => {
    const r = await safeBridge("reconnectClaude", null);
    if (r.ok) { toast("已断开全部 Runner", "success"); await loadRunners(); renderSettingsTab(); }
  });
  if (!data.runners.length) {
    const empty = document.createElement("div");
    empty.className = "scard";
    empty.innerHTML = `
      <div class="slist-name">暂无活跃 Runner</div>
      <div class="slist-sub" style="white-space:normal;">Runner 会在运行 Claude Code 时出现。空闲 Runner 会自动回收，也可以在这里手动断开。</div>
    `;
    settingsBody.append(empty);
    return;
  }
  for (const r of data.runners) {
    const health = runnerHealth(r);
    const card = document.createElement("div");
    card.className = `slist-item runner-card is-${health.tone}`;
    card.innerHTML = `
      <div class="slist-icon">${r.busy ? "●" : "○"}</div>
      <div class="slist-body">
        <div class="slist-name">${escapeHtml(basename(r.cwd) || "Runner")} <span class="runner-badge">${health.label}</span></div>
        <div class="slist-sub">PID ${r.pid || "--"} · ${r.permissionMode || "auto"} · ${r.runnerStrategy || "seamless"} · ${escapeHtml(r.effectiveCwd || r.cwd || "")}</div>
        <div class="runner-meta">
          <span>状态 ${escapeHtml(r.status || "--")}</span>
          <span>运行 ${ageLabel(r.startedAt)}</span>
          <span>最近 ${ageLabel(r.lastUsedAt)}</span>
          ${r.currentRunId ? `<span>Run ${escapeHtml(String(r.currentRunId).slice(0, 8))}</span>` : ""}
        </div>
        ${health.hint ? `<div class="runner-hint">${escapeHtml(health.hint)}</div>` : ""}
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
