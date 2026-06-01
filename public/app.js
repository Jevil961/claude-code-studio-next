import { escapeHtml, renderInlineMarkdown, renderMarkdown } from "./markdown.js";
import { showConfirm, showModal } from "./ui/modal.js";
import { $, basename, fmtNum, fmtTime, hlMatch, searchable, toast } from "./ui/helpers.js";
import { withTimeout } from "./ui/api.js";
import { data, save, sessMeta, state } from "./ui/state.js";

const bridge = window.agentBridge;
let attachedFiles = [];
let runTimeline = [];
let runTouchedFiles = [];
let projectIndexState = { status: "idle", stats: null, updatedAt: 0, error: "" };
let identityAnalysisState = { running: false, status: "idle", message: "" };
let lastTimelineKey = "";

function runtimeAction(name) {
  return (...args) => {
    const runtime = window.runtime || window.go?.runtime || {};
    if (typeof runtime[name] === "function") return runtime[name](...args);
    const tauriWindowMap = {
      WindowMinimise: "minimizeWindow",
      WindowToggleMaximise: "toggleMaximizeWindow",
      Quit: "closeWindow",
    };
    const bridgeMethod = tauriWindowMap[name];
    if (bridgeMethod && typeof bridge?.[bridgeMethod] === "function") return bridge[bridgeMethod](...args);
  };
}

// ── Modal ──

// ── State ──

let currentRunId = "", assistantBuffer = "", liveThinking = [];

// ── Helpers ──

function safeBridge(method, fb, ...args) {
  if (!bridge || typeof bridge[method] !== "function") return Promise.resolve({ ok: false, error: "Bridge missing", data: fb });
  return withTimeout(
    Promise.resolve().then(() => bridge[method](...args)).catch(error => ({ ok: false, error: String(error?.message || error || "Bridge call failed"), data: fb })),
    12000,
    { ok: false, error: `${method} timeout`, data: fb },
  );
}
function curProvider() { return data.providers.find(p => p.current) || data.providers[0] || null; }
function selProject() { return data.projects.find(p => p.id === state.selectedProject) || data.projects[0] || null; }

// ── Window Controls ──

$("#winMinimize")?.addEventListener("click", () => runtimeAction("WindowMinimise")());
$("#winMaximize")?.addEventListener("click", () => runtimeAction("WindowToggleMaximise")());
$("#winClose")?.addEventListener("click", () => runtimeAction("Quit")());

// ── Top Bar ──

// Brand menu dropdown
const brandBtn = $("#brandMenuBtn");
const brandDropdown = $("#brandDropdown");

brandBtn?.addEventListener("click", e => {
  e.stopPropagation();
  const isOpen = brandDropdown.classList.contains("is-open");
  closeAllDropdowns();
  if (!isOpen) {
    const rect = brandBtn.getBoundingClientRect();
    brandDropdown.style.top = `${rect.bottom + 4}px`;
    brandDropdown.style.left = `${rect.left}px`;
    brandDropdown.style.right = "auto";
    brandDropdown.style.bottom = "auto";
    brandDropdown.classList.add("is-open");
  }
});

brandDropdown?.querySelectorAll("[data-tab]").forEach(item => {
  item.addEventListener("click", () => {
    brandDropdown.classList.remove("is-open");
    openSettings(item.dataset.tab);
  });
});

// ── Sidebar Toggle ──

const sidebar = $("#sidebar");
const contextStack = $("#contextStack");

$("#sidebarToggle").addEventListener("click", () => {
  state.sidebarOpen = !state.sidebarOpen;
  save();
  sidebar.classList.toggle("is-collapsed", !state.sidebarOpen);
});

$("#contextToggle")?.addEventListener("click", () => {
  state.contextOpen = !(state.contextOpen !== false);
  save();
  contextStack?.classList.toggle("is-collapsed", !state.contextOpen);
});

// ── Settings Page ──

const settingsPage = $("#settingsPage");
const settingsBody = $("#settingsBody");

function openSettings(tab) {
  settingsPage.classList.add("is-open");
  state.panel = tab || "providers";
  save();
  renderSettingsTab();
}

$("#settingsBack").addEventListener("click", () => settingsPage.classList.remove("is-open"));

$("#settingsTabs").addEventListener("click", e => {
  const btn = e.target.closest(".stab[data-tab]");
  if (!btn) return;
  state.panel = btn.dataset.tab;
  save();
  renderSettingsTab();
});

function renderSettingsTab() {
  // Redirect teams → identities before anything else
  if (state.panel === "teams") { state.panel = "identities"; save(); }

  $("#settingsTabs").querySelectorAll(".stab").forEach(b => b.classList.toggle("is-active", b.dataset.tab === state.panel));
  settingsBody.innerHTML = "";
  const titles = { providers: "Provider 管理", identities: "身份与协作", skills: "Skills 管理", mcp: "MCP 服务", plugins: "插件", runners: "Runner 管理", usage: "用量统计", diagnostics: "诊断", general: "通用设置" };
  $("#settingsTitle").textContent = titles[state.panel] || "设置";

  if (state.panel === "providers") renderProvidersSettings();
  if (state.panel === "identities") renderIdentitiesSettings();
  if (state.panel === "skills") renderSkillsSettings();
  if (state.panel === "mcp") renderMcpSettings();
  if (state.panel === "plugins") { loadPlugins().then(() => renderPluginsSettings()); }
  if (state.panel === "runners") renderRunnersSettings();
  if (state.panel === "usage") renderUsageSettings();
  if (state.panel === "diagnostics") renderDiagSettings();
  if (state.panel === "general") renderGeneralSettings();
}

// ── Providers Settings ──

function renderProvidersSettings() {
  const header = document.createElement("div");
  header.className = "scard";
  header.innerHTML = `<div class="scard-head"><span class="scard-title">当前：${curProvider()?.name || "未设置"}</span><div class="scard-actions"><button class="st-btn t-btn--primary t-btn--sm" id="addProviderBtn">添加 Provider</button></div></div>`;
  settingsBody.append(header);
  header.querySelector("#addProviderBtn").addEventListener("click", createProviderDlg);

  for (const p of data.providers) {
    const card = document.createElement("div");
    card.className = `slist-item${p.current ? " is-active" : ""}`;
    card.innerHTML = `
      <div class="slist-icon">${p.current ? "●" : "○"}</div>
      <div class="slist-body">
        <div class="slist-name">${escapeHtml(p.name)}</div>
        <div class="slist-sub">${escapeHtml(p.model || "")} · ${escapeHtml(p.baseUrl || "")}</div>
      </div>
      <div class="slist-actions">
        <button class="st-btn t-btn--link" data-act="test">测试</button>
        <button class="st-btn t-btn--link" data-act="switch">切换</button>
        <button class="st-btn t-btn--link" data-act="edit">编辑</button>
        <button class="st-btn t-btn--danger t-btn--sm" data-act="delete">删除</button>
      </div>
    `;
    card.querySelector('[data-act="test"]').addEventListener("click", () => testProvider(p));
    card.querySelector('[data-act="switch"]').addEventListener("click", () => switchProvider(p.id));
    card.querySelector('[data-act="edit"]').addEventListener("click", () => editProviderDlg(p));
    card.querySelector('[data-act="delete"]').addEventListener("click", () => deleteProviderDlg(p));
    settingsBody.append(card);
  }
}

async function createProviderDlg() {
  const presetsR = await safeBridge("getProviderPresets", null);
  const presets = presetsR?.data?.presets || [];

  const result = await showModal("添加 Provider", [
    { key: "preset", label: "预设平台", type: "select", options: [{ value: "", label: "-- 选择预设 --" }, ...presets.map(p => ({ value: p.id, label: `${p.icon || ""} ${p.name}` }))], value: "" },
    { key: "name", label: "名称", value: "", placeholder: "Provider 名称" },
    { key: "baseUrl", label: "Base URL", value: "", placeholder: "API 地址" },
    { key: "authToken", label: "Auth Token", value: "", placeholder: "API Key", type: "password" },
    { key: "apiFormat", label: "API 格式", type: "select", options: [{ value: "anthropic", label: "Anthropic 原生" }, { value: "openai", label: "OpenAI 兼容" }, { value: "gemini", label: "Google Gemini" }], value: "openai" },
    { key: "model", label: "默认模型", value: "", placeholder: "选择预设后自动填充，或手动输入" },
  ]);
  if (!result || !result.name) return;

  // If preset selected, fill missing fields
  if (result.preset) {
    const preset = presets.find(p => p.id === result.preset);
    if (preset) {
      if (!result.baseUrl) result.baseUrl = preset.baseUrl;
      if (!result.apiFormat) result.apiFormat = preset.apiFormat;
      if (!result.name) result.name = preset.name;
    }
  }

  const r = await safeBridge("createProvider", null, {
    name: result.name.trim(), baseUrl: result.baseUrl?.trim() || "", authToken: result.authToken?.trim() || "",
    model: result.model?.trim() || "", apiFormat: result.apiFormat || "openai",
  });
  if (r.ok) { toast(`已创建：${result.name}`, "success"); await loadProviders(); renderSettingsTab(); }
  else toast(r.error || "创建失败", "error");
}

async function editProviderDlg(item) {
  const result = await showModal("编辑 Provider", [
    { key: "name", label: "名称", value: item.name },
    { key: "baseUrl", label: "Base URL", value: item.baseUrl || "" },
    { key: "authToken", label: "Auth Token (留空不修改)", value: "", type: "password" },
    { key: "model", label: "默认模型", value: item.model || "" },
  ]);
  if (!result) return;
  const updates = { name: result.name?.trim() || item.name, model: result.model?.trim() || "", baseUrl: result.baseUrl?.trim() || "" };
  if (result.authToken?.trim()) updates.authToken = result.authToken.trim();
  const r = await safeBridge("updateProvider", null, item.id, updates);
  if (r.ok) { toast("已更新", "success"); await loadProviders(); renderSettingsTab(); }
  else toast(r.error || "更新失败", "error");
}

async function deleteProviderDlg(item) {
  if (!await showConfirm("删除", `确定删除「${item.name}」？`)) return;
  const wasCurrent = item.current;
  const r = await safeBridge("deleteProvider", null, item.id);
  if (r.ok) {
    toast("已删除", "success");
    await loadProviders();
    // If the deleted provider was current, switch to the first available
    if (wasCurrent && data.providers.length) {
      await switchProvider(data.providers[0].id);
    }
    renderSettingsTab();
    updateFooter();
    populateModelDropdown();
  } else toast(r.error || "删除失败", "error");
}

async function switchProvider(id) {
  const r = await safeBridge("switchProvider", null, id);
  if (r.ok) { data.providers = data.providers.map(p => ({ ...p, current: p.id === id })); toast(`已切换：${r.data?.provider?.name || ""}`, "success"); renderSettingsTab(); updateFooter(); }
  else toast(r.error || "切换失败", "error");
}

async function testProvider(provider) {
  toast(`正在测试 ${provider.name}...`);
  const r = await safeBridge("testProvider", null, provider.id);
  const d = r.data || {};
  if (!r.ok) { toast(r.error || "测试失败", "error"); return; }
  const lines = [
    `Provider：${d.provider || provider.name}`,
    `模型：${d.model || "--"}`,
    `Base URL：${d.baseUrl || "--"}`,
    `结果：${d.message || (d.ok ? "配置可用" : "配置不完整")}`,
    `耗时：${d.durationMs || 0}ms`,
  ];
  await showModal("Provider 测试结果", [{ key: "result", label: "结果", value: lines.join("\n"), type: "textarea" }]);
}

// ── Identities Settings ──

function selectedSkillDirsForCategory(catData, catSkills) {
  if (!catData?.enabled) return [];
  const available = new Set(catSkills.filter(s => s.inCcSwitch !== false).map(s => s.directory));
  const entries = Object.entries(catData.skills || {}).filter(([dir]) => available.has(dir));
  if (!entries.length) return [...available];
  const hasExplicitInclude = entries.some(([, enabled]) => enabled === true);
  if (hasExplicitInclude) return entries.filter(([, enabled]) => enabled === true).map(([dir]) => dir);
  const excluded = new Set(entries.filter(([, enabled]) => enabled === false).map(([dir]) => dir));
  return [...available].filter(dir => !excluded.has(dir));
}

function resolvedIdentitySkillDirs(identity) {
  const dirs = [];
  for (const [catId, catData] of Object.entries(identity?.categories || {})) {
    const catSkills = (data.categorizedSkills || data.skills || []).filter(s => s.category === catId);
    dirs.push(...selectedSkillDirsForCategory(catData, catSkills));
  }
  return [...new Set(dirs)];
}

function identitySkillCount(identity) {
  return resolvedIdentitySkillDirs(identity).length;
}

function renderIdentityAnalysisStatus() {
  const node = $("#identityAnalysisStatus");
  if (!node) return;
  node.classList.toggle("is-running", identityAnalysisState.running);
  node.classList.toggle("is-error", identityAnalysisState.status === "error");
  node.classList.toggle("is-done", identityAnalysisState.status === "done");
  node.textContent = identityAnalysisState.message || "AI 会根据当前真实 Skills 先做能力分类，再把分类生成为可切换身份。";
}

