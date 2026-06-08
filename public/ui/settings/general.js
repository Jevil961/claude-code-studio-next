import { state, save } from "../state.js";
import { getBridge, safeBridge } from "../bridge.js";
import { toast } from "../helpers.js";
import { showModal, showConfirm } from "../modal.js";
import { escapeHtml } from "../../markdown.js";

export function renderGeneralSettings(deps) {
  const { settingsBody, renderSettingsTab, claudeSetupState, updateClaudeSetupState, showSetupBanner } = deps;
  const bridge = getBridge();

  // ── Theme & Density ──
  const prefCard = document.createElement("div");
  prefCard.className = "scard";
  prefCard.innerHTML = `
    <div class="scard-head"><span class="scard-title">外观偏好</span></div>
    <div class="modal-fields">
      <div class="modal-field"><label>主题<select id="gTheme"><option value="dark">暗色</option><option value="light">亮色</option></select></label></div>
      <div class="modal-field"><label>界面密度<select id="gDensity"><option value="default">默认</option><option value="compact">紧凑</option><option value="spacious">宽松</option></select></label></div>
    </div>
  `;
  settingsBody.append(prefCard);
  prefCard.querySelector("#gTheme").value = document.documentElement.dataset.theme || 'dark';
  prefCard.querySelector("#gDensity").value = state.density || 'default';
  prefCard.querySelector("#gTheme").addEventListener("change", e => {
    document.documentElement.dataset.theme = e.target.value;
    state.theme = e.target.value;
    save();
    toast(`主题已切换为${e.target.value === 'light' ? '亮色' : '暗色'}`, "success");
  });
  prefCard.querySelector("#gDensity").addEventListener("change", e => {
    document.documentElement.dataset.density = e.target.value === 'default' ? '' : e.target.value;
    state.density = e.target.value;
    save();
  });

  // ── General Settings ──
  const card = document.createElement("div");
  card.className = "scard";
  card.innerHTML = `
    <div class="scard-head"><span class="scard-title">运行配置</span></div>
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
  actions.style.cssText = "display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;";
  const chooseClaudeBtn = document.createElement("button");
  chooseClaudeBtn.className = "st-btn t-btn--link";
  chooseClaudeBtn.textContent = "选择 Claude 文件";
  chooseClaudeBtn.addEventListener("click", async () => {
    const f = await bridge?.chooseFile?.();
    if (!f) return;
    const r = await safeBridge("detectClaude", null, f);
    const d = r?.data || {};
    if (d.installed) {
      state.claudePath = d.claudePath || f;
      save();
      toast(`Claude Code ${d.version ? "v" + d.version : ""} 已就绪`, "success");
    } else {
      state.claudePath = f;
      save();
      toast("已保存路径，但这个文件暂时不能运行 Claude Code。", "error");
    }
    renderSettingsTab();
  });
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
  actions.append(detectBtn, chooseClaudeBtn, chooseBtn, resetBtn);
  settingsBody.append(actions);

  // ── Prompt Templates ──
  const tplCard = document.createElement("div");
  tplCard.className = "scard";
  tplCard.style.cssText = "margin-top:12px;";
  const templates = state.promptTemplates || [];
  tplCard.innerHTML = `
    <div class="scard-head"><span class="scard-title">Prompt 模板</span><div class="scard-actions"><button class="st-btn t-btn--primary t-btn--sm" id="addTemplateBtn">添加模板</button></div></div>
    <div class="slist-sub">在输入框输入 / 模板名 即可快速插入。支持 Slash Commands 面板自动补全。</div>
    <div id="templateList"></div>
  `;
  settingsBody.append(tplCard);

  const tplList = tplCard.querySelector('#templateList');
  function renderTemplates() {
    tplList.innerHTML = '';
    const tpls = state.promptTemplates || [];
    if (!tpls.length) {
      tplList.innerHTML = '<div style="padding:8px;color:var(--td-text-color-disabled);font-size:12px;">暂无模板</div>';
      return;
    }
    for (const t of tpls) {
      const item = document.createElement('div');
      item.className = 'slist-item';
      item.innerHTML = `
        <div class="slist-body">
          <div class="slist-name">/${escapeHtml(t.name)}</div>
          <div class="slist-sub">${escapeHtml(t.body.slice(0, 80))}${t.body.length > 80 ? '...' : ''}</div>
        </div>
        <div class="slist-actions">
          <button class="st-btn t-btn--link" data-act="edit">编辑</button>
          <button class="st-btn t-btn--danger t-btn--sm" data-act="delete">删除</button>
        </div>
      `;
      item.querySelector('[data-act="edit"]').addEventListener('click', async () => {
        const result = await showModal('编辑模板', [
          { key: 'name', label: '名称', value: t.name, placeholder: '模板名称（不含/）' },
          { key: 'body', label: '内容', value: t.body, type: 'textarea', placeholder: 'Prompt 内容' },
        ]);
        if (result?.name) {
          t.name = result.name.trim();
          t.body = result.body?.trim() || '';
          save();
          renderTemplates();
          toast('模板已更新', 'success');
        }
      });
      item.querySelector('[data-act="delete"]').addEventListener('click', async () => {
        if (!await showConfirm('删除模板', `确定删除「${t.name}」？`)) return;
        state.promptTemplates = (state.promptTemplates || []).filter(x => x !== t);
        save();
        renderTemplates();
        toast('模板已删除', 'success');
      });
      tplList.append(item);
    }
  }
  renderTemplates();

  tplCard.querySelector('#addTemplateBtn').addEventListener('click', async () => {
    const result = await showModal('添加 Prompt 模板', [
      { key: 'name', label: '名称', value: '', placeholder: '模板名称（不含/）', required: true },
      { key: 'body', label: '内容', value: '', type: 'textarea', placeholder: 'Prompt 内容', required: true },
    ]);
    if (result?.name && result?.body) {
      state.promptTemplates = [...(state.promptTemplates || []), { name: result.name.trim(), body: result.body.trim() }];
      save();
      renderTemplates();
      toast('模板已添加', 'success');
    }
  });

  // ── Import/Export ──
  const ioCard = document.createElement("div");
  ioCard.className = "scard";
  ioCard.style.cssText = "margin-top:12px;";
  ioCard.innerHTML = `
    <div class="scard-head"><span class="scard-title">数据迁移</span></div>
    <div class="slist-sub">导出或导入整个工作空间配置（Provider、身份、Teams、模板等）。</div>
    <div style="display:flex;gap:6px;margin-top:8px;">
      <button class="st-btn t-btn--default t-btn--sm" id="exportWorkspaceBtn">导出工作空间</button>
      <button class="st-btn t-btn--default t-btn--sm" id="importWorkspaceBtn">导入工作空间</button>
    </div>
  `;
  settingsBody.append(ioCard);
  ioCard.querySelector('#exportWorkspaceBtn').addEventListener('click', async () => {
    const { exportWorkspace } = await import('../data-transfer.js');
    await exportWorkspace();
  });
  ioCard.querySelector('#importWorkspaceBtn').addEventListener('click', async () => {
    const { importWorkspace } = await import('../data-transfer.js');
    await importWorkspace();
  });

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
        if (bridge?.onClaudeInstallProgress) {
          const unsub = bridge.onClaudeInstallProgress((p = {}) => {
            if (p.status === "done" && p.ok) {
              toast(`安装完成 v${p.version || ""}`, "success");
              unsub?.();
            } else if (p.status === "failed") {
              toast("安装失败: " + (p.error || ""), "error");
              unsub?.();
            }
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
