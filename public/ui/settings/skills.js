import { data, state, save } from "../state.js";
import { safeBridge, getBridge } from "../bridge.js";
import { toast } from "../helpers.js";
import { showModal } from "../modal.js";
import { escapeHtml } from "../../markdown.js";
import { loadSkillCategories, loadIdentities, syncActiveIdentity, skillCategoriesLoaded } from "../data-loader.js";
import { selectedSkillDirsForCategory, resolvedIdentitySkillDirs } from "./settings-helpers.js";

function identitySkillCount(identity) {
  return resolvedIdentitySkillDirs(identity).length;
}

export function renderSkillsSettings({ settingsBody, settingsPage, renderSettingsTab, switchIdentity }) {
  const bridge = getBridge();

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
  header.querySelector("#importSkillBtn").addEventListener("click", () => importSkill({ renderSettingsTab }));
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

async function importSkill({ renderSettingsTab }) {
  const bridge = getBridge();
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