function renderIdentitiesSettings() {
  const active = data.identities.find(i => i.active);

  // ── Section 1: Identity management ──
  const header = document.createElement("div");
  header.className = "scard";
  header.innerHTML = `<div class="scard-head"><span class="scard-title">当前：${active ? `${active.icon || ""} ${escapeHtml(active.name)}` : "未设置"}</span><div class="scard-actions"><button class="st-btn t-btn--primary t-btn--sm" id="aiGenBtn">AI 分类生成</button><button class="st-btn t-btn--link" id="autoGenBtn">模板生成</button><button class="st-btn t-btn--link" id="addIdBtn">自定义</button></div></div><div class="slist-sub">身份 = Skills 分类后的能力集。切换身份自动同步对应 Skills 到 Claude Code，隔离其他 Skills。</div><div class="analysis-status" id="identityAnalysisStatus"></div>`;
  settingsBody.append(header);
  header.querySelector("#aiGenBtn").addEventListener("click", aiAnalyzeIdentities);
  header.querySelector("#aiGenBtn").disabled = identityAnalysisState.running;
  header.querySelector("#autoGenBtn").addEventListener("click", autoGenIdentities);
  header.querySelector("#addIdBtn").addEventListener("click", createIdentityDlg);
  renderIdentityAnalysisStatus();

  for (const identity of data.identities) {
    const card = document.createElement("div");
    card.className = "slist-item" + (identity.active ? " is-active" : "");
    const cats = identity.categories || {};
    const enabledCats = Object.entries(cats).filter(([, v]) => v.enabled);
    const catNames = enabledCats.map(([cid]) => data.categoryInfo[cid]?.name || cid).join(", ");
    const totalSkills = identitySkillCount(identity);
    const isAuto = identity.autoGenerated;
    var iconHtml = '<div class="slist-icon">' + (identity.icon || "ID") + '</div>';
    var bodyHtml = '<div class="slist-body"><div class="slist-name">' + escapeHtml(identity.name) + (isAuto ? ' <span style="font-size:10px;color:var(--td-text-color-disabled);">模板</span>' : "") + '</div><div class="slist-sub">' + escapeHtml(identity.description || "") + '</div><div class="slist-sub" style="margin-top:2px;">' + enabledCats.length + " 分类 / " + totalSkills + " Skills | " + catNames + '</div></div>';
    var actHtml = '<div class="slist-actions"><button class="st-btn t-btn--link" data-act="switch">' + (identity.active ? "已激活" : "切换") + '</button><button class="st-btn t-btn--link" data-act="edit">技能配置</button><button class="st-btn t-btn--link" data-act="sync">同步</button><button class="st-btn t-btn--danger t-btn--sm" data-act="delete">删除</button></div>';
    card.innerHTML = iconHtml + bodyHtml + actHtml;
    card.querySelector('[data-act="switch"]').addEventListener("click", () => switchIdentity(identity.id));
    card.querySelector('[data-act="edit"]').addEventListener("click", () => editIdentityCategories(identity));
    card.querySelector('[data-act="sync"]').addEventListener("click", async () => {
      await switchIdentity(identity.id);
      await syncActiveIdentity();
    });
    card.querySelector('[data-act="delete"]').addEventListener("click", () => deleteIdentityDlg(identity));
    settingsBody.append(card);
  }

  // ── Section 2: Collaboration map ──
  if (data.identities.length >= 2) {
    const divider = document.createElement("div");
    divider.style.cssText = "margin:14px 0 8px;font-size:12px;font-weight:600;color:var(--td-text-color-disabled);text-transform:uppercase;letter-spacing:0.5px;";
    divider.textContent = "协作关系图";
    settingsBody.append(divider);

    const desc = document.createElement("div");
    desc.className = "scard";
    desc.innerHTML = `<div class="slist-sub">以下展示身份之间的能力交集。共享技能越多，协作潜力越强。点击节点可切换身份。</div>`;
    settingsBody.append(desc);

    const center = active || data.identities[0];
    const relations = buildTeamRelations(center, data.identities);
    const map = document.createElement("div");
    map.className = "team-map";
    map.innerHTML = `
      <div class="team-node team-node-main">
        <strong>${escapeHtml(center.icon || "ID")} ${escapeHtml(center.name || "当前")}</strong>
        <span>${escapeHtml(center.description || "中心身份")} · ${identityCapabilitySet(center).size} 能力</span>
      </div>
      <div class="team-links"></div>
    `;
    const links = map.querySelector(".team-links");
    for (const relation of relations) {
      const row = document.createElement("div");
      row.className = `team-link strength-${relation.strength}`;
      row.innerHTML = `
        <button class="team-node" type="button">
          <strong>${escapeHtml(relation.identity.icon || "ID")} ${escapeHtml(relation.identity.name || "未命名")}</strong>
          <span>${escapeHtml(relation.reason)}</span>
        </button>
        <div class="team-edge"><span>${relation.score}</span></div>
      `;
      row.querySelector(".team-node").addEventListener("click", () => switchIdentity(relation.identity.id));
      links.append(row);
    }
    settingsBody.append(map);
  }
}

function classifyPlugin(plugin) {
  const haystack = ((plugin.name || "") + " " + (plugin.description || "")).toLowerCase();
  const rules = [
    ["coding", /(tdd|prototype|caveman|diagnose|handoff|code.?review|refactor|workflow|productivity|dev(elopment)?\b|programming|git\b|build|test|compile)/],
    ["security-web", /(xss|sqli|ssrf|csrf|cors|web\b|http|browser|frontend|clickjack|redirect|smuggl|waf.?bypass|upload|traversal)/],
    ["security-injection", /(injection|cmdi|sql|template|command|custom.?inject|nosql|expression|jndi|prototype.?pollution)/],
    ["security-auth", /(auth|jwt|oauth|saml|token|session|login|permission|bypass.*auth|401|403)/],
    ["security-binary", /(binary|exploit|reverse|buffer|heap|stack|debug|disassembl|asm|shellcode|rop|format.?string)/],
    ["security-os", /(privilege|lateral|kernel|container|sandbox|persist|linux|windows\b|system\b|root|sudo|av.?evasion)/],
    ["security-infra", /(kubernetes|dns\b|network|active.?directory|kerberos|ntlm|tunnel|proxy|scan|recon|enum)/],
    ["security-crypto", /(crypto|rsa|cipher|hash|encrypt|decrypt|signing|lattice)/],
    ["security-mobile", /(android|ios|mobile|apk|ipa|swift|kotlin|ssl.?pin)/],
    ["security-misc", /(security|pentest|red.?team|blue.?team|vulnerab|exploit|attack|waf|forensic|stegano|race.?condition|smart.?contract|social.?engineer)/],
  ];
  for (const [cat, pat] of rules) { if (pat.test(haystack)) return cat; }
  return "other";
}

async function editIdentityCategories(identity) {
  const refreshEdit = async () => {
    const updated = data.identities.find(i => i.id === identity.id);
    if (updated) await editIdentityCategories(updated);
    else renderSettingsTab();
  };

  settingsBody.innerHTML = "";
  const backBtn = document.createElement("button");
  backBtn.className = "st-btn t-btn--link";
  backBtn.textContent = "← 返回";
  backBtn.addEventListener("click", renderSettingsTab);
  settingsBody.append(backBtn);

  const title = document.createElement("div");
  title.style.cssText = "font-size:14px;font-weight:700;padding:8px 0;";
  title.textContent = `${identity.icon || ""} ${identity.name} - 技能与插件配置`;
  settingsBody.append(title);

  // Pre-classify plugins
  const pluginCats = {};
  for (const p of data.plugins) {
    const cat = classifyPlugin(p);
    if (!pluginCats[cat]) pluginCats[cat] = [];
    pluginCats[cat].push(p);
  }

  const catEntries = Object.entries(data.categoryInfo);
  for (const [catId, catInfo] of catEntries) {
    const catData = (identity.categories || {})[catId] || { enabled: false, skills: {} };
    const catSkills = (data.categorizedSkills || []).filter(s => s.category === catId);
    const catPlugins = pluginCats[catId] || [];
    const allSpecific = Object.keys(catData.skills || {}).length > 0;
    const hasExplicitInclude = allSpecific && Object.values(catData.skills || {}).some(v => v === true);
    const hasExcluded = allSpecific && Object.values(catData.skills || {}).some(v => v === false);
    const allChecked = catData.enabled && !hasExplicitInclude && !hasExcluded;
    const defaultExpanded = catData.enabled;

    const catCard = document.createElement("div");
    catCard.className = "scard";
    catCard.style.cssText = "overflow:hidden;";

    // ── Clickable header ──
    const catHead = document.createElement("div");
    catHead.className = "scard-head cat-collapse-head";
    catHead.style.cursor = "pointer";
    catHead.style.userSelect = "none";

    const arrow = document.createElement("span");
    arrow.style.cssText = "display:inline-block;width:12px;font-size:10px;transition:transform 0.15s;color:var(--td-text-color-disabled);";
    arrow.textContent = "▶";
    if (defaultExpanded) arrow.style.transform = "rotate(90deg)";

    const catToggle = document.createElement("input");
    catToggle.type = "checkbox";
    catToggle.checked = catData.enabled;
    catToggle.className = "cat-toggle";
    catToggle.addEventListener("click", e => e.stopPropagation());
    catToggle.addEventListener("change", async () => {
      const r = await safeBridge("setCategoryEnabled", null, identity.id, catId, catToggle.checked);
      if (r.ok) { identity.categories = r.data.identity.categories; await refreshEdit(); }
    });

    const catLabel = document.createElement("span");
    catLabel.className = "scard-title";
    catLabel.style.cssText = "flex:1;";
    catLabel.textContent = `${catInfo.icon || ""} ${catInfo.name}`;

    const skillsWithFiles = catSkills.filter(s => s.inCcSwitch).length;
    const counts = document.createElement("span");
    counts.style.cssText = "font-size:11px;color:var(--td-text-color-disabled);font-weight:400;";
    counts.textContent = (skillsWithFiles !== catSkills.length)
      ? "Skills " + skillsWithFiles + "/" + catSkills.length + (catPlugins.length ? " / 插件 " + catPlugins.length : "")
      : catSkills.length + " Skills" + (catPlugins.length ? " / " + catPlugins.length + " 插件" : "");

    catHead.append(arrow, catToggle, catLabel, counts);
    catCard.append(catHead);

    // ── Collapsible body ──
    const catBody = document.createElement("div");
    catBody.className = "cat-collapse-body";
    catBody.style.display = defaultExpanded ? "block" : "none";

    catHead.addEventListener("click", e => {
      if (e.target.closest("input")) return;
      const isOpen = catBody.style.display === "block";
      catBody.style.display = isOpen ? "none" : "block";
      arrow.style.transform = isOpen ? "" : "rotate(90deg)";
    });

    // ── Skills section — always visible when expanded ──
    if (catSkills.length > 0) {
      const skillsLabel = document.createElement("div");
      skillsLabel.style.cssText = "font-size:10px;font-weight:700;color:var(--td-text-color-disabled);text-transform:uppercase;letter-spacing:0.5px;padding:4px 4px 2px;";
      skillsLabel.textContent = "Skills";
      const tree = document.createElement("div");
      tree.className = "cat-tree";

      const availableSkills = catSkills.filter(s => s.inCcSwitch);
      const enabledCount = selectedSkillDirsForCategory(catData, availableSkills).length;
      const allRow = document.createElement("div");
      allRow.className = "cat-row";
      const allToggle = document.createElement("input");
      allToggle.type = "checkbox";
      allToggle.checked = catData.enabled && allChecked;
      allToggle.className = "cat-toggle";
      allToggle.addEventListener("change", async () => {
        allToggle.disabled = true;
        if (allToggle.checked) {
          // Enable category → enable all skills
          const r = await safeBridge("setCategoryEnabled", null, identity.id, catId, true);
          if (r.ok) {
            identity.categories = r.data.identity.categories;
            const r2 = await safeBridge("enableAllInCategory", null, identity.id, catId);
            if (r2.ok) { identity.categories = r2.data.identity.categories; }
            await refreshEdit();
          } else { allToggle.checked = false; toast("操作失败", "error"); }
        } else {
          // Disable category entirely
          const r = await safeBridge("setCategoryEnabled", null, identity.id, catId, false);
          if (r.ok) { identity.categories = r.data.identity.categories; await refreshEdit(); }
          else { allToggle.checked = true; toast("操作失败", "error"); }
        }
        allToggle.disabled = false;
      });
      const allLabel = document.createElement("span");
      allLabel.className = "cat-label";
      allLabel.style.fontWeight = "600";
      allLabel.textContent = catData.enabled
        ? "全部 (" + enabledCount + "/" + availableSkills.length + ")"
        : "全部 (" + availableSkills.length + " 可用, " + (catSkills.length - availableSkills.length) + " 缺失)";
      allLabel.style.color = catData.enabled ? "" : "var(--td-text-color-disabled)";
      allRow.append(allToggle, allLabel);
      tree.append(allRow);

      for (const skill of catSkills.slice(0, 30)) {
        const skillEnabled = catData.enabled && (hasExplicitInclude ? catData.skills[skill.directory] === true : catData.skills[skill.directory] !== false);
        const sRow = document.createElement("div");
        sRow.className = "skill-row";
        const sToggle = document.createElement("input");
        sToggle.type = "checkbox";
        sToggle.checked = skillEnabled;
        sToggle.disabled = !catData.enabled;
        sToggle.className = "skill-toggle";
        sToggle.addEventListener("change", async () => {
          if (!catData.enabled) return;
          sToggle.disabled = true;
          const r = await safeBridge("setSkillInCategory", null, identity.id, catId, skill.directory, sToggle.checked);
          if (r.ok) {
            identity.categories = r.data.identity.categories;
            await refreshEdit();
          } else {
            sToggle.checked = !sToggle.checked;
            toast("操作失败", "error");
          }
          sToggle.disabled = false;
        });
        const sLabel = document.createElement("span");
        sLabel.className = "skill-label";
        sLabel.textContent = skill.inCcSwitch ? skill.name : skill.name + " (缺失源文件)";
        sLabel.title = skill.directory;
        if (!catData.enabled) sLabel.style.color = "var(--td-text-color-disabled)";
        if (!skill.inCcSwitch) { sLabel.style.color = "var(--td-error-color)"; sToggle.disabled = true; }
        sRow.append(sToggle, sLabel);
        tree.append(sRow);
      }
      if (catSkills.length > 30) {
        const more = document.createElement("div");
        more.style.cssText = "font-size:10px;color:var(--td-text-color-disabled);padding:4px 12px;";
        more.textContent = `... 还有 ${catSkills.length - 30} 个`;
        tree.append(more);
      }

      catBody.append(skillsLabel, tree);
    } else {
      const emptySkills = document.createElement("div");
      emptySkills.style.cssText = "padding:6px 4px;color:var(--td-text-color-disabled);font-size:11px;";
      emptySkills.textContent = "此分类暂无 Skills";
      catBody.append(emptySkills);
    }

    // ── Plugins section — always visible ──
    const pluginsLabel = document.createElement("div");
    pluginsLabel.style.cssText = "font-size:10px;font-weight:700;color:var(--td-text-color-disabled);text-transform:uppercase;letter-spacing:0.5px;padding:8px 4px 2px;border-top:1px solid var(--td-border-level-2-color);";
    pluginsLabel.textContent = `插件${catPlugins.length ? " (" + catPlugins.length + ")" : ""}`;
    catBody.append(pluginsLabel);

    if (catPlugins.length > 0) {
      for (const p of catPlugins) {
        const prow = document.createElement("div");
        prow.className = "skill-row";
        prow.style.cssText = "justify-content:space-between;padding:4px 4px 4px 0;";
        prow.innerHTML = `
          <span class="skill-label" title="${escapeHtml(p.path || "")}">🔌 ${escapeHtml(p.name)} ${p.version ? `<span style="color:var(--td-text-color-disabled);">v${escapeHtml(p.version)}</span>` : ""}</span>
          <button class="st-btn t-btn--link" style="font-size:10px;padding:0 4px;height:18px;">查看</button>
        `;
        prow.querySelector("button").addEventListener("click", () => bridge?.openPath?.(p.path));
        catBody.append(prow);
      }
    } else {
      const emptyPlugins = document.createElement("div");
      emptyPlugins.style.cssText = "padding:4px 4px;color:var(--td-text-color-disabled);font-size:11px;";
      emptyPlugins.textContent = "暂无插件";
      catBody.append(emptyPlugins);
    }

    // ── Install plugin — unified button ──
    const addRow = document.createElement("div");
    addRow.style.cssText = "display:flex;gap:4px;align-items:center;padding:6px 4px 0;border-top:1px solid var(--td-border-level-2-color);margin-top:6px;flex-wrap:wrap;";
    const installBtn = document.createElement("button");
    installBtn.className = "st-btn t-btn--link";
    installBtn.style.fontSize = "11px";
    installBtn.textContent = "+ 安装插件";
    installBtn.title = "安装插件到此分类";
    installBtn.addEventListener("click", async e => {
      e.stopPropagation();
      catBody.style.display = "block";
      arrow.style.transform = "rotate(90deg)";

      const result = await showModal("安装插件", [
        { key: "source", label: "源 (留空则从文件夹安装)", value: "", placeholder: "marketplace 格式: name@marketplace  或留空选择文件夹" },
        { key: "note", label: "", value: "两种方式：\n1. 输入 name@marketplace → 通过 Claude CLI 命令安装\n2. 留空 → 弹出文件夹选择，复制到 ~/.claude/plugins/", type: "textarea" },
      ]);

      if (result === null) return; // cancelled

      if (result.source?.trim()) {
        // CLI install
        toast(`正在通过 Claude CLI 安装 ${result.source.trim()}...`);
        const r = await safeBridge("installPluginByName", null, result.source.trim());
        if (r.ok) {
          toast(`已安装：${result.source.trim()}`, "success");
        } else {
          toast(r.error || "安装失败", "error");
          return;
        }
      } else {
        // Folder install
        const folder = await bridge?.chooseFolder?.();
        if (!folder) return;
        toast("正在安装插件...");
        const r = await safeBridge("importPluginFolder", null, folder);
        if (!r.ok) { toast(r.error || "安装失败", "error"); return; }
        toast(`已安装：${r.data?.manifest?.name || r.data?.pluginId || "插件"}`, "success");
      }

      // Auto refresh after install — retry if needed
      await loadPlugins();
      // Small delay then retry to ensure filesystem sync
      setTimeout(async () => {
        await loadPlugins();
        await refreshEdit();
      }, 600);
    });
    addRow.append(installBtn);
    catBody.append(addRow);

    catCard.append(catBody);
    settingsBody.append(catCard);
  }
}

