import { data, save, state } from "./state.js";
import { getBridge, safeBridge, curProvider } from "./bridge.js";
import { $, basename, toast } from "./helpers.js";
import { showModal } from "./modal.js";

// Module-local state
let addMenuTimer = null;

// Dependency injection
let deps = {};
export function configure(d) { deps = d; }

export function closeAllDropdowns() {
  document.querySelectorAll(".float-dropdown.is-open").forEach(d => d.classList.remove("is-open"));
  const addMenu = $("#addMenu");
  if (addMenu) {
    addMenu.style.display = "none";
    addMenu.classList.remove("is-open");
  }
}

export function showAddMenu() {
  clearTimeout(addMenuTimer);
  const addMenu = $("#addMenu");
  const addBtn = $("#addBtn");
  if (!addMenu || !addBtn) return;
  const rect = addBtn.getBoundingClientRect();
  addMenu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 560))}px`;
  addMenu.style.bottom = `${window.innerHeight - rect.top + 8}px`;
  addMenu.style.display = "block";
  addMenu.classList.add("is-open");
  setActiveAddCategory(addMenu.querySelector(".add-menu-item.is-open") || addMenu.querySelector(".add-menu-item[data-sub]"));
}

export function hideAddMenu(delay = 300) {
  clearTimeout(addMenuTimer);
  const addMenu = $("#addMenu");
  if (!addMenu) return;
  addMenuTimer = setTimeout(() => {
    addMenu.style.display = "none";
    addMenu.classList.remove("is-open");
  }, delay);
}

function closeAddMenu() {
  clearTimeout(addMenuTimer);
  const addMenu = $("#addMenu");
  if (!addMenu) return;
  addMenu.style.display = "none";
  addMenu.classList.remove("is-open");
}

export function setActiveAddCategory(item) {
  if (!item) return;
  const addMenu = $("#addMenu");
  if (!addMenu) return;
  addMenu.querySelectorAll(".add-menu-item[data-sub]").forEach(node => node.classList.toggle("is-open", node === item));
}

export function populateIdentitiesSubmenu() {
  const sub = $("#subIdentities");
  if (!sub) return;
  sub.innerHTML = "";
  if (!data.identities.length) {
    sub.innerHTML = `<div style="padding:6px 8px;color:var(--td-text-color-disabled);font-size:11px;">暂无身份</div>`;
    return;
  }
  const addMenu = $("#addMenu");
  for (const id of data.identities) {
    const btn = document.createElement("button");
    btn.className = `add-sub-item${id.active ? " is-active" : ""}`;
    btn.type = "button";
    btn.setAttribute('role', 'menuitem');
    btn.textContent = `${id.icon || "ID"} ${id.name}`;
    btn.addEventListener("click", async () => { await deps.switchIdentity?.(id.id); addMenu.style.display = "none"; });
    sub.append(btn);
  }
}

export function populateModelDropdown() {
  const body = $("#modelDropdownBody");
  if (!body) return;
  body.innerHTML = "";
  const current = curProvider();
  if (!current) {
    body.innerHTML = `<div style="padding:8px;color:var(--td-text-color-disabled);font-size:11px;text-align:center;">无 Provider</div>`;
    return;
  }

  const currentModel = current.model || "";

  for (const p of data.providers) {
    const opt = document.createElement("button");
    opt.className = `model-option${p.id === current.id ? " is-active" : ""}`;
    opt.type = "button";
    opt.setAttribute('role', 'menuitem');
    opt.textContent = `${p.name || "Provider"} · ${p.model || "未设置"}`;
    opt.addEventListener("click", async () => {
      closeAllDropdowns();
      await deps.switchProvider?.(p.id);
    });
    body.append(opt);
  }

  const sep = document.createElement("div");
  sep.style.cssText = "height:1px;background:var(--td-border-level-2-color);margin:3px 6px;";
  body.append(sep);

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

export function updateModelLabel() {
  const p = curProvider();
  $("#modelLabel").textContent = p?.model || p?.name || "未设置";
}

export function initDropdowns() {
  // Document-level close handlers
  document.addEventListener("click", e => {
    if (!e.target.closest(".float-dropdown") && !e.target.closest(".add-menu") && !e.target.closest("#addBtn") && !e.target.closest("#modelBtn") && !e.target.closest("#permBtn")) {
      closeAllDropdowns();
    }
    if (!e.target.closest("#searchPanel") && !e.target.closest("#searchBtn")) deps.closeSearchPanel?.();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { closeAllDropdowns(); return; }
    // Keyboard navigation in open dropdowns
    const openDd = document.querySelector('.float-dropdown.is-open');
    if (!openDd) return;
    const items = [...openDd.querySelectorAll('[role="menuitem"], .model-option, .perm-option, .add-sub-item')].filter(el => el.offsetParent !== null);
    if (!items.length) return;
    const curIdx = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = curIdx < items.length - 1 ? curIdx + 1 : 0;
      items[next].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = curIdx > 0 ? curIdx - 1 : items.length - 1;
      items[prev].focus();
    } else if (e.key === 'Enter' && curIdx >= 0) {
      e.preventDefault();
      items[curIdx].click();
    }
  });

  // Add button
  const addMenuWrap = $(".add-menu-wrap");
  const addMenu = $("#addMenu");
  $("#addBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (addMenu?.style.display === "block") {
      closeAddMenu();
    } else {
      showAddMenu();
    }
  });

  // Keep the menu open while the pointer is inside it, but open only by click to avoid accidental popups.
  addMenuWrap?.addEventListener("mouseleave", () => hideAddMenu(300));
  addMenu?.addEventListener("mouseenter", () => clearTimeout(addMenuTimer));
  addMenu?.addEventListener("mouseleave", () => hideAddMenu(200));

  // Submenu activation
  addMenu?.querySelectorAll(".add-menu-item[data-sub]").forEach(item => {
    item.addEventListener("mouseenter", () => setActiveAddCategory(item));
    item.addEventListener("click", e => {
      if (e.target.closest(".add-sub-item")) return;
      setActiveAddCategory(item);
    });
  });

  // Context actions
  document.querySelectorAll(".add-sub-item[data-action], .add-quick-action[data-action]").forEach(btn => {
    btn.addEventListener("click", async () => {
      await handleAddAction(btn.dataset.action);
    });
  });

  // Permission dropdown
  $("#permBtn")?.addEventListener("click", e => {
    e.stopPropagation();
    const dd = $("#permDropdown");
    if (!dd) return;
    if (dd.classList.contains("is-open")) { dd.classList.remove("is-open"); return; }
    closeAllDropdowns();
    dd.querySelectorAll(".perm-option").forEach(opt => {
      opt.classList.toggle("is-active", opt.dataset.mode === state.permissionMode);
    });
    const rect = e.currentTarget.getBoundingClientRect();
    dd.style.top = "auto";
    dd.style.left = rect.left + "px";
    dd.style.bottom = (window.innerHeight - rect.top + 6) + "px";
    dd.classList.add("is-open");
  });
  $("#permDropdown")?.querySelectorAll(".perm-option").forEach(opt => {
    opt.addEventListener("click", () => {
      deps.setPerm?.(opt.dataset.mode);
      closeAllDropdowns();
    });
  });

  // Model selector
  $("#modelBtn")?.addEventListener("click", e => {
    e.stopPropagation();
    const dd = $("#modelDropdown");
    if (!dd) return;
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
}

async function handleAddAction(action) {
  const bridge = getBridge();
  if (action === "addFolder") {
    const folder = await bridge?.chooseFolder?.();
    if (!folder) return;
    state.cwd = folder;
    const existingPaths = new Set(data.projects.map(p => (p.path || "").toLowerCase()));
    if (!existingPaths.has(folder.toLowerCase())) {
      const proj = { id: folder, name: basename(folder), path: folder, updatedAt: Math.floor(Date.now() / 1000), sessions: [], sessionCount: 0 };
      data.projects.unshift(proj);
      state.customProjects = state.customProjects || [];
      if (!state.customProjects.some(p => (p.path || "").toLowerCase() === folder.toLowerCase())) {
        state.customProjects.push(proj);
      }
    }
    state.selectedProject = folder;
    save();
    deps.renderProjects?.();
    deps.updateFooter?.();
    closeAddMenu();
    toast(`已添加：${basename(folder)}`, "success");
  } else if (action === "addFile") {
    const file = await bridge?.chooseFile?.();
    if (!file) return;
    deps.addAttachments?.([file]);
    closeAddMenu();
    toast(`已添加：${basename(file)}`, "success");
  } else if (action === "pasteClipboard") {
    const text = await readClipboardText();
    if (!text) return;
    insertPromptText(text);
    closeAddMenu();
    toast("已粘贴到输入框", "success");
  } else if (action === "insertPlanPrompt") {
    insertPromptText("请根据当前需求拆分实现计划，列出关键步骤、风险点和验收标准。先不要修改代码。");
    closeAddMenu();
  } else if (action === "insertReviewPrompt") {
    insertPromptText("请以代码审查方式检查当前改动，按严重程度列出 bug、行为回归、风险和缺失测试。");
    closeAddMenu();
  } else if (action === "openSkills") {
    closeAddMenu();
    deps.openSettings?.("skills");
  } else if (action === "openMcp") {
    closeAddMenu();
    deps.openSettings?.("mcp");
  } else if (action === "openProviders") {
    closeAddMenu();
    deps.openSettings?.("providers");
  } else if (action === "openTeams") {
    closeAddMenu();
    deps.openTeamsBuilder?.();
  } else if (action === "exportConversation") {
    closeAddMenu();
    deps.exportConversation?.();
  } else if (action === "syncSkills") {
    closeAddMenu();
    await deps.syncActiveIdentity?.();
  }
}

function insertPromptText(text) {
  const input = $("#promptInput");
  if (!input || !text) return;
  const current = input.value || "";
  const prefix = current.trim() ? `${current.trimEnd()}\n\n` : "";
  input.value = `${prefix}${text.trim()}`;
  input.focus();
  input.dispatchEvent(new Event("input"));
}

async function readClipboardText() {
  try {
    const text = await navigator.clipboard?.readText?.();
    if (text?.trim()) return text;
  } catch {
    // Fall through to the user-facing toast below.
  }
  toast("无法读取剪贴板，请手动粘贴文本", "warning");
  return "";
}
