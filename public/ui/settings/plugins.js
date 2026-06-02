import { data } from "../state.js";
import { safeBridge, getBridge } from "../bridge.js";
import { toast } from "../helpers.js";
import { showModal, showConfirm } from "../modal.js";
import { escapeHtml } from "../../markdown.js";
import { loadPlugins } from "../data-loader.js";
import { classifyPlugin } from "./settings-helpers.js";

export function renderPluginsSettings({ settingsBody, renderSettingsTab }) {
  const bridge = getBridge();

  var h = document.createElement("div");
  h.className = "scard";
  h.innerHTML = '<div class="scard-head"><span class="scard-title">插件管理 (' + data.plugins.length + ')</span><div class="scard-actions"><button class="st-btn t-btn--link" id="refreshPluginsBtn">刷新</button><button class="st-btn t-btn--primary t-btn--sm" id="installPluginBtn">安装插件</button></div></div><div class="slist-sub">安装到 ~/.claude/plugins/ 后自动生效。支持 marketplace 市场安装和本地文件夹安装。</div>';
  settingsBody.append(h);
  h.querySelector("#refreshPluginsBtn").addEventListener("click", async function() { await loadPlugins(); renderSettingsTab(); });
  h.querySelector("#installPluginBtn").addEventListener("click", async function() {
    var result = await showModal("安装插件", [
      { key: "source", label: "源", value: "", placeholder: "marketplace 格式: name@marketplace  或留空选择本地文件夹" },
      { key: "note", label: "", value: "市场安装: 输入 name@marketplace 通过 Claude CLI 安装\n本地安装: 留空，选择插件文件夹复制到 ~/.claude/plugins/", type: "textarea" },
    ]);
    if (result === null) return;
    if (result.source && result.source.trim()) {
      toast("正在通过 CLI 安装 " + result.source.trim() + "...");
      var r = await safeBridge("installPluginByName", null, result.source.trim());
      if (r.ok) toast("已安装: " + result.source.trim(), "success");
      else { toast(r.error || "安装失败", "error"); return; }
    } else {
      var folder = await (bridge && bridge.chooseFolder ? bridge.chooseFolder() : null);
      if (!folder) return;
      var r = await safeBridge("importPluginFolder", null, folder);
      if (!r.ok) { toast(r.error || "安装失败", "error"); return; }
      toast("已安装: " + (r.data && r.data.manifest ? r.data.manifest.name : (r.data && r.data.pluginId ? r.data.pluginId : "插件")), "success");
    }
    await loadPlugins();
    setTimeout(async function() { await loadPlugins(); renderSettingsTab(); }, 500);
  });

  if (!data.plugins.length) {
    var empty = document.createElement("div");
    empty.className = "scard";
    empty.innerHTML = '<div class="slist-name">暂无已安装插件</div><div class="slist-sub">点击上方安装插件按钮。支持 marketplace 格式或本地文件夹。</div>';
    settingsBody.append(empty);
    return;
  }

  // Group by category
  var groups = { __other: [] };
  for (var i = 0; i < data.plugins.length; i++) {
    var p = data.plugins[i];
    var cat = classifyPlugin(p);
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(p);
  }

  var catOrder = Object.keys(data.categoryInfo);
  var allCats = catOrder.concat(["__other"]);
  for (var ci = 0; ci < allCats.length; ci++) {
    var catId = allCats[ci];
    var plugins = groups[catId];
    if (!plugins || !plugins.length) continue;
    var catInfo = data.categoryInfo[catId];
    var catLabel = catInfo ? (catInfo.icon || "") + " " + catInfo.name : "未分类";

    var catTitle = document.createElement("div");
    catTitle.style.cssText = "font-size:12px;font-weight:600;padding:12px 0 4px;";
    catTitle.textContent = catLabel + " (" + plugins.length + ")";
    settingsBody.append(catTitle);

    for (var pi = 0; pi < plugins.length; pi++) {
      (function(plugin) {
        var card = document.createElement("div");
        card.className = "slist-item";
        var verHtml = plugin.version ? '<span class="slist-badge">v' + escapeHtml(plugin.version) + '</span>' : "";
        card.innerHTML = '<div class="slist-icon">PL</div><div class="slist-body"><div class="slist-name">' + escapeHtml(plugin.name) + ' ' + verHtml + '</div><div class="slist-sub">' + escapeHtml(plugin.description || "无描述") + '</div></div><div class="slist-actions"><button class="st-btn t-btn--link" data-act="open">打开</button><button class="st-btn t-btn--link" data-act="manifest">清单</button><button class="st-btn t-btn--danger t-btn--sm" data-act="delete">卸载</button></div>';
        card.querySelector('[data-act="open"]').addEventListener("click", function() { if (bridge && bridge.openPath) bridge.openPath(plugin.path); });
        card.querySelector('[data-act="manifest"]').addEventListener("click", function() {
          if (plugin.manifestPath) bridge && bridge.openPath && bridge.openPath(plugin.manifestPath);
          else toast("该插件没有找到清单文件", "error");
        });
        card.querySelector('[data-act="delete"]').addEventListener("click", async function() {
          if (!await showConfirm("卸载插件", "确定卸载 " + plugin.name + "?\n\n这会删除 " + plugin.path)) return;
          var r = await safeBridge("deletePlugin", null, plugin.path);
          if (r.ok) { toast("已卸载: " + plugin.name, "success"); await loadPlugins(); renderSettingsTab(); }
          else toast(r.error || "卸载失败", "error");
        });
        settingsBody.append(card);
      })(plugins[pi]);
    }
  }
}

export async function importPluginFolder({ renderSettingsTab }) {
  const bridge = getBridge();
  var folder = await (bridge && bridge.chooseFolder ? bridge.chooseFolder() : null);
  if (!folder) return;
  var ok = await showConfirm("安装插件", "将安装插件文件夹:\n" + folder + "\n\n目标目录: ~/.claude/plugins");
  if (!ok) return;
  var r = await safeBridge("importPluginFolder", null, folder);
  if (!r.ok) { toast(r.error || "插件安装失败", "error"); return; }
  var name = (r.data && r.data.manifest ? r.data.manifest.name : "") || (r.data && r.data.pluginId ? r.data.pluginId : "") || "插件";
  toast(name + " 已安装到 Claude Code", "success");
  await loadPlugins();
  renderSettingsTab();
}