async function switchIdentity(id) {
  const r = await safeBridge("setActiveIdentity", null, id);
  if (r.ok) {
    toast("已切换: " + (r.data?.active?.name || ""), "success");
    // Auto-sync skills for the new identity
    const sr = await safeBridge("syncIdentitySkills", null, id);
    if (sr.ok) {
      var copied = sr.data?.copied?.length || 0;
      var missing = sr.data?.missing?.length || 0;
      var msg = "Skills 已同步 " + copied + " 个";
      if (missing > 0) msg += ", " + missing + " 个缺失源文件";
      toast(msg, missing > 0 ? "error" : "success");
    }
    await loadIdentities();
    renderSettingsTab();
    updateFooter();
  } else toast(r.error || "切换失败", "error");
}

async function autoGenIdentities() {
  const r = await safeBridge("autoGenerateIdentities", null);
  if (r.ok) { toast(`已生成 ${r.data?.generated || 0} 个身份`, "success"); await loadIdentities(); renderSettingsTab(); }
  else toast(r.error || "生成失败", "error");
}

async function aiAnalyzeIdentities() {
  if (!data.skills.length) {
    await loadSkillCategories();
  }
  if (!bridge?.analyzeSkillsIdentities) {
    toast("桥接缺失，无法分析 Skills", "error");
    return;
  }
  identityAnalysisState = { running: true, status: "starting", message: "正在启动 Skills 分类分析..." };
  renderIdentityAnalysisStatus();
  renderSettingsTab();
  toast("正在分类 Skills，进度会显示在身份页顶部...");
  const r = await withTimeout(
    bridge.analyzeSkillsIdentities(),
    150000,
    { ok: false, error: "analyzeSkillsIdentities still running or timed out after 150s" },
  );
  if (!r.ok) {
    identityAnalysisState = { running: false, status: "error", message: r.error || "AI 分析失败" };
    renderIdentityAnalysisStatus();
    toast(r.error || "AI 分析失败", "error");
    return;
  }
  const source = r.data?.source === "ai-analysis" ? "AI" : "本地聚类";
  const warning = r.data?.warning ? "（AI 未完成，已兜底）" : "";
  identityAnalysisState = { running: false, status: "done", message: `${source} 已生成 ${r.data?.generated || 0} 个身份 ${warning}` };
  toast(`${source} 已生成 ${r.data?.generated || 0} 个身份 ${warning}`, r.data?.warning ? "info" : "success");
  await loadSkillCategories();
  await loadIdentities();
  renderSettingsTab();
}

async function createIdentityDlg() {
  const result = await showModal("创建身份", [
    { key: "name", label: "名称", value: "新身份" },
    { key: "icon", label: "图标", value: "📌" },
    { key: "description", label: "描述", value: "" },
  ]);
  if (!result || !result.name) return;
  const r = await safeBridge("createIdentity", null, result);
  if (r.ok) { toast(`已创建：${result.name}`, "success"); await loadIdentities(); renderSettingsTab(); }
  else toast(r.error || "创建失败", "error");
}

async function deleteIdentityDlg(identity) {
  if (!await showConfirm("删除", `确定删除「${identity.name}」？`)) return;
  const r = await safeBridge("deleteIdentity", null, identity.id);
  if (r.ok) { toast("已删除", "success"); await loadIdentities(); renderSettingsTab(); }
  else toast(r.error || "删除失败", "error");
}

// ── Skills Settings ──

function renderSkillsSettings() {
  if (!skillCategoriesLoaded && !renderSkillsSettings.loading) {
    renderSkillsSettings.loading = true;
    loadSkillCategories().finally(() => {
      renderSkillsSettings.loading = false;
      if (settingsPage.classList.contains("is-open") && state.panel === "skills") renderSettingsTab();
    });
  }
  const activeIdentity = data.identities.find(i => i.active);
  const availableSkills = data.skills.filter(s => s.inCcSwitch !== false).length;
  const syncedSkills = data.skills.filter(s => s.inClaude).length;
  const activeSkillCount = activeIdentity ? identitySkillCount(activeIdentity) : 0;

  // ── Header ──
  const header = document.createElement("div");
  header.className = "scard";
  header.innerHTML = '<div class="scard-head"><span class="scard-title">Skills (' + data.skills.length + ')</span><div class="scard-actions"><button class="st-btn t-btn--link" id="rescanSkillsBtn">重新检测</button><button class="st-btn t-btn--link" id="previewSkillsBtn">同步预览</button><button class="st-btn t-btn--primary t-btn--sm" id="importSkillBtn">导入</button><button class="st-btn t-btn--link" id="syncSkillsBtn">同步到 Claude</button></div></div>';
  header.insertAdjacentHTML("beforeend", '<div class="skill-health">总数 ' + data.skills.length + ' · 源文件可用 ' + availableSkills + ' · Claude 已同步 ' + syncedSkills + ' · 当前身份将同步 ' + activeSkillCount + '</div>');
  settingsBody.append(header);
  header.querySelector("#rescanSkillsBtn").addEventListener("click", async () => {
    toast("正在扫描 Skills 目录...");
    const r = await safeBridge("rescanSkills", null);
    if (r.ok) {
      var d = r.data || {};
      toast("扫描完成: 新增 " + (d.added || 0) + " / 更新 " + (d.updated || 0) + " / 移除 " + (d.removed || 0), "success");
      await loadSkillCategories();
      await loadIdentities();
      renderSettingsTab();
    } else toast(r.error || "检测失败", "error");
  });
  header.querySelector("#previewSkillsBtn").addEventListener("click", previewSkillsSync);
  header.querySelector("#importSkillBtn").addEventListener("click", importSkill);
  header.querySelector("#syncSkillsBtn").addEventListener("click", syncActiveIdentity);

  // ── Search ──
  const searchRow = document.createElement("div");
  searchRow.style.cssText = "padding:4px 0;";
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.placeholder = "搜索 Skills...";
  searchInput.style.cssText = "width:100%;padding:6px 10px;border:1px solid var(--td-border-level-1-color);border-radius:6px;background:var(--td-bg-color-page);color:var(--td-text-color-primary);font-size:12px;outline:none;";
  searchRow.append(searchInput);
  settingsBody.append(searchRow);

  const filterText = () => (searchInput.value || "").toLowerCase();
  const skillMatchesFilter = s => !filterText() || (s.name || "").toLowerCase().includes(filterText()) || (s.directory || "").toLowerCase().includes(filterText()) || (s.description || "").toLowerCase().includes(filterText());

  // ── Build identity-skill mapping ──
  const skillIdentityMap = new Map(); // skillDir -> Set<identityId>
  for (const identity of data.identities) {
    const dirs = resolvedIdentitySkillDirs(identity);
    for (const dir of dirs) {
      if (!skillIdentityMap.has(dir)) skillIdentityMap.set(dir, new Set());
      skillIdentityMap.get(dir).add(identity.id);
    }
  }
  const unassignedSkills = data.skills.filter(s => s.inCcSwitch !== false && !skillIdentityMap.has(s.directory));

  // ── Render container for dynamic content ──
  const dynContainer = document.createElement("div");
  dynContainer.id = "skillsDynContainer";
  settingsBody.append(dynContainer);

  function renderSkillsContent() {
    dynContainer.innerHTML = "";
    const ft = filterText();

    // ── Identity sections ──
    if (data.identities.length) {
      for (const identity of data.identities) {
        const idDirs = resolvedIdentitySkillDirs(identity);
        const idSkills = data.skills.filter(s => idDirs.includes(s.directory) && s.inCcSwitch !== false);
        const filteredSkills = ft ? idSkills.filter(skillMatchesFilter) : idSkills;
        const totalInId = idSkills.length;

        // Skip empty identities when searching
        if (ft && !filteredSkills.length) continue;

        const isActive = identity.active;
        const expanded = ft ? true : (state.expandedSkillsIdentities || {})[identity.id] !== false;

        const section = document.createElement("div");
        section.className = "scard";
        section.style.cssText = "overflow:hidden;";

        // Identity header
        const idHead = document.createElement("div");
        idHead.className = "scard-head cat-collapse-head";
        idHead.style.cursor = "pointer";
        idHead.style.userSelect = "none";

        const arrow = document.createElement("span");
        arrow.style.cssText = "display:inline-block;width:12px;font-size:10px;transition:transform 0.15s;color:var(--td-text-color-disabled);";
        arrow.textContent = "▶";
        if (expanded) arrow.style.transform = "rotate(90deg)";

        const idLabel = document.createElement("span");
        idLabel.className = "scard-title";
        idLabel.style.cssText = "flex:1;";
        idLabel.textContent = (identity.icon || "") + " " + identity.name + (isActive ? " (当前)" : "");

        const idCounts = document.createElement("span");
        idCounts.style.cssText = "font-size:11px;color:var(--td-text-color-disabled);font-weight:400;";
        const enabledCats = Object.entries(identity.categories || {}).filter(([, v]) => v.enabled).length;
        idCounts.textContent = enabledCats + " 分类 / " + totalInId + " Skills";

        const idActions = document.createElement("span");
        idActions.style.cssText = "margin-left:8px;display:flex;gap:4px;";
        const switchBtn = document.createElement("button");
        switchBtn.className = "st-btn t-btn--link";
        switchBtn.style.cssText = "font-size:10px;padding:0 6px;height:20px;";
        switchBtn.textContent = isActive ? "已激活" : "切换";
        switchBtn.addEventListener("click", e => { e.stopPropagation(); switchIdentity(identity.id); });
        const syncBtn = document.createElement("button");
        syncBtn.className = "st-btn t-btn--link";
        syncBtn.style.cssText = "font-size:10px;padding:0 6px;height:20px;";
        syncBtn.textContent = "同步";
        syncBtn.addEventListener("click", async e => {
          e.stopPropagation();
          await switchIdentity(identity.id);
          await syncActiveIdentity();
          await loadSkillCategories();
          renderSkillsContent();
        });
        idActions.append(switchBtn, syncBtn);

        idHead.append(arrow, idLabel, idCounts, idActions);
        section.append(idHead);

        // Identity body
        const idBody = document.createElement("div");
        idBody.className = "cat-collapse-body";
        idBody.style.display = expanded ? "block" : "none";

        idHead.addEventListener("click", e => {
          if (e.target.closest("button") || e.target.closest("input")) return;
          const isOpen = idBody.style.display === "block";
          idBody.style.display = isOpen ? "none" : "block";
          arrow.style.transform = isOpen ? "" : "rotate(90deg)";
          if (!state.expandedSkillsIdentities) state.expandedSkillsIdentities = {};
          state.expandedSkillsIdentities[identity.id] = !isOpen;
          save();
        });

        // Render categories within identity
        const catEntries = Object.entries(data.categoryInfo);
        for (const [catId, catInfo] of catEntries) {
          const catData = (identity.categories || {})[catId] || { enabled: false, skills: {} };
          if (!catData.enabled) continue;

          const catSkillsAll = (data.categorizedSkills || data.skills || []).filter(s => s.category === catId && s.inCcSwitch !== false);
          if (!catSkillsAll.length) continue;

          const filteredCatSkills = ft ? catSkillsAll.filter(skillMatchesFilter) : catSkillsAll;
          if (ft && !filteredCatSkills.length) continue;

          const allSpecific = Object.keys(catData.skills || {}).length > 0;
          const hasExplicitInclude = allSpecific && Object.values(catData.skills || {}).some(v => v === true);
          const allChecked = !hasExplicitInclude && !Object.values(catData.skills || {}).some(v => v === false);
          const enabledDirs = selectedSkillDirsForCategory(catData, catSkillsAll);
          const enabledSet = new Set(enabledDirs);

          // Category sub-header
          const catHeader = document.createElement("div");
          catHeader.style.cssText = "display:flex;align-items:center;gap:6px;padding:6px 8px 2px;font-size:11px;font-weight:600;color:var(--td-text-color-secondary);";
          catHeader.innerHTML = '<span>' + (catInfo.icon || "") + " " + catInfo.name + '</span><span style="font-weight:400;color:var(--td-text-color-disabled);">' + enabledSet.size + "/" + catSkillsAll.length + '</span>';

          // Category toggle
          const catToggle = document.createElement("input");
          catToggle.type = "checkbox";
          catToggle.checked = allChecked;
          catToggle.className = "cat-toggle";
          catToggle.style.cssText = "margin-left:auto;";
          catToggle.addEventListener("click", e => e.stopPropagation());
          catToggle.addEventListener("change", async () => {
            catToggle.disabled = true;
            if (catToggle.checked) {
              const r = await safeBridge("enableAllInCategory", null, identity.id, catId);
              if (r.ok) { identity.categories = r.data.identity.categories; }
            } else {
              const r = await safeBridge("disableAllInCategory", null, identity.id, catId);
              if (r.ok) { identity.categories = r.data.identity.categories; }
            }
            await loadIdentities();
            renderSkillsContent();
          });
          catHeader.prepend(catToggle);

          idBody.append(catHeader);

          // Skills list
          for (const skill of filteredCatSkills.slice(0, 30)) {
            const isEnabled = enabledSet.has(skill.directory);
            const sRow = document.createElement("div");
            sRow.className = "skill-row";
            sRow.style.cssText = "padding-left:20px;";

            const sToggle = document.createElement("input");
            sToggle.type = "checkbox";
            sToggle.checked = isEnabled;
            sToggle.className = "skill-toggle";
            sToggle.addEventListener("change", async () => {
              sToggle.disabled = true;
              const r = await safeBridge("setSkillInCategory", null, identity.id, catId, skill.directory, sToggle.checked);
              if (r.ok) {
                identity.categories = r.data.identity.categories;
                await loadIdentities();
                renderSkillsContent();
              } else {
                sToggle.checked = !sToggle.checked;
                toast("操作失败", "error");
              }
              sToggle.disabled = false;
            });

            const sLabel = document.createElement("span");
            sLabel.className = "skill-label";
            sLabel.textContent = skill.name;
            sLabel.title = skill.directory + (skill.description ? "\n" + skill.description : "");

            sRow.append(sToggle, sLabel);
            idBody.append(sRow);
          }
          if (filteredCatSkills.length > 30) {
            const more = document.createElement("div");
            more.style.cssText = "font-size:10px;color:var(--td-text-color-disabled);padding:4px 24px;";
            more.textContent = "... 还有 " + (filteredCatSkills.length - 30) + " 个";
            idBody.append(more);
          }
        }

        if (!idBody.children.length) {
          const empty = document.createElement("div");
          empty.style.cssText = "padding:8px;color:var(--td-text-color-disabled);font-size:11px;";
          empty.textContent = ft ? "无匹配 Skills" : "此身份下暂无已启用的分类";
          idBody.append(empty);
        }

        section.append(idBody);
        dynContainer.append(section);
      }
    }

    // ── Unassigned Skills ──
    const unassigned = ft ? unassignedSkills.filter(skillMatchesFilter) : unassignedSkills;
    if (unassigned.length > 0 || !data.identities.length) {
      const section = document.createElement("div");
      section.className = "scard";
      section.style.cssText = "overflow:hidden;";

      const uHead = document.createElement("div");
      uHead.className = "scard-head cat-collapse-head";
      uHead.style.cursor = "pointer";
      uHead.style.userSelect = "none";

      const uArrow = document.createElement("span");
      uArrow.style.cssText = "display:inline-block;width:12px;font-size:10px;transition:transform 0.15s;color:var(--td-text-color-disabled);";
      uArrow.textContent = "▶";

      const uLabel = document.createElement("span");
      uLabel.className = "scard-title";
      uLabel.style.cssText = "flex:1;";
      uLabel.textContent = "📦 未归属身份的 Skills";

      const uCount = document.createElement("span");
      uCount.style.cssText = "font-size:11px;color:var(--td-text-color-disabled);font-weight:400;";
      uCount.textContent = unassigned.length + " 个";

      uHead.append(uArrow, uLabel, uCount);
      section.append(uHead);

      const uBody = document.createElement("div");
      uBody.className = "cat-collapse-body";
      uBody.style.display = "block";

      uHead.addEventListener("click", () => {
        const isOpen = uBody.style.display === "block";
        uBody.style.display = isOpen ? "none" : "block";
        uArrow.style.transform = isOpen ? "" : "rotate(90deg)";
      });

      // Group unassigned by category
      const uaByCat = {};
      for (const s of unassigned) {
        const c = s.category || "other";
        if (!uaByCat[c]) uaByCat[c] = [];
        uaByCat[c].push(s);
      }

      for (const [catId, skills] of Object.entries(uaByCat)) {
        const catInfo = data.categoryInfo[catId];
        const catLabel = document.createElement("div");
        catLabel.style.cssText = "font-size:11px;font-weight:600;color:var(--td-text-color-secondary);padding:6px 8px 2px;";
        catLabel.textContent = (catInfo?.icon || "") + " " + (catInfo?.name || catId) + " (" + skills.length + ")";
        uBody.append(catLabel);

        // Find which identities could include this category
        const identitiesWithCat = data.identities.filter(id => {
          const cd = (id.categories || {})[catId];
          return cd?.enabled;
        });

        for (const skill of skills.slice(0, 30)) {
          const sRow = document.createElement("div");
          sRow.className = "skill-row";
          sRow.style.cssText = "padding-left:20px;";

          const sLabel = document.createElement("span");
          sLabel.className = "skill-label";
          sLabel.textContent = skill.name;
          sLabel.title = skill.directory + (skill.description ? "\n" + skill.description : "");

          sRow.append(sLabel);

          // If this category is enabled in some identities but skill is excluded
          if (identitiesWithCat.length > 0) {
            const hint = document.createElement("span");
            hint.style.cssText = "font-size:9px;color:var(--td-warning-color);margin-left:8px;";
            hint.textContent = "在这些身份中被排除: " + identitiesWithCat.map(i => i.name).join(", ");
            sRow.append(hint);
          } else if (data.identities.length > 0) {
            const addBtn = document.createElement("button");
            addBtn.className = "st-btn t-btn--link";
            addBtn.style.cssText = "font-size:9px;padding:0 4px;height:16px;margin-left:8px;";
            addBtn.textContent = "归属到...";
            addBtn.addEventListener("click", async () => {
              // Show quick picker to add to an identity
              const opts = data.identities.map(id => ({
                label: (id.icon || "") + " " + id.name,
                value: id.id,
              }));
              const result = await showModal("选择身份", [
                { key: "identityId", label: "归属到", type: "select", options: [{ value: "", label: "-- 选择 --" }, ...opts], value: "" },
              ]);
              if (!result?.identityId) return;
              const r = await safeBridge("setSkillInCategory", null, result.identityId, catId, skill.directory, true);
              if (r.ok) {
                toast("已添加", "success");
                await loadIdentities();
                renderSkillsContent();
              } else toast(r.error || "操作失败", "error");
            });
            sRow.append(addBtn);
          }

          uBody.append(sRow);
        }
        if (skills.length > 30) {
          const more = document.createElement("div");
          more.style.cssText = "font-size:10px;color:var(--td-text-color-disabled);padding:4px 24px;";
          more.textContent = "... 还有 " + (skills.length - 30) + " 个";
          uBody.append(more);
        }
      }

      section.append(uBody);
      dynContainer.append(section);
    }

    if (!dynContainer.children.length) {
      const empty = document.createElement("div");
      empty.style.cssText = "padding:16px;color:var(--td-text-color-disabled);font-size:12px;text-align:center;";
      empty.textContent = ft ? "无匹配结果" : "暂无 Skills 或身份。请先在「身份与协作」页中 AI 生成身份。";
      dynContainer.append(empty);
    }
  }

  searchInput.addEventListener("input", renderSkillsContent);
  renderSkillsContent();
}

