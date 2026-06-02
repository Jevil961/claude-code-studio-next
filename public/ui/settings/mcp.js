import { data } from "../state.js";
import { getBridge, safeBridge } from "../bridge.js";
import { toast } from "../helpers.js";
import { showModal, showConfirm } from "../modal.js";
import { escapeHtml } from "../../markdown.js";

export function renderMcpSettings(deps) {
  const { settingsBody, renderSettingsTab, loadMcp } = deps;
  const bridge = getBridge();
  const header = document.createElement("div");
  header.className = "scard";
  header.innerHTML = `<div class="scard-head"><span class="scard-title">MCP 服务 (${data.mcp.length})</span><div class="scard-actions"><button class="st-btn t-btn--link" id="previewMcpBtn">同步预览</button><button class="st-btn t-btn--link" id="syncMcpBtn">同步</button><button class="st-btn t-btn--primary t-btn--sm" id="addMcpBtn">添加</button><button class="st-btn t-btn--link" id="importMcpBtn">导入 JSON</button></div></div>`;
  settingsBody.append(header);
  header.querySelector("#previewMcpBtn").addEventListener("click", () => previewMcpSync({ settingsBody }));
  header.querySelector("#syncMcpBtn").addEventListener("click", async () => {
    const r = await safeBridge("syncMcp", null);
    if (r.ok) toast(`已同步 ${r.data?.count || 0} 个 MCP`, "success");
    else toast(r.error || "同步失败", "error");
  });
  header.querySelector("#addMcpBtn").addEventListener("click", () => addMcpDlg({ settingsBody, renderSettingsTab, loadMcp }));
  header.querySelector("#importMcpBtn").addEventListener("click", () => importMcp({ settingsBody, renderSettingsTab, loadMcp }));

  if (!data.mcp.length) {
    const empty = document.createElement("div");
    empty.className = "scard";
    empty.innerHTML = `
      <div class="slist-name">还没有 MCP 服务</div>
      <div class="slist-sub" style="white-space:normal;">MCP 能把文件系统、数据库、浏览器等外部工具接入 Claude。先添加配置 JSON，再同步到 Claude Code。</div>
      <div class="scard-actions" style="margin-top:10px;">
        <button class="st-btn t-btn--primary t-btn--sm" id="emptyAddMcpBtn" type="button">添加 MCP</button>
        <button class="st-btn t-btn--link" id="emptyImportMcpBtn" type="button">导入 JSON</button>
      </div>
    `;
    settingsBody.append(empty);
    empty.querySelector("#emptyAddMcpBtn").addEventListener("click", () => addMcpDlg({ settingsBody, renderSettingsTab, loadMcp }));
    empty.querySelector("#emptyImportMcpBtn").addEventListener("click", () => importMcp({ settingsBody, renderSettingsTab, loadMcp }));
    return;
  }

  for (const item of data.mcp) {
    const card = document.createElement("div");
    card.className = `slist-item${item.enabledClaude ? " is-active" : ""}`;
    card.innerHTML = `
      <div class="slist-icon">${item.enabledClaude ? "●" : "○"}</div>
      <div class="slist-body">
        <div class="slist-name">${escapeHtml(item.name)}</div>
        <div class="slist-sub">${escapeHtml(item.command || "")}</div>
      </div>
      <div class="slist-actions">
        <button class="st-btn t-btn--link" data-act="toggle">${item.enabledClaude ? "停用" : "启用"}</button>
        <button class="st-btn t-btn--link" data-act="edit">编辑</button>
        <button class="st-btn t-btn--danger t-btn--sm" data-act="delete">删除</button>
      </div>
    `;
    card.querySelector('[data-act="toggle"]').addEventListener("click", async () => {
      const r = await safeBridge("setMcpEnabled", null, item.id, !item.enabledClaude);
      if (r.ok) { toast(item.enabledClaude ? "已停用" : "已启用", "success"); await loadMcp(); renderSettingsTab(); }
    });
    card.querySelector('[data-act="edit"]').addEventListener("click", async () => {
      const result = await showModal("编辑 MCP", [
        { key: "name", label: "名称", value: item.name },
        { key: "config", label: "配置 JSON", value: JSON.stringify(item.config || {}, null, 2), type: "textarea" },
      ]);
      if (!result) return;
      try { JSON.parse(result.config); } catch { toast("JSON 无效", "error"); return; }
      const r = await safeBridge("updateMcp", null, item.id, { name: result.name, config: JSON.parse(result.config) });
      if (r.ok) { toast("已更新", "success"); await loadMcp(); renderSettingsTab(); }
    });
    card.querySelector('[data-act="delete"]').addEventListener("click", async () => {
      if (!await showConfirm("删除", `删除「${item.name}」？`)) return;
      const r = await safeBridge("deleteMcp", null, item.id);
      if (r.ok) { toast("已删除", "success"); await loadMcp(); renderSettingsTab(); }
    });
    settingsBody.append(card);
  }
}

async function addMcpDlg(deps) {
  const { settingsBody, renderSettingsTab, loadMcp } = deps;
  const result = await showModal("添加 MCP", [
    { key: "name", label: "名称", value: "", placeholder: "MCP 服务名" },
    { key: "config", label: "配置 JSON", value: '{"type":"stdio","command":"npx","args":["-y","your-mcp"]}', type: "textarea" },
  ]);
  if (!result || !result.name) return;
  try { JSON.parse(result.config); } catch { toast("JSON 无效", "error"); return; }
  const r = await safeBridge("addMcp", null, result.name, result.config);
  if (r.ok) { toast(`已添加：${result.name}`, "success"); await loadMcp(); renderSettingsTab(); }
  else toast(r.error || "添加失败", "error");
}

async function importMcp(deps) {
  const { renderSettingsTab, loadMcp } = deps;
  const bridge = getBridge();
  const file = await bridge?.chooseFile?.();
  if (!file) return;
  const r = await safeBridge("importMcp", null, file);
  if (r.ok) { toast("已导入", "success"); await loadMcp(); renderSettingsTab(); }
  else toast(r.error || "导入失败", "error");
}

async function previewMcpSync() {
  const r = await safeBridge("previewMcpSync", null);
  if (!r.ok) { toast(r.error || "预览失败", "error"); return; }
  const p = r.data || {};
  const text = [
    `启用：${p.enabled || 0}`,
    `新增：${(p.add || []).join(", ") || "无"}`,
    `更新：${(p.update || []).join(", ") || "无"}`,
    `移除：${(p.remove || []).join(", ") || "无"}`,
  ].join("\n");
  await showModal("MCP 同步预览", [{ key: "preview", label: "变更", value: text, type: "textarea" }]);
}