async function importSkill() {
  const folder = await bridge?.chooseFolder?.();
  if (!folder) return;
  const r = await safeBridge("importSkill", null, folder);
  if (r.ok) { toast("已导入: " + (r.data?.name || folder), "success"); await safeBridge("rescanSkills", null); await syncActiveIdentity(); await loadSkillCategories(); renderSettingsTab(); }
  else toast(r.error || "导入失败", "error");
}

async function previewSkillsSync() {
  const r = await safeBridge("previewSkillsSync", null);
  if (!r.ok) { toast(r.error || "预览失败", "error"); return; }
  const p = r.data || {};
  const text = [
    `将同步：${p.count || 0} 个 Skills`,
    `新增：${p.copy || 0}`,
    `覆盖：${p.overwrite || 0}`,
    `跳过未变化：${p.skipped || 0}`,
    `源缺失：${p.missing || 0}`,
    `Claude 中额外存在：${(p.extra || []).length}`,
    "",
    ...(p.planned || []).slice(0, 30).map(i => `${i.action}  ${i.name}`),
  ].join("\n");
  await showModal("Skills 同步预览", [{ key: "preview", label: "变更", value: text, type: "textarea" }]);
}

// ── MCP Settings ──

function renderMcpSettings() {
  const header = document.createElement("div");
  header.className = "scard";
  header.innerHTML = `<div class="scard-head"><span class="scard-title">MCP 服务 (${data.mcp.length})</span><div class="scard-actions"><button class="st-btn t-btn--link" id="previewMcpBtn">同步预览</button><button class="st-btn t-btn--link" id="syncMcpBtn">同步</button><button class="st-btn t-btn--primary t-btn--sm" id="addMcpBtn">添加</button><button class="st-btn t-btn--link" id="importMcpBtn">导入 JSON</button></div></div>`;
  settingsBody.append(header);
  header.querySelector("#previewMcpBtn").addEventListener("click", previewMcpSync);
  header.querySelector("#syncMcpBtn").addEventListener("click", async () => {
    const r = await safeBridge("syncMcp", null);
    if (r.ok) toast(`已同步 ${r.data?.count || 0} 个 MCP`, "success");
    else toast(r.error || "同步失败", "error");
  });
  header.querySelector("#addMcpBtn").addEventListener("click", addMcpDlg);
  header.querySelector("#importMcpBtn").addEventListener("click", importMcp);

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

async function addMcpDlg() {
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

async function importMcp() {
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

function renderPluginsSettings() {
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

async function importPluginFolder() {
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

function identityCapabilitySet(identity) {
  const set = new Set();
  for (const [categoryId, category] of Object.entries(identity.categories || {})) {
    if (!category?.enabled) continue;
    set.add(`cat:${categoryId}`);
  }
  for (const skill of resolvedIdentitySkillDirs(identity)) set.add(`skill:${skill}`);
  return set;
}

function buildTeamRelations(center, identities) {
  const centerCaps = identityCapabilitySet(center);
  return identities
    .filter(identity => identity.id !== center.id)
    .map(identity => {
      const caps = identityCapabilitySet(identity);
      const shared = [...caps].filter(cap => centerCaps.has(cap));
      const score = shared.length;
      const categoryNames = shared.filter(v => v.startsWith("cat:")).slice(0, 3).map(v => data.categoryInfo[v.slice(4)]?.name || v.slice(4));
      return {
        identity,
        score,
        strength: score >= 6 ? "high" : score >= 2 ? "mid" : "low",
        reason: score ? `共享 ${categoryNames.join(" / ") || score + " 个能力"}` : "互补能力",
      };
    })
    .sort((a, b) => b.score - a.score || String(a.identity.name || "").localeCompare(String(b.identity.name || "")));
}

// ── Other Settings ──

function renderRunnersSettings() {
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

async function renderUsageSettings() {
  settingsBody.innerHTML = `<div class="loading-msg" style="padding:20px;text-align:center;color:var(--td-text-color-disabled);">加载用量数据...</div>`;
  await loadUsage();

  const u = data.usage;
  if (!u || !u.totals || !u.totals.totalTokens) {
    settingsBody.innerHTML = `<div class="scard"><div class="scard-title">暂无用量数据</div><div class="slist-sub">使用 Claude Code 进行对话后，会自动统计 token 用量。数据来源于 ~/.claude/projects/ 下的对话记录。</div></div>`;
    return;
  }

  settingsBody.innerHTML = "";
  const t = u.totals || {};

  const cc = Number(t.cacheCreationTokens || 0);
  const cr = Number(t.cacheReadTokens || 0);
  const cacheTotal = cc + cr;
  const cacheHitRate = cacheTotal > 0 ? (cr / cacheTotal * 100).toFixed(1) : "0.0";

  var summary = document.createElement("div");
  summary.className = "scard";
  summary.innerHTML = '<div class="scard-head"><span class="scard-title">总计</span></div><div style="font-size:28px;font-weight:700;padding:4px 0;">' + fmtNum(t.totalTokens) + ' <span style="font-size:13px;font-weight:400;color:var(--td-text-color-disabled);">tokens</span></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">' +
    '<div class="slist-item" style="flex-direction:column;align-items:flex-start;gap:2px;"><div class="slist-sub">输入</div><div class="slist-name">' + fmtNum(t.inputTokens) + '</div></div>' +
    '<div class="slist-item" style="flex-direction:column;align-items:flex-start;gap:2px;"><div class="slist-sub">输出</div><div class="slist-name">' + fmtNum(t.outputTokens) + '</div></div>' +
    '<div class="slist-item" style="flex-direction:column;align-items:flex-start;gap:2px;"><div class="slist-sub">缓存写入</div><div class="slist-name">' + fmtNum(cc) + '</div></div>' +
    '<div class="slist-item" style="flex-direction:column;align-items:flex-start;gap:2px;"><div class="slist-sub">缓存读取</div><div class="slist-name">' + fmtNum(cr) + '</div></div>' +
    '</div>' +
    '<div style="margin-top:10px;padding:8px 12px;border-radius:6px;background:var(--td-bg-color-page);">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;"><span class="slist-sub">缓存命中率</span><span style="font-weight:700;color:' + (Number(cacheHitRate) > 30 ? 'var(--td-success-color)' : 'var(--td-warning-color)') + ';">' + cacheHitRate + '%</span></div>' +
    '</div>';
  settingsBody.append(summary);

  if ((u.byModel || []).length) {
    var mt = document.createElement("div");
    mt.style.cssText = "font-size:12px;font-weight:600;padding:12px 0 6px;";
    mt.textContent = "按模型";
    settingsBody.append(mt);
    for (var i = 0; i < (u.byModel || []).slice(0, 10).length; i++) {
      var m = (u.byModel || []).slice(0, 10)[i];
      var card = document.createElement("div");
      card.className = "slist-item";
      card.innerHTML = '<div class="slist-body"><div class="slist-name">' + escapeHtml(m.model) + '</div><div class="slist-sub">' + fmtNum(m.requests) + ' 请求 / 入 ' + fmtNum(m.inputTokens) + ' / 出 ' + fmtNum(m.outputTokens) + ' / 缓存写 ' + fmtNum(m.cacheCreationTokens || 0) + ' / 缓存读 ' + fmtNum(m.cacheReadTokens || 0) + '</div></div><div class="slist-badge">' + fmtNum(m.totalTokens) + '</div>';
      settingsBody.append(card);
    }
  }

  if ((u.byProject || []).length) {
    var pt = document.createElement("div");
    pt.style.cssText = "font-size:12px;font-weight:600;padding:12px 0 6px;";
    pt.textContent = "按项目";
    settingsBody.append(pt);
    for (var j = 0; j < (u.byProject || []).slice(0, 10).length; j++) {
      var p = (u.byProject || []).slice(0, 10)[j];
      var card = document.createElement("div");
      card.className = "slist-item";
      var nm = p.path ? basename(p.path) : (p.name || p.id);
      card.innerHTML = '<div class="slist-body"><div class="slist-name">' + escapeHtml(nm) + '</div><div class="slist-sub">' + fmtNum(p.requests) + ' 请求 / ' + fmtNum(p.totalTokens) + ' tokens</div></div><div class="slist-badge">' + fmtNum(p.totalTokens) + '</div>';
      settingsBody.append(card);
    }
  }
}

// Official Anthropic pricing per MTok (as of 2026) — https://www.anthropic.com/pricing
const OFFICIAL_PRICES = {
  "claude-opus-4-7":  { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.50 },
  "claude-opus-4-6":  { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.50 },
  "claude-opus-4-5":  { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.50 },
  "claude-opus-4":    { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.50 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
  "claude-sonnet-4-5": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
  "claude-sonnet-4":   { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
  "claude-haiku-4-5":  { input: 0.80, output: 4, cacheWrite: 1.00, cacheRead: 0.08 },
  "claude-haiku-4":    { input: 0.80, output: 4, cacheWrite: 1.00, cacheRead: 0.08 },
  "claude-3.5-sonnet": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
  "claude-3.5-haiku":  { input: 0.80, output: 4, cacheWrite: 1.00, cacheRead: 0.08 },
  "claude-3-opus":     { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.50 },
  default:             { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
};

function findPrice(model) {
  const key = (model || "").toLowerCase();
  // Custom price table first, then official, then default
  if (state.priceTable[key]) return { ...OFFICIAL_PRICES.default, ...state.priceTable[key] };
  for (const [k, v] of Object.entries(OFFICIAL_PRICES)) {
    if (key.includes(k)) return v;
  }
  return OFFICIAL_PRICES.default;
}

function estimateCost(item) {
  const p = findPrice(item.model);
  const inputCost = Number(item.inputTokens || 0) / 1e6 * p.input;
  const outputCost = Number(item.outputTokens || 0) / 1e6 * p.output;
  const cacheWriteCost = Number(item.cacheCreationTokens || 0) / 1e6 * p.cacheWrite;
  const cacheReadCost = Number(item.cacheReadTokens || 0) / 1e6 * p.cacheRead;
  return { input: inputCost, output: outputCost, cacheWrite: cacheWriteCost, cacheRead: cacheReadCost, total: inputCost + outputCost + cacheWriteCost + cacheReadCost };
}

async function renderDiagSettings() {
  settingsBody.innerHTML = `<div class="loading-msg">检测中...</div>`;
  await loadDiag();
  settingsBody.innerHTML = "";
  const d = data.diagnostics || {};
  const items = [
    ["Claude 路径", d.claudePath || "未找到"],
    ["Claude 版本", d.claudeVersion || "--"],
    ["Node 路径", d.nodePath || "--"],
    ["Node 版本", d.nodeVersion || "--"],
    ["后端 PID", d.backendPid || "--"],
    ["DB", d.ccSwitchDbExists ? "存在" : "不存在"],
    ["平台", d.platform || "--"],
    ["工作目录", state.cwd || "未设置"],
    ["策略", `${state.runnerStrategy} · ${state.permissionMode}`],
    ["数据", `项目 ${data.projects.length} · Skills ${data.skills.length} · MCP ${data.mcp.length}`],
  ];
  for (const [label, value] of items) {
    const card = document.createElement("div");
    card.className = "slist-item";
    card.innerHTML = `<div class="slist-body"><div class="slist-name">${label}</div><div class="slist-sub">${escapeHtml(value)}</div></div>`;
    settingsBody.append(card);
  }
  const actions = document.createElement("div");
  actions.className = "scard";
  actions.innerHTML = `<div class="scard-head"><span class="scard-title">诊断报告</span><div class="scard-actions"><button class="st-btn t-btn--link" id="rebuildIndexBtn">重建项目索引</button><button class="st-btn t-btn--link" id="checkClaudeBtn">检测 Claude</button><button class="st-btn t-btn--primary t-btn--sm" id="copyReportBtn">复制报告</button></div></div>`;
  settingsBody.append(actions);
  actions.querySelector("#rebuildIndexBtn").addEventListener("click", async () => {
    const r = await refreshProjectIndex();
    toast(r.ok ? "项目索引已重建" : (r.error || "项目索引重建失败"), r.ok ? "success" : "error");
    renderSettingsTab();
  });
  actions.querySelector("#checkClaudeBtn").addEventListener("click", async () => {
    const r = await safeBridge("checkClaude", null, state.claudePath);
    const d = r.data || {};
    if (d.claudePath) { state.claudePath = d.claudePath; save(); }
    toast(d.ok ? `Claude 可用：${d.version || d.claudePath}` : (d.error || "未找到 Claude"), d.ok ? "success" : "error");
    await loadDiag();
    renderSettingsTab();
  });
  actions.querySelector("#copyReportBtn").addEventListener("click", copyDiagnosticReport);
}

async function copyDiagnosticReport() {
  const r = await safeBridge("diagnosticReport", null, { cwd: state.cwd, claudePath: state.claudePath, errors: data.loadErrors });
  if (!r.ok) { toast(r.error || "生成报告失败", "error"); return; }
  const text = JSON.stringify(r.data, null, 2);
  await bridge?.copyText?.(text);
  await showModal("诊断报告", [{ key: "report", label: "已复制，也可手动查看", value: text, type: "textarea" }]);
}

function renderGeneralSettings() {
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
    claudeSetupState = { ...claudeSetupState, ...current, dismissed: cs.dismissed };

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
      claudeSetupState = { ...claudeSetupState, ...d };
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
      claudeSetupState.dismissed = false;
      toast("安装提醒已重新开启", "success");
      renderSettingsTab();
    });
  })();
}

// ── Conversations ──

function decodeProjectDisplay(name) {
  try {
    if (name.length >= 3 && name[1] === "-" && name[2] === "-") return name[0] + ":\\" + name.slice(3).replace(/-/g, "\\");
    return name.replace(/-/g, "/");
  } catch { return name; }
}

function renderProjects() {
  const list = $("#projectList");
  list.innerHTML = "";
  const term = state.searchTerm;
  for (const proj of data.projects.slice(0, 20)) {
    const hay = searchable(`${proj.path} ${proj.name}`);
    if (term && !hay.includes(term)) continue;
    const displayName = proj.path ? basename(proj.path) : decodeProjectDisplay(proj.name || proj.id);
    const node = document.createElement("button");
    node.className = `conv-item${proj.id === state.selectedProject ? " is-active" : ""}`;
    node.type = "button";
    node.innerHTML = `<div class="conv-item-body"><div class="conv-item-title" title="${escapeHtml(proj.path || decodeProjectDisplay(proj.name || ""))}">${hlMatch(displayName, term)}</div><div class="conv-item-time">${proj.sessionCount || 0} 轮 · ${fmtTime(proj.updatedAt)}</div></div>`;
    node.addEventListener("click", () => selectProject(proj));
    list.append(node);
  }
  if (!list.children.length) list.innerHTML = `<div style="padding:10px;color:var(--td-text-color-disabled);font-size:11px;text-align:center;">${initialLoadDone ? "暂无项目" : "加载中..."}</div>`;
}

function selectProject(proj) {
  const changedProject = state.selectedProject && state.selectedProject !== proj.id;
  state.selectedProject = proj.id;
  state.cwd = proj.path;
  if (changedProject || !state.selectedSession) {
    state.selectedSession = "";
    state.selectedSessionPath = "";
    state.clientSessionKey = crypto.randomUUID();
    state.messages = [];
    state.mode = "normal";
  } else {
    state.mode = "continue";
  }
  save();
  setMode(state.mode);
  renderProjects();
  renderConvs();
  renderMessages();
  updateFooter();
}

function renderConvs() {
  const list = $("#convList");
  list.innerHTML = "";
  const tpl = $("#tplConv");
  const proj = selProject();
  const term = state.searchTerm;
  const sessions = (proj?.sessions || [])
    .filter(s => !sessMeta(s.id).archived && !sessMeta(s.id).deleted)
    .sort((a, b) => Number(!!sessMeta(b.id).pinned) - Number(!!sessMeta(a.id).pinned) || (b.updatedAt || 0) - (a.updatedAt || 0));
  for (const s of sessions.slice(0, 30)) {
    const m = sessMeta(s.id);
    const title = m.title || s.title || s.id;
    if (term && !searchable(`${title} ${s.id}`).includes(term)) continue;
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.classList.toggle("is-active", s.id === state.selectedSession);
    node.querySelector(".conv-item-title").innerHTML = hlMatch(title, term);
    node.querySelector(".conv-item-time").textContent = fmtTime(s.updatedAt);
    node.querySelector(".conv-item-badge").textContent = m.pinned ? "置顶" : "";
    node.addEventListener("click", () => selectSession(proj, s));
    node.addEventListener("contextmenu", e => {
      e.preventDefault();
      showConvContextMenu(e, s, proj);
    });
    list.append(node);
  }
  if (!list.children.length) list.innerHTML = `<div style="padding:12px;color:var(--td-text-color-disabled);font-size:12px;text-align:center;">${initialLoadDone ? (proj ? "暂无对话" : "选择项目后显示") : "加载中..."}</div>`;
}

// ── Conversation context menu ──

function showConvContextMenu(e, session, proj) {
  const ctx = $("#ctxMenu");
  const meta = sessMeta(session.id);
  ctx.innerHTML = `
    <button class="model-option" data-act="pin" type="button">${meta.pinned ? "取消置顶" : "置顶"}</button>
    <button class="model-option" data-act="rename" type="button">重命名</button>
    <button class="model-option" data-act="archive" type="button">${meta.archived ? "取消归档" : "归档"}</button>
    <div style="height:1px;background:var(--td-border-level-2-color);margin:3px 6px;"></div>
    <button class="model-option" data-act="delete" type="button" style="color:var(--td-error-color);">删除</button>
  `;
  ctx.querySelectorAll("[data-act]").forEach(btn => {
    btn.addEventListener("click", async () => {
      ctx.classList.remove("is-open");
      const act = btn.dataset.act;
      if (act === "pin") { meta.pinned = !meta.pinned; save(); renderConvs(); }
      if (act === "archive") { meta.archived = !meta.archived; save(); renderConvs(); }
      if (act === "rename") {
        const result = await showModal("重命名对话", [
          { key: "title", label: "标题", value: meta.title || session.title || "" },
        ]);
        if (result?.title !== undefined) { meta.title = result.title || ""; save(); renderConvs(); }
      }
      if (act === "delete") {
        if (!await showConfirm("删除", `确定删除对话「${meta.title || session.title || session.id}」？\n\n注意：这会删除 ~/.claude/projects/ 下的对话文件。`)) return;
        meta.deleted = true;
        save();
        if (state.selectedSession === session.id) { state.selectedSession = ""; state.messages = []; state.selectedSessionPath = ""; state.mode = "normal"; save(); renderMessages(); }
        renderConvs();
      }
    });
  });
  ctx.style.top = `${e.clientY}px`;
  ctx.style.left = `${e.clientX}px`;
  ctx.style.right = "auto";
  ctx.style.bottom = "auto";
  ctx.classList.add("is-open");
  setTimeout(() => document.addEventListener("click", () => ctx.classList.remove("is-open"), { once: true }), 0);
}

// ── Messages ──

function renderMessages() {
  const transcript = $("#transcript");
  transcript.innerHTML = "";
  if (!state.messages.length) {
    transcript.innerHTML = `<div class="empty-state"><b>Claude Code Studio</b><span>选择项目并输入任务开始对话</span></div>`;
    return;
  }
  const tpl = $("#tplMessage");
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

// ── Footer ──

function updateFooter() {
  const p = curProvider();
  const active = data.identities.find(i => i.active);
  $("#providerInfo").textContent = p ? `${p.name} · ${p.model || ""}` : "未连接";
  $("#identityInfo").textContent = active ? `${active.icon || ""} ${active.name}` : "未设置身份";
  $("#cwdState").textContent = state.cwd || "未选择项目";
  updateModelLabel();
  renderContextStack();
}

// ── Data Loading ──

function compactPath(path) {
  const text = String(path || "");
  if (!text) return "--";
  if (text.length <= 42) return text;
  return `${text.slice(0, 18)}...${text.slice(-20)}`;
}

function indexStatusLabel() {
  if (projectIndexState.status === "queued") return "等待刷新";
  if (projectIndexState.status === "scanning") return "后台扫描中";
  if (projectIndexState.status === "done") {
    const count = projectIndexState.stats?.scannedProjects;
    return count ? `已索引 ${count} 个项目` : "已刷新";
  }
  if (projectIndexState.status === "error") return "刷新失败";
  return data.projects.length ? `缓存 ${data.projects.length} 个项目` : "未索引";
}

function appendKv(rows, key, value, tone = "") {
  rows.push(`<div class="ctx-row${tone ? ` is-${tone}` : ""}"><span>${escapeHtml(key)}</span><b title="${escapeHtml(String(value || ""))}">${escapeHtml(String(value || "--"))}</b></div>`);
}

function renderContextStack() {
  const overview = $("#contextOverview");
  if (!overview) return;
  const provider = curProvider();
  const identity = data.identities.find(i => i.active);
  const project = selProject();
  const rows = [];
  appendKv(rows, "Provider", provider ? provider.name : "--");
  appendKv(rows, "Model", provider?.model || "--");
  appendKv(rows, "Identity", identity ? `${identity.icon || ""} ${identity.name}` : "--");
  appendKv(rows, "Project", project?.path ? basename(project.path) : (state.cwd ? basename(state.cwd) : "--"));
  appendKv(rows, "Permission", state.permissionMode || "auto", state.permissionMode === "bypass" ? "danger" : state.permissionMode === "plan" ? "plan" : "");
  appendKv(rows, "MCP", `${data.mcp.filter(m => m.enabled !== false).length}/${data.mcp.length || 0}`);
  appendKv(rows, "Skills", String(data.skills.length || 0));
  appendKv(rows, "Plugins", String(data.plugins.length || 0));
  appendKv(rows, "Index", indexStatusLabel(), projectIndexState.status === "error" ? "danger" : projectIndexState.status === "scanning" ? "plan" : "");
  overview.innerHTML = rows.join("");
  renderRunTimeline();
  renderArtifacts();
}

function addTimeline(type, title, detail = "") {
  const key = `${type}:${title}:${detail}`;
  if (key === lastTimelineKey) return;
  lastTimelineKey = key;
  runTimeline.unshift({ type, title, detail, at: Date.now() });
  runTimeline = runTimeline.slice(0, 60);
  renderRunTimeline();
}

function renderRunTimeline() {
  const list = $("#runTimeline");
  const count = $("#timelineCount");
  if (!list) return;
  if (count) count.textContent = String(runTimeline.length);
  if (!runTimeline.length) {
    list.innerHTML = `<div class="ctx-empty">运行后会显示准备、工具调用、权限、错误和完成状态。</div>`;
    return;
  }
  list.innerHTML = runTimeline.map(item => `
    <div class="timeline-item is-${escapeHtml(item.type || "info")}">
      <span class="timeline-dot"></span>
      <div class="timeline-body">
        <b>${escapeHtml(item.title || "")}</b>
        ${item.detail ? `<span>${escapeHtml(item.detail)}</span>` : ""}
        <em>${fmtTime(Math.floor(item.at / 1000))}</em>
      </div>
    </div>
  `).join("");
}

function renderArtifacts() {
  const list = $("#artifactList");
  const count = $("#artifactCount");
  if (!list) return;
  const items = [
    ...attachedFiles.map(path => ({ type: "附件", path })),
    ...runTouchedFiles.map(path => ({ type: "变更", path })),
  ];
  if (count) count.textContent = String(items.length);
  if (!items.length) {
    list.innerHTML = `<div class="ctx-empty">拖拽文件或运行工具后，这里会沉淀材料与变更。</div>`;
    return;
  }
  list.innerHTML = items.slice(0, 12).map(item => `
    <button class="artifact-item" type="button" title="${escapeHtml(item.path)}">
      <span>${escapeHtml(item.type)}</span>
      <b>${escapeHtml(basename(item.path) || item.path)}</b>
      <em>${escapeHtml(compactPath(item.path))}</em>
    </button>
  `).join("");
  [...list.querySelectorAll(".artifact-item")].forEach((node, index) => {
    node.addEventListener("click", () => bridge?.openPath?.(items[index].path));
  });
}

function collectPaths(value, out = []) {
  if (!value) return out;
  if (typeof value === "string") {
    if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("/") || value.includes("\\") || value.includes("/")) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach(v => collectPaths(v, out));
    return out;
  }
  if (typeof value === "object") {
    for (const [key, val] of Object.entries(value)) {
      if (/path|file|directory|dir/i.test(key)) collectPaths(val, out);
      else if (typeof val === "object") collectPaths(val, out);
    }
  }
  return out;
}

function timelineFromClaudeEvent(event, payload = {}) {
  if (!event) return;
  if (event.type === "system" && event.subtype === "init") addTimeline("info", "工作区已就绪", "");
  if (event.type === "status" && payload.status) addTimeline("info", "准备中", friendlyProgress(payload.progress || payload.status));
  if (event.type === "retry") addTimeline("warn", "连接重试", payload.progress || "");
  if (event.type === "assistant") {
    const content = event.message?.content || event.content || [];
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part?.type !== "tool_use") continue;
        const toolName = part.name || "tool";
        addTimeline("tool", "工具调用", toolName);
        const paths = collectPaths(part.input || {});
        for (const path of paths) {
          if (!runTouchedFiles.includes(path)) runTouchedFiles.unshift(path);
        }
      }
    }
  }
  if (event.type === "result") addTimeline("success", "运行完成", friendlyProgress(payload.progress || ""));
  renderArtifacts();
}

function refreshSettingsIfOpen(panel = state.panel) {
  if (settingsPage.classList.contains("is-open") && state.panel === panel) renderSettingsTab();
}

function recordLoadResult(key, result, label) {
  if (result?.ok) { delete data.loadErrors[key]; return; }
  const message = result?.error || `${label} 加载失败`;
  data.loadErrors[key] = message;
  toast(message, "error");
}

async function loadProviders() {
  const r = await safeBridge("listProviders", []);
  recordLoadResult("providers", r, "Provider");
  if (r.ok) data.providers = r.data || [];
  updateFooter();
  populateModelDropdown();
  refreshSettingsIfOpen("providers");
  return r;
}
async function loadSkills() { const r = await safeBridge("listSkills", []); recordLoadResult("skills", r, "Skills"); if (r.ok) data.skills = r.data || []; refreshSettingsIfOpen("skills"); return r; }
async function loadSkillCategories() { const r = await safeBridge("listSkillCategories", []); recordLoadResult("skills", r, "Skills"); if (r.ok && r.data) { data.categorizedSkills = r.data.skills || []; data.categoryInfo = r.data.categoryInfo || {}; data.skills = data.categorizedSkills; skillCategoriesLoaded = true; } refreshSettingsIfOpen("skills"); refreshSettingsIfOpen("identities"); return r; }
async function loadIdentities() {
  const r = await safeBridge("listIdentities", []);
  recordLoadResult("identities", r, "身份");
  if (r.ok) data.identities = r.data || [];
  updateFooter();
  populateIdentitiesSubmenu();
  refreshSettingsIfOpen("identities");
  return r;
}
async function loadMcp() { const r = await safeBridge("listMcp", []); recordLoadResult("mcp", r, "MCP"); if (r.ok) data.mcp = r.data || []; refreshSettingsIfOpen("mcp"); return r; }
async function loadPlugins() { const r = await safeBridge("listPlugins", []); if (r.ok) data.plugins = r.data || []; refreshSettingsIfOpen("plugins"); return r; }
async function loadAutomations() { const r = await safeBridge("listAutomations", []); if (r.ok) data.automations = r.data || []; return r; }
async function loadUsage() { const r = await safeBridge("listUsage", null); if (r.ok) data.usage = r.data || null; refreshSettingsIfOpen("usage"); return r; }
async function loadRunners() { const r = await safeBridge("listRunners", []); if (r.ok) data.runners = r.data || []; refreshSettingsIfOpen("runners"); return r; }
async function loadDiag() {
  const r = await safeBridge("diagnostics", null, { cwd: state.cwd, claudePath: state.claudePath, runnerStrategy: state.runnerStrategy, permissionMode: state.permissionMode });
  data.diagnostics = r?.data || r || null;
  if (data.diagnostics?.claudePath && !state.claudePath) { state.claudePath = data.diagnostics.claudePath; save(); }
  refreshSettingsIfOpen("diagnostics");
  return r;
}
async function loadProjects() {
  const r = await safeBridge("listProjects", []);
  if (r.ok) {
    data.projects = r.data || [];
    projectIndexState = { status: "done", stats: { scannedProjects: data.projects.length }, updatedAt: Date.now(), error: "" };
    lastRefresh = Date.now(); // prevent immediate re-scan
    await validateActiveSession();
    renderContextStack();
  }
  return r;
}

async function refreshProjectIndex() {
  projectIndexState = { ...projectIndexState, status: "scanning", error: "" };
  renderContextStack();
  if (bridge?.refreshProjectsBackground) {
    const bg = await safeBridge("refreshProjectsBackground", null, { budgetMs: 500, visibleSessionCount: 16, titleScanCount: 6, maxProjects: 120 });
    if (bg.ok) return bg;
  }
  const r = await safeBridge("refreshProjects", null);
  if (r.ok && r.data) {
    data.projects = r.data.projects || r.data || [];
    projectIndexState = { status: "done", stats: r.data.stats || null, updatedAt: Date.now(), error: "" };
    renderProjects();
    renderConvs();
    renderContextStack();
    await validateActiveSession();
    return r;
  }
  if (r?.error) {
    data.loadErrors.projects = r.error;
    projectIndexState = { status: "error", stats: null, updatedAt: Date.now(), error: r.error };
    renderContextStack();
  }
  return r;
}

async function checkEnv() {
  if (!bridge) { return; }
  const env = await withTimeout(bridge.checkEnv(), 8000, { ok: false });
  if (env?.claudePath) state.claudePath = env.claudePath;
  if (env?.claudePath) data.diagnostics = { ...(data.diagnostics || {}), claudePath: env.claudePath, ok: true };
  save();
}

async function syncActiveIdentity() {
  const active = data.identities.find(i => i.active);
  if (!active) { toast("请先选择身份", "error"); return; }
  const r = await safeBridge("syncIdentitySkills", null, active.id);
  if (r.ok) toast(`已同步 ${r.data?.copied?.length || 0} 个`, "success");
  else toast(r.error || "同步失败", "error");
}

// ── Chat Actions ──

function setMode(m) { state.mode = m; save(); }
function setPerm(pm) {
  state.permissionMode = pm;
  save();
  const pill = $("#modePill");
  const labels = { plan: "Plan", auto: "Auto", bypass: "Bypass" };
  pill.textContent = labels[pm] || "Auto";
  pill.className = `mode-pill${pm === "plan" ? " is-plan" : pm === "bypass" ? " is-bypass" : ""}`;
  addDropdown.querySelectorAll(".add-option").forEach(opt => {
    opt.classList.toggle("is-active", opt.dataset.action === pm);
  });
}

function selectSession(proj, s) {
  state.selectedProject = proj.id;
  state.selectedSession = s.id;
  state.cwd = proj.path;
  state.mode = "continue";
  save();
  setMode("continue");
  renderConvs();
  loadSession(s);
}

async function loadSession(s) {
  const r = await safeBridge("readSession", null, s.id);
  if (!r.ok || !r.data) { toast(r.error || "读取失败", "error"); return; }
  if (r.data.exists === false) {
    recoverMissingSession(r.data.error);
    return;
  }
  state.messages = Array.isArray(r.data.messages) ? r.data.messages : [];
  state.selectedSessionPath = r.data.path || s.file || "";
  save();
  renderMessages();
  updateFooter();
}

function recoverMissingSession(error) {
  state.selectedSession = "";
  state.selectedSessionPath = "";
  state.mode = "normal";
  state.clientSessionKey = crypto.randomUUID();
  save();
  renderConvs();
  updateFooter();
  toast("这个历史对话已经找不到了，已切换到新对话。", "error");
  if (!state.messages.length) {
    state.messages = [{
      role: "assistant",
      content: `这个历史对话已经找不到了，可能被移动、删除，或 Claude 的会话索引已过期。\n\n我已经切换到新对话，不会再继续使用失效的 session。\n\n诊断信息：${error || "session missing"}`,
    }];
    save();
    renderMessages();
  }
}

async function validateActiveSession() {
  if (!state.selectedSession) return true;
  const known = data.projects.some(project => (project.sessions || []).some(session => session.id === state.selectedSession));
  if (known) return true;
  const r = await safeBridge("validateSession", null, state.selectedSession);
  if (r.ok && r.data?.exists) return true;
  recoverMissingSession(r.data?.error || r.error);
  return false;
}

function addAttachments(paths) {
  const next = paths.map(path => String(path || "").trim()).filter(Boolean);
  if (!next.length) return;
  attachedFiles = [...new Set([...attachedFiles, ...next])];
  renderAttachments();
  renderArtifacts();
}

function renderAttachments() {
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
      renderArtifacts();
    });
    tray.append(chip);
  });
}

function promptWithAttachments(prompt) {
  if (!attachedFiles.length) return prompt;
  const files = attachedFiles.map(path => `- ${path}`).join("\n");
  return `${prompt}\n\n附加文件/多模态输入：\n${files}\n\n请根据这些本地文件路径读取、分析或处理相关内容；如果是图片、PDF、音频或其他非文本文件，请按 Claude Code 支持的方式使用这些文件。`;
}

async function submitPrompt(e) {
  e?.preventDefault();
  const prompt = $("#promptInput").value.trim();
  if (!prompt) return;
  if (!state.cwd) { toast("请先在设置中选择项目", "error"); return; }
  state.pendingPlanPrompt = state.permissionMode === "plan" ? prompt : "";
  save();
  const p = curProvider();
  if (p) await switchProvider(p.id);
  $("#promptInput").value = "";
  autosize();
  const finalPrompt = promptWithAttachments(prompt);
  state.messages.push({ role: "user", content: finalPrompt }, { role: "assistant", content: "" });
  save();
  renderMessages();
  assistantBuffer = "";
  liveThinking = [];
  currentRunId = crypto.randomUUID();
  runTimeline = [];
  runTouchedFiles = [];
  lastTimelineKey = "";
  addTimeline("info", "提交任务", compactPath(state.cwd));
  setRunning(true);
  pushThink("正在准备项目上下文与当前身份");

  if (!bridge?.runClaude) { updateLast("桥接未就绪"); setRunning(false); return; }
  // Auto-sync active identity skills before running
  const activeId = data.identities.find(i => i.active);
  if (activeId) await safeBridge("syncIdentitySkills", null, activeId.id);
  const canResume = await validateActiveSession();
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
    if (r.code === "SESSION_MISSING") recoverMissingSession(r.error);
    addTimeline("error", "准备失败", friendlyRunError(r.error));
    updateLast(`失败：${friendlyRunError(r.error)}`);
    setRunning(false);
  } else {
    attachedFiles = [];
    renderAttachments();
    renderArtifacts();
  }
}

function setRunning(on) {
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
  renderContextStack();
}

function updateLast(content) { const last = state.messages[state.messages.length - 1]; if (last?.role === "assistant") { last.content = content; save(); renderMessages(); } }
function friendlyProgress(text) {
  return String(text || "")
    .replace(/启动中/g, "准备上下文")
    .replace(/启动/g, "准备")
    .replace(/复用 runner/gi, "继续处理")
    .replace(/runner/gi, "工作进程")
    .replace(/进程已退出/g, "已完成");
}
function pushThink(v) {
  const text = friendlyProgress(v);
  if (!text || liveThinking[liveThinking.length - 1] === text) return;
  liveThinking.push(text);
  if (liveThinking.length > 8) liveThinking.shift();
  // Store thinking in message for persistence
  const last = state.messages[state.messages.length - 1];
  if (last?.role === "assistant") last.thinking = [...liveThinking];
  renderMessages();
}
function clearThink() {
  if (liveThinking.length) {
    // Keep thinking data in message but stop animation
    const last = state.messages[state.messages.length - 1];
    if (last?.role === "assistant") last.thinking = [...liveThinking];
    liveThinking = [];
    save();
    renderMessages();
  }
}
function autosize() { const ta = $("#promptInput"); ta.style.height = "auto"; ta.style.height = `${Math.min(90, ta.scrollHeight)}px`; }

function onClaudeEvent(payload) {
  if (payload.runId !== currentRunId) return;
  timelineFromClaudeEvent(payload.event, payload);
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

function onClaudeStderr(p) {
  if (p.runId !== currentRunId || assistantBuffer) return;
  const text = String(p.text || "").trim().slice(0, 120);
  if (text) addTimeline("warn", "进程输出", text);
  pushThink(`${text}`);
}

function handleAskUser(payload) {
  if (payload.runId !== currentRunId) return;
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
        addTimeline("info", "用户选择", opt.label);
        await safeBridge("answerQuestion", null, { runId: currentRunId, toolUseId, answer: opt.label });
      });
      opts.appendChild(btn);
    }
    container.appendChild(opts);
  }
  overlay.classList.add("is-open");
}

function friendlyRunError(raw) {
  const text = String(raw || "").trim();
  if (/No conversation found with session ID/i.test(text)) {
    recoverMissingSession(text);
    return "这个历史对话已经找不到了，我已切换到新对话。请重新发送这条任务。";
  }
  if (/ENOENT|not recognized|command not found|找不到/i.test(text)) return "没有找到 Claude Code。请到诊断页点击[检测 Claude]，或手动设置 Claude 路径。";
  if (/permission|denied|EPERM|EACCES/i.test(text)) return `权限不足：${text.slice(0, 220)}`;
  if (/timed out|timeout/i.test(text)) return "模型准备或响应超时，请检查网络、Provider 和当前项目目录。";
  return text ? text.slice(0, 260) : "工作进程结束，但没有提供错误信息。";
}

function onClaudeDone(p) {
  if (p.runId !== currentRunId) return;

  // 处理重试情况
  if (p.retried && p.ok) {
    toast("连接已恢复", "success");
  }

  if (!p.ok && !assistantBuffer) {
    const errMsg = friendlyRunError(p.stderr || p.error);
    addTimeline("error", "运行失败", errMsg);
    const retryMsg = p.retried ? "（已重试）" : "";
    updateLast(`连接中断${retryMsg}：${errMsg}`);
    pushThink("按 Enter 重新发送，或点击右下角状态重新连接");
  }

  if (p.ok && !assistantBuffer) {
    const stderr = String(p.stderr || "").trim();
    updateLast(stderr ? `任务已结束，但没有返回正文。\n\n诊断信息：${friendlyRunError(stderr)}` : "任务已结束，但这次没有返回正文。");
  }

  if (p.ok) addTimeline("success", "运行结束", "已完成");

  currentRunId = "";
  setRunning(false);
  clearThink();

  const pill = $("#runnerPill");
  pill.textContent = p.keptAlive ? "复用" : (p.ok ? "就绪" : "断开");
  pill.className = `cfoot-pill${p.keptAlive ? " is-hot" : ""}${!p.ok ? " is-error" : ""}`;
}

// runnerPill 点击重置
$("#runnerPill").addEventListener("click", async () => {
  if (!bridge?.reconnectClaude) return;
  await bridge.reconnectClaude();
  toast("已断开所有 Runner 连接", "info");
  $("#runnerPill").textContent = "未连接";
  $("#runnerPill").className = "cfoot-pill";
  currentRunId = "";
  setRunning(false);
});

// ── Events ──

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
  addAttachments(paths);
  if (paths.length) toast(`已添加 ${paths.length} 个文件`, "success");
});
// ── Floating Dropdowns ──

function closeAllDropdowns() {
  document.querySelectorAll(".float-dropdown.is-open").forEach(d => d.classList.remove("is-open"));
  if (addMenu) addMenu.style.display = "none";
}

document.addEventListener("click", e => {
  if (!e.target.closest(".float-dropdown") && !e.target.closest(".add-menu") && !e.target.closest("#addBtn") && !e.target.closest("#modelBtn") && !e.target.closest("#permBtn")) {
    closeAllDropdowns();
  }
  if (!e.target.closest("#searchPanel") && !e.target.closest("#searchBtn")) closeSearchPanel();
});
document.addEventListener("keydown", e => { if (e.key === "Escape") closeAllDropdowns(); });

// ── Add Menu (带延迟的子菜单控制) ──
const addMenuWrap = $(".add-menu-wrap");
const addMenu = $("#addMenu");
let addMenuTimer = null;

function showAddMenu() {
  clearTimeout(addMenuTimer);
  const rect = $("#addBtn").getBoundingClientRect();
  addMenu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 476))}px`;
  addMenu.style.bottom = `${window.innerHeight - rect.top + 8}px`;
  addMenu.style.display = "block";
  setActiveAddCategory(addMenu.querySelector(".add-menu-item.is-open") || addMenu.querySelector(".add-menu-item[data-sub]"));
}

function hideAddMenu(delay = 300) {
  clearTimeout(addMenuTimer);
  addMenuTimer = setTimeout(() => {
    addMenu.style.display = "none";
  }, delay);
}

// + 按钮点击切换
$("#addBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  if (addMenu.style.display === "block") {
    addMenu.style.display = "none";
  } else {
    showAddMenu();
  }
});

// 鼠标进入整个菜单区域时显示
addMenuWrap.addEventListener("mouseenter", showAddMenu);
addMenuWrap.addEventListener("mouseleave", () => hideAddMenu(300));
addMenu.addEventListener("mouseenter", () => clearTimeout(addMenuTimer));
addMenu.addEventListener("mouseleave", () => hideAddMenu(200));

function setActiveAddCategory(item) {
  if (!item) return;
  addMenu.querySelectorAll(".add-menu-item[data-sub]").forEach(node => node.classList.toggle("is-open", node === item));
}

addMenu.querySelectorAll(".add-menu-item[data-sub]").forEach(item => {
  item.addEventListener("mouseenter", () => setActiveAddCategory(item));
  item.addEventListener("click", e => {
    if (e.target.closest(".add-sub-item")) return;
    setActiveAddCategory(item);
  });
});

// + menu - populate identities submenu
function populateIdentitiesSubmenu() {
  const sub = $("#subIdentities");
  if (!sub) return;
  sub.innerHTML = "";
  if (!data.identities.length) {
    sub.innerHTML = `<div style="padding:6px 8px;color:var(--td-text-color-disabled);font-size:11px;">暂无身份</div>`;
    return;
  }
  for (const id of data.identities) {
    const btn = document.createElement("button");
    btn.className = `add-sub-item${id.active ? " is-active" : ""}`;
    btn.type = "button";
    btn.textContent = `${id.icon || "ID"} ${id.name}`;
    btn.addEventListener("click", async () => { await switchIdentity(id.id); addMenu.style.display = "none"; });
    sub.append(btn);
  }
}

// + menu - context actions
document.querySelectorAll(".add-sub-item[data-action]").forEach(btn => {
  btn.addEventListener("click", async () => {
    const action = btn.dataset.action;
    if (action === "addFolder") {
      const folder = await bridge?.chooseFolder?.();
      if (folder) { state.cwd = folder; state.selectedProject = ""; save(); await loadProjects(); renderProjects(); updateFooter(); toast(`已添加：${basename(folder)}`, "success"); }
    } else if (action === "addFile") {
      const file = await bridge?.chooseFile?.();
      if (file) { addAttachments([file]); toast(`已添加：${basename(file)}`, "success"); }
    } else if (action === "openSkills") { openSettings("skills"); }
    else if (action === "openMcp") { openSettings("mcp"); }
    else if (action === "syncSkills") { await syncActiveIdentity(); }
  });
});

// Auto/Plan/Bypass button
$("#permBtn").addEventListener("click", e => {
  e.stopPropagation();
  const dd = $("#permDropdown");
  if (dd.classList.contains("is-open")) { dd.classList.remove("is-open"); return; }
  closeAllDropdowns();
  // Update active state
  dd.querySelectorAll(".perm-option").forEach(opt => {
    opt.classList.toggle("is-active", opt.dataset.mode === state.permissionMode);
  });
  const rect = e.currentTarget.getBoundingClientRect();
  dd.style.top = "auto";
  dd.style.left = rect.left + "px";
  dd.style.bottom = (window.innerHeight - rect.top + 6) + "px";
  dd.classList.add("is-open");
});
$("#permDropdown").querySelectorAll(".perm-option").forEach(opt => {
  opt.addEventListener("click", () => {
    setPerm(opt.dataset.mode);
    closeAllDropdowns();
  });
});

// Model selector
$("#modelBtn").addEventListener("click", e => {
  e.stopPropagation();
  const dd = $("#modelDropdown");
  if (dd.classList.contains("is-open")) { dd.classList.remove("is-open"); return; }
  closeAllDropdowns();
  populateModelDropdown();
  const rect = e.currentTarget.getBoundingClientRect();
  dd.style.top = "auto";
  dd.style.left = "auto";
  dd.style.right = (window.innerWidth - rect.right) + "px";
  dd.style.bottom = (window.innerHeight - rect.top + 6) + "px";
  dd.classList.add("is-open");
});


function populateModelDropdown() {
  const body = $("#modelDropdownBody");
  body.innerHTML = "";
  const current = curProvider();
  if (!current) {
    body.innerHTML = `<div style="padding:8px;color:var(--td-text-color-disabled);font-size:11px;text-align:center;">无 Provider</div>`;
    return;
  }

  const currentModel = current.model || "";

  // Show all providers with their models
  for (const p of data.providers) {
    const opt = document.createElement("button");
    opt.className = `model-option${p.id === current.id ? " is-active" : ""}`;
    opt.type = "button";
    opt.textContent = `${p.name || "Provider"} · ${p.model || "未设置"}`;
    opt.addEventListener("click", async () => {
      closeAllDropdowns();
      await switchProvider(p.id);
    });
    body.append(opt);
  }

  // Separator
  const sep = document.createElement("div");
  sep.style.cssText = "height:1px;background:var(--td-border-level-2-color);margin:3px 6px;";
  body.append(sep);

  // Edit current model
  const editOpt = document.createElement("button");
  editOpt.className = "model-option";
  editOpt.type = "button";
  editOpt.innerHTML = `<span style="color:var(--td-brand-color);">✏ 修改当前模型</span>`;
  editOpt.addEventListener("click", async () => {
    closeAllDropdowns();
    const result = await showModal("修改模型", [
      { key: "model", label: "模型 ID", value: currentModel, placeholder: "输入模型 ID" },
    ]);
    if (!result || !result.model) return;
    await safeBridge("updateProvider", null, current.id, { model: result.model.trim() });
    current.model = result.model.trim();
    updateModelLabel();
    populateModelDropdown();
    toast(`已设置：${result.model}`, "success");
  });
  body.append(editOpt);
}

function updateModelLabel() {
  const p = curProvider();
  $("#modelLabel").textContent = p?.model || p?.name || "未设置";
}

function openSearchPanel() {
  const panel = $("#searchPanel");
  panel.classList.add("is-open");
  const input = $("#globalSearchInput");
  input.value = state.searchTerm || "";
  renderSearchResults(input.value);
  setTimeout(() => input.focus(), 0);
}

function closeSearchPanel() {
  $("#searchPanel")?.classList.remove("is-open");
}

function collectSearchResults(term) {
  const q = searchable(term);
  const results = [];
  if (!q) return results;
  for (const project of data.projects) {
    if (searchable(`${project.path} ${project.name}`).includes(q)) {
      results.push({ type: "项目", title: basename(project.path || project.name), sub: project.path || project.name, action: () => selectProject(project) });
    }
    for (const session of project.sessions || []) {
      const title = sessMeta(session.id).title || session.title || session.id;
      if (searchable(`${title} ${session.id} ${project.path}`).includes(q)) {
        results.push({ type: "对话", title, sub: `${basename(project.path || project.name)} · ${fmtTime(session.updatedAt)}`, action: () => selectSession(project, session) });
      }
    }
  }
  for (const msg of state.messages || []) {
    if (searchable(msg.content).includes(q)) {
      results.push({ type: "当前对话", title: String(msg.content || "").slice(0, 80), sub: msg.role, action: closeSearchPanel });
    }
  }
  for (const plugin of data.plugins || []) {
    if (searchable(`${plugin.name} ${plugin.path}`).includes(q)) {
      results.push({ type: "插件", title: plugin.name, sub: plugin.path || "", action: () => bridge?.openPath?.(plugin.path) });
    }
  }
  for (const identity of data.identities || []) {
    if (searchable(`${identity.name} ${identity.description}`).includes(q)) {
      results.push({ type: "身份", title: identity.name, sub: identity.description || "", action: () => switchIdentity(identity.id) });
    }
  }
  return results.slice(0, 40);
}

function renderSearchResults(term) {
  const body = $("#searchResults");
  const results = collectSearchResults(term);
  state.searchTerm = term;
  save();
  renderProjects();
  renderConvs();
  if (!results.length) {
    body.innerHTML = `<div style="padding:16px;color:var(--td-text-color-disabled);font-size:12px;text-align:center;">${term ? "没有搜索结果" : "输入关键词搜索项目、对话、插件、身份和当前消息"}</div>`;
    return;
  }
  body.innerHTML = "";
  for (const result of results) {
    const item = document.createElement("button");
    item.className = "search-result";
    item.type = "button";
    item.innerHTML = `<b>${escapeHtml(result.title || "")}</b><span>${result.type} · ${escapeHtml(result.sub || "")}</span>`;
    item.addEventListener("click", async () => {
      await result.action?.();
      closeSearchPanel();
    });
    body.append(item);
  }
}

$("#approvePlanBtn").addEventListener("click", () => { if (!state.pendingPlanPrompt) return; $("#promptInput").value = `请按计划执行。\n\n原始任务：${state.pendingPlanPrompt}`; autosize(); state.pendingPlanPrompt = ""; save(); });
$("#revisePlanBtn").addEventListener("click", () => { if (!state.pendingPlanPrompt) return; $("#promptInput").value = `请修改计划：\n\n${state.pendingPlanPrompt}`; autosize(); });
$("#cancelPlanBtn").addEventListener("click", () => { state.pendingPlanPrompt = ""; save(); });
// Combined run/stop button
const runStopBtn = $("#runStopBtn");
runStopBtn.addEventListener("click", async e => {
  if (currentRunId) {
    // Stop mode
    e.preventDefault();
    if (bridge?.stopClaude) await bridge.stopClaude(currentRunId);
    currentRunId = "";
    setRunning(false);
  }
  // If not running, let the form submit naturally
});
$("#newChatBtn")?.addEventListener("click", newChat);
$("#newChatBtn2").addEventListener("click", newChat);
$("#searchBtn")?.addEventListener("click", openSearchPanel);
$("#searchCloseBtn")?.addEventListener("click", closeSearchPanel);
$("#globalSearchInput")?.addEventListener("input", e => renderSearchResults(e.currentTarget.value));
$("#pluginsBtn")?.addEventListener("click", async () => { await loadPlugins(); openSettings("plugins"); });
$("#teamsBtn")?.addEventListener("click", () => openSettings("identities"));
$("#refreshIndexBtn")?.addEventListener("click", () => throttledRefresh(true));
$("#addFolderBtn").addEventListener("click", async () => {
  const folder = await bridge?.chooseFolder?.();
  if (!folder) return;
  state.cwd = folder;
  state.selectedProject = "";
  save();
  await loadProjects();
  renderProjects();
  updateFooter();
});

function newChat() {
  state.messages = []; state.selectedSession = ""; state.selectedSessionPath = "";
  state.clientSessionKey = crypto.randomUUID(); state.pendingPlanPrompt = ""; state.mode = "normal";
  save(); renderMessages(); $("#promptInput").focus();
}

document.addEventListener("keydown", e => {
  if (e.key === "Escape" && settingsPage.classList.contains("is-open")) { settingsPage.classList.remove("is-open"); return; }
  if (e.key === "Escape" && currentRunId && bridge?.stopClaude) { bridge.stopClaude(currentRunId); setRunning(false); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") { e.preventDefault(); newChat(); }
});

if (bridge) { bridge.onClaudeEvent(onClaudeEvent); bridge.onClaudeStderr(onClaudeStderr); bridge.onClaudeDone(onClaudeDone); bridge.onAskUser?.(handleAskUser); }

function applyBootstrap(payload) {
  if (!payload?.ok) {
    const message = payload?.error || "启动数据加载失败";
    data.loadErrors.bootstrap = message;
    toast(message, "error");
    return;
  }
  const d = payload.data || {};
  if (Array.isArray(d.providers)) data.providers = d.providers;
  if (Array.isArray(d.skills)) data.skills = d.skills;
  if (Array.isArray(d.categorizedSkills)) data.categorizedSkills = d.categorizedSkills;
  else if (Array.isArray(d.skills)) data.categorizedSkills = d.skills;
  if (Array.isArray(d.skills) || Array.isArray(d.categorizedSkills)) skillCategoriesLoaded = true;
  if (d.categoryInfo && typeof d.categoryInfo === "object") data.categoryInfo = d.categoryInfo;
  if (Array.isArray(d.mcp)) data.mcp = d.mcp;
  if (Array.isArray(d.identities)) data.identities = d.identities;
  if (Array.isArray(d.projects)) data.projects = d.projects;
  if (Array.isArray(d.plugins)) data.plugins = d.plugins;
  if (Array.isArray(d.automations)) data.automations = d.automations;
  if (Array.isArray(d.runners)) data.runners = d.runners;
  delete data.loadErrors.bootstrap;
  updateFooter();
  populateIdentitiesSubmenu();
  populateModelDropdown();
  renderProjects();
  renderConvs();
  refreshSettingsIfOpen();
  renderContextStack();
}

if (bridge?.onBootstrap) bridge.onBootstrap(applyBootstrap);

function handleProjectIndex(payload = {}) {
  projectIndexState = {
    status: payload.status || "idle",
    stats: payload.result?.stats || projectIndexState.stats,
    updatedAt: payload.finishedAt || payload.startedAt || Date.now(),
    error: payload.error || "",
  };
  if (payload.status === "done" && payload.result) {
    data.projects = payload.result.projects || payload.result || [];
    renderProjects();
    renderConvs();
    validateActiveSession();
  }
  if (payload.status === "error" && payload.error) {
    data.loadErrors.projects = payload.error;
    toast(payload.error, "error");
  }
  renderContextStack();
}

if (bridge?.onProjectIndex) bridge.onProjectIndex(handleProjectIndex);

function handleIdentityAnalysis(payload = {}) {
  identityAnalysisState = {
    running: !["done", "error"].includes(payload.status),
    status: payload.status || "idle",
    message: payload.message || "",
    warning: payload.warning || "",
  };
  renderIdentityAnalysisStatus();
  if (payload.status === "fallback" && payload.warning) {
    toast("Claude 分析未完成，已切换本地聚类", "info");
  }
  if (payload.status === "done") {
    Promise.all([loadSkillCategories(), loadIdentities()]).then(() => {
      if (settingsPage.classList.contains("is-open") && state.panel === "identities") renderSettingsTab();
    });
  }
}

if (bridge?.onIdentityAnalysis) bridge.onIdentityAnalysis(handleIdentityAnalysis);

// ── Claude Setup Detection ──

let claudeSetupState = { installed: true, version: "", dismissed: false };
let claudeVersions = [];
let nodeVersions = [];
let installRunning = false;

async function fetchAndShowVersions() {
  const r = await safeBridge("fetchClaudeVersions", null);
  const sel = $("#setupVersionSelect");
  if (!r?.ok || !r.data?.versions?.length) {
    if (sel) sel.innerHTML = `<option value="">latest (最新)</option>`;
    if ($("#setupBannerMsg")) $("#setupBannerMsg").textContent = "请安装 Claude Code 后使用";
    return;
  }
  claudeVersions = r.data.versions;
  const latest = r.data.latest || claudeVersions[0];
  sel.innerHTML = claudeVersions.map(v =>
    `<option value="${v}"${v === latest ? " selected" : ""}>${v}${v === latest ? " (最新)" : ""}</option>`
  ).join("");
  const msg = $("#setupBannerMsg");
  if (msg) msg.textContent = `共 ${claudeVersions.length} 个版本可选，选择版本后一键安装`;
}

async function fetchAndShowNodeVersions() {
  const sel = $("#setupNodeVersionSelect");
  sel.innerHTML = `<option value="latest">正在获取版本...</option>`;
  const r = await safeBridge("fetchNodeVersions", null);
  if (!r?.ok || !r.data?.versions?.length) {
    sel.innerHTML = `<option value="latest">LTS (最新)</option>`;
    return;
  }
  nodeVersions = r.data.versions;
  const latestLts = r.data.latestLts || nodeVersions[0]?.version;
  const latest = r.data.latest || nodeVersions[0]?.version;
  sel.innerHTML = nodeVersions.map(v => {
    const label = v.lts ? `${v.version} (LTS)` : v.version;
    const selected = v.lts ? v.version === latestLts : v.version === latest;
    return `<option value="${v.version}"${selected ? " selected" : ""}>${label}</option>`;
  }).join("");
}

function showSetupBanner(result) {
  const banner = $("#setupBanner");
  if (!banner || result.installed || result.dismissed) {
    banner?.classList.add("is-hidden");
    return;
  }
  claudeSetupState = { ...claudeSetupState, ...result };

  if (!result.hasNpm) {
    // Node.js / npm not installed — guide to install Node.js first
    $("#setupBannerTitle").textContent = "未检测到 Node.js 环境";
    $("#setupBannerMsg").textContent = "安装 Claude Code 需要 npm。请先安装 Node.js（包含 npm）。";
    $("#setupBannerIcon").textContent = "🔧";
    $("#setupBannerInstall").textContent = "一键安装 Node.js";
    $("#setupBannerInstall").className = "st-btn t-btn--primary t-btn--sm";
    $("#setupVersionSelect").style.display = "none";
    $("#setupNodeVersionSelect").style.display = "";
    banner.classList.remove("is-hidden");
    fetchAndShowNodeVersions();
  } else {
    // npm exists, but Claude Code missing
    $("#setupBannerTitle").textContent = "未检测到 Claude Code";
    $("#setupBannerIcon").textContent = "📦";
    $("#setupBannerInstall").textContent = "一键安装";
    $("#setupBannerInstall").className = "st-btn t-btn--primary t-btn--sm";
    $("#setupVersionSelect").style.display = "";
    $("#setupNodeVersionSelect").style.display = "none";
    banner.classList.remove("is-hidden");
    fetchAndShowVersions();
  }
  installDone = false;
}

let installDone = false;

$("#setupBannerInstall")?.addEventListener("click", async () => {
  if (installRunning) return;

  if (installDone) {
    // After successful install, re-detect Claude
    const r = await safeBridge("detectClaude", null);
    const d = r?.data || {};
    if (d.installed) {
      claudeSetupState = { ...claudeSetupState, ...d };
      $("#setupBanner").classList.add("is-hidden");
      toast(`Claude Code v${d.version || ""} 已就绪`, "success");
      boot();
    }
    return;
  }

  const btn = $("#setupBannerInstall");

  // ── Node.js not installed → install Node.js first ──
  if (!claudeSetupState.hasNpm) {
    const nodeSel = $("#setupNodeVersionSelect");
    const nodeVersion = nodeSel?.value || "latest";
    installRunning = true;
    btn.disabled = true;
    btn.textContent = "安装中...";
    $("#setupBannerIcon").textContent = "⏳";
    $("#setupBannerMsg").textContent = `正在下载 Node.js ${nodeVersion === "latest" ? "LTS" : nodeVersion}...`;
    const r = await safeBridge("installNodeMsi", null, nodeVersion);
    if (!r?.ok) {
      // MSI install failed — fallback to browser download
      await safeBridge("openNodeDownload", null);
      toast("已打开 Node.js 下载页面。安装完成后请刷新本应用。", "info");
      installRunning = false;
      btn.disabled = false;
      btn.textContent = "重新检测";
      btn.className = "st-btn t-btn--success t-btn--sm";
      installDone = true;
      $("#setupBannerIcon").textContent = "🔗";
      $("#setupBannerMsg").textContent = "安装 Node.js 后点击重新检测";
    }
    return;
  }

  // ── Install Claude Code ──
  const sel = $("#setupVersionSelect");
  const version = sel?.value || "";
  installRunning = true;
  btn.disabled = true;
  btn.textContent = "安装中...";
  $("#setupBannerIcon").textContent = "⏳";
  $("#setupBannerMsg").textContent = `正在安装 Claude Code ${version || "latest"}...`;
  const r = await safeBridge("installClaude", null, version);
  if (!r.ok) {
    toast(r.error || "安装启动失败", "error");
    installRunning = false;
    btn.disabled = false;
    btn.textContent = "一键安装";
    $("#setupBannerIcon").textContent = "📦";
  }
  // Install progress will come via onClaudeInstallProgress events
});

$("#setupBannerDismiss")?.addEventListener("click", async () => {
  const r = await safeBridge("dismissSetup", null);
  if (r.ok) {
    claudeSetupState.dismissed = true;
    $("#setupBanner").classList.add("is-hidden");
    toast("已关闭安装提醒。可在通用设置中重新开启。", "info");
  }
});

function handleClaudeDetectResult(result = {}) {
  if (!result || result.installed) return;
  showSetupBanner(result);
}

if (bridge?.onClaudeDetectResult) bridge.onClaudeDetectResult(handleClaudeDetectResult);

// Listen for install progress from main process
function handleInstallProgress(payload = {}) {
  const banner = $("#setupBanner");
  if (!banner) return;

  const isNodePhase = payload.phase === "node";

  if (payload.status === "installing") {
    $("#setupBannerIcon").textContent = "⏳";
    $("#setupBannerMsg").textContent = payload.progress || (isNodePhase ? "正在安装 Node.js..." : "正在安装...");
  } else if (payload.status === "done" && payload.ok) {
    installRunning = false;
    if (isNodePhase) {
      // Node.js installed → now offer Claude Code install
      claudeSetupState.hasNpm = true;
      claudeSetupState.hasNode = true;
      $("#setupBannerIcon").textContent = "📦";
      $("#setupBannerTitle").textContent = "未检测到 Claude Code";
      $("#setupBannerMsg").textContent = "Node.js 已就绪，请选择版本安装 Claude Code。";
      const btn = $("#setupBannerInstall");
      btn.disabled = false;
      btn.textContent = "一键安装";
      btn.className = "st-btn t-btn--primary t-btn--sm";
      $("#setupNodeVersionSelect").style.display = "none";
      $("#setupVersionSelect").style.display = "";
      fetchAndShowVersions();
      toast("Node.js 安装成功", "success");
    } else {
      installDone = true;
      $("#setupBannerIcon").textContent = "✅";
      $("#setupBannerTitle").textContent = "安装完成";
      $("#setupBannerMsg").textContent = `Claude Code v${payload.version || ""} 已就绪，点击下方按钮完成检测。`;
      const btn = $("#setupBannerInstall");
      btn.disabled = false;
      btn.textContent = "完成检测";
      btn.className = "st-btn t-btn--success t-btn--sm";
      toast("Claude Code 安装成功", "success");
    }
  } else if (payload.status === "failed") {
    installRunning = false;
    installDone = false;
    $("#setupBannerIcon").textContent = "❌";
    $("#setupBannerTitle").textContent = isNodePhase ? "Node.js 安装失败" : "安装失败";
    $("#setupBannerMsg").textContent = payload.error || payload.progress || "未知错误";
    const btn = $("#setupBannerInstall");
    btn.disabled = false;
    btn.textContent = isNodePhase ? "改用浏览器下载" : "重试安装";
    btn.className = "st-btn t-btn--primary t-btn--sm";
    if (isNodePhase) {
      // Fallback: the next click will open browser download since installDone flag
      installDone = true;
    }
    toast("安装失败: " + (payload.error || "未知错误"), "error");
  }
}

if (bridge?.onClaudeInstallProgress) bridge.onClaudeInstallProgress(handleInstallProgress);

// ── Init ──

let initialLoadDone = false;
let skillCategoriesLoaded = false;

function deferWork(fn, timeout = 300) {
  if (window.requestIdleCallback) {
    window.requestIdleCallback(fn, { timeout });
  } else {
    setTimeout(fn, timeout);
  }
}

async function boot() {
  if (state.contextOpen === undefined) state.contextOpen = true;
  sidebar.classList.toggle("is-collapsed", !state.sidebarOpen);
  contextStack?.classList.toggle("is-collapsed", !state.contextOpen);
  setPerm(state.permissionMode || "auto");
  renderProjects();
  renderConvs();
  renderMessages();
  updateFooter();
  autosize();

  // Wave 1: Critical path — projects, providers, identities render first
  let bootstrapped = false;
  if (bridge?.bootstrapData) {
    const bootstrap = await safeBridge("bootstrapData", null);
    if (bootstrap?.ok && bootstrap.data) {
      applyBootstrap({ ok: true, data: bootstrap.data });
      bootstrapped = true;
    }
  }

  if (bootstrapped) {
    checkEnv();
  } else {
    await Promise.all([
      checkEnv(),
      loadProviders(),
      loadIdentities(),
      loadProjects(),
    ]);
  }
  renderProjects();
  renderConvs();
  updateFooter();
  populateModelDropdown();
  populateIdentitiesSubmenu();
  initialLoadDone = true;

  // Fallback: if the main-process detect event was missed, trigger detection from here
  if (claudeSetupState.installed) {
    try {
      const dr = await safeBridge("detectClaude", null);
      if (dr?.ok && dr.data) handleClaudeDetectResult(dr.data);
    } catch {}
  }

  // Wave 2: Secondary data — skills, mcp, plugins, runners
  const loadSecondary = () => Promise.allSettled([
    loadSkillCategories(),
    loadMcp(),
    loadPlugins(),
    loadRunners(),
  ]);
  if (bootstrapped) deferWork(loadSecondary, 400);
  else await loadSecondary();

  // Auto-sync active identity skills on startup
  const activeId = data.identities.find(i => i.active);
  if (activeId) {
    setTimeout(async () => {
      const sr = await safeBridge("syncIdentitySkills", null, activeId.id);
      if (sr.ok) {
        var copied2 = sr.data?.copied?.length || 0;
        var missing2 = sr.data?.missing?.length || 0;
        if (copied2 > 0 || missing2 > 0) {
          var msg2 = "Skills 已同步 " + copied2 + " 个";
          if (missing2 > 0) msg2 += ", " + missing2 + " 个缺失源文件";
          toast(msg2, missing2 > 0 ? "error" : "success");
        }
      }
    }, 500);
  }

  // Wave 3: Deep scan + heavy ops deferred (throttled)
  deferWork(() => throttledRefresh(), 1000);
  deferWork(() => loadDiag(), 1200);
  deferWork(() => loadUsage(), 1400);
  deferWork(() => loadAutomations(), 1600);
}

try {
  boot();
} catch (e) {
  console.error("Init error:", e);
}

// Auto-refresh projects every 60s and on window focus (throttled)
let lastRefresh = 0;
async function throttledRefresh(force = false) {
  if (!force && Date.now() - lastRefresh < 15000) return;
  lastRefresh = Date.now();
  await refreshProjectIndex();
}
setInterval(throttledRefresh, 60000);
window.addEventListener("focus", throttledRefresh);
