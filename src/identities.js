import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { categorizeAllSkills, CATEGORIES } from "./skill-categories.js";

function identitiesPath() {
  return process.env.CCS_IDENTITIES_PATH || join(homedir(), ".claude-code-studio", "identities.json");
}

function loadFile() {
  const file = identitiesPath();
  if (!existsSync(file)) return { identities: [] };
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return { identities: [] }; }
}

function saveFile(data) {
  const file = identitiesPath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

// ── Categories structure helpers ──

// Build default empty categories map
function emptyCategories() {
  const cats = {};
  for (const catId of Object.keys(CATEGORIES)) {
    cats[catId] = { enabled: false, skills: {} };
  }
  return cats;
}

// Get all enabled skill directories from an identity's categories
function normalizeCategories(categories = {}) {
  const normalized = emptyCategories();
  for (const [catId, catData] of Object.entries(categories || {})) {
    normalized[catId] = {
      enabled: Boolean(catData?.enabled),
      skills: { ...(catData?.skills || {}) },
    };
  }
  return normalized;
}

function selectedDirsForCategory(catData, catSkills) {
  if (!catData?.enabled) return [];
  const available = new Set(catSkills.map(s => s.directory));
  const entries = Object.entries(catData.skills || {}).filter(([dir]) => available.has(dir));
  if (!entries.length) return catSkills.map(s => s.directory);

  const hasExplicitInclude = entries.some(([, enabled]) => enabled === true);
  if (hasExplicitInclude) return entries.filter(([, enabled]) => enabled === true).map(([dir]) => dir);

  const excluded = new Set(entries.filter(([, enabled]) => enabled === false).map(([dir]) => dir));
  return catSkills.map(s => s.directory).filter(dir => !excluded.has(dir));
}

export function resolveIdentitySkillDirectories(identity, allCategorizedSkills) {
  const categories = normalizeCategories(identity?.categories || {});
  const resolved = [];
  for (const [catId, catData] of Object.entries(categories)) {
    const catSkills = allCategorizedSkills.filter(s => s.category === catId && s.inCcSwitch !== false);
    resolved.push(...selectedDirsForCategory(catData, catSkills));
  }
  return [...new Set(resolved)];
}

export function identitySkillStats(identity, allCategorizedSkills) {
  const resolved = resolveIdentitySkillDirectories(identity, allCategorizedSkills);
  const enabledCategories = Object.values(normalizeCategories(identity?.categories || {})).filter(c => c.enabled).length;
  return { enabledCategories, skillCount: resolved.length, directories: resolved };
}

export function reconcileWithSkills(allCategorizedSkills) {
  const data = loadFile();
  const known = new Set(allCategorizedSkills.map(s => s.directory));
  let changed = false;
  for (const identity of data.identities) {
    const categories = normalizeCategories(identity.categories || {});
    for (const catData of Object.values(categories)) {
      for (const dir of Object.keys(catData.skills || {})) {
        if (!known.has(dir)) {
          delete catData.skills[dir];
          changed = true;
        }
      }
    }
    if (JSON.stringify(identity.categories || {}) !== JSON.stringify(categories)) {
      identity.categories = categories;
      changed = true;
    }
  }
  if (changed) saveFile(data);
  return { ok: true, identities: data.identities, changed };
}

function categorySkillMap(allCategorizedSkills) {
  const map = {};
  for (const skill of allCategorizedSkills.filter(s => s.inCcSwitch !== false)) {
    const cat = skill.category || "other";
    if (!map[cat]) map[cat] = [];
    map[cat].push(skill);
  }
  return map;
}

function categoryName(catId) {
  return CATEGORIES[catId]?.name || catId;
}

// Category families — skills within the same family can coexist in one identity
const SECURITY_CATS = new Set([
  "security-web", "security-injection", "security-auth",
  "security-binary", "security-os", "security-infra",
  "security-crypto", "security-mobile", "security-misc",
]);
const DEV_CATS = new Set(["coding"]);

function sameFamily(a, b) {
  if (a === b) return true;
  if (a === "other" || b === "other") return false;
  if (SECURITY_CATS.has(a)) return SECURITY_CATS.has(b);
  if (DEV_CATS.has(a)) return DEV_CATS.has(b);
  return false;
}

function analyzedCategoryToIdentity(suggestion, allCategorizedSkills, index, source) {
  const byDir = new Map(allCategorizedSkills.map(s => [s.directory, s]));
  const dirs = [...new Set((suggestion.skills || []).filter(dir => byDir.has(dir)))];
  if (!dirs.length) return null;

  // Count skills per category
  const catCounts = {};
  for (const dir of dirs) {
    const skill = byDir.get(dir);
    const cat = skill?.category || "other";
    catCounts[cat] = (catCounts[cat] || 0) + 1;
  }

  // Find dominant category (most skills)
  const sorted = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);
  const dominantCat = sorted[0][0];
  const total = dirs.length;

  // Build categories: only enable those related to the dominant family,
  // or with significant representation (>=25% of skills)
  const categories = emptyCategories();
  for (const [cat, count] of sorted) {
    const ratio = count / total;
    if (sameFamily(cat, dominantCat) || ratio >= 0.25) {
      categories[cat].enabled = true;
    }
  }

  // Enable specific skills only for enabled categories
  for (const dir of dirs) {
    const skill = byDir.get(dir);
    const cat = skill?.category || "other";
    if (categories[cat]?.enabled) {
      categories[cat].skills[dir] = true;
    }
  }

  const enabledCats = Object.entries(categories).filter(([, v]) => v.enabled);
  const keptSkills = dirs.filter(dir => {
    const s = byDir.get(dir);
    return categories[s?.category || "other"]?.enabled;
  });
  if (!keptSkills.length) return null;

  return {
    id: randomUUID(),
    name: String(suggestion.name || `Skills 分类 ${index + 1}`).slice(0, 40),
    icon: String(suggestion.icon || "AI").slice(0, 8),
    description: String(suggestion.description || suggestion.reason || "基于当前 Skills 自动分类生成").slice(0, 160) + ` (${keptSkills.length} Skills)`,
    categories,
    active: false,
    autoGenerated: true,
    generatedBy: source,
    generatedKind: "skill-category",
    createdAt: Date.now(),
  };
}

export function localSkillAnalysis(allSkills) {
  const categorized = categorizeAllSkills(allSkills);
  const groups = categorySkillMap(categorized);
  const clusters = [
    { name: "开发工程", icon: "Dev", cats: ["coding"] },
    { name: "Web 与 API 安全", icon: "Web", cats: ["security-web", "security-injection", "security-auth"] },
    { name: "系统与基础设施安全", icon: "Ops", cats: ["security-os", "security-infra"] },
    { name: "逆向与密码研究", icon: "Rev", cats: ["security-binary", "security-crypto", "security-mobile"] },
    { name: "综合安全分析", icon: "Sec", cats: ["security-misc", "other"] },
  ];

  const categories = [];
  for (const cluster of clusters) {
    const skills = cluster.cats.flatMap(cat => groups[cat] || []);
    if (!skills.length) continue;
    categories.push({
      name: cluster.name,
      icon: cluster.icon,
      description: `覆盖 ${cluster.cats.filter(cat => groups[cat]?.length).map(categoryName).join(" / ")}`,
      reason: "本地规则根据分类密度自动聚合",
      skills: skills.slice(0, 60).map(s => s.directory),
    });
  }

  if (categorized.length && categories.length < 2) {
    categories.push({
      name: "通用助手",
      icon: "All",
      description: "覆盖当前可用 Skills 的通用身份",
      reason: "Skills 数量较少，生成通用身份",
      skills: categorized.filter(s => s.inCcSwitch !== false).slice(0, 80).map(s => s.directory),
    });
  }

  return { categories: categories.slice(0, 6), source: "local-analysis" };
}

export function applyAnalyzedIdentities(analysis, allSkills, source = "ai-analysis") {
  const categorized = categorizeAllSkills(allSkills);
  const data = loadFile();
  const suggestions = Array.isArray(analysis?.categories)
    ? analysis.categories
    : Array.isArray(analysis?.identities)
      ? analysis.identities
      : [];
  const generated = suggestions
    .map((suggestion, index) => analyzedCategoryToIdentity(suggestion, categorized, index, source))
    .filter(Boolean)
    .slice(0, 8);

  data.identities = data.identities.filter(i => !i.autoGenerated);
  const hasActive = data.identities.some(i => i.active);
  if (!hasActive && generated.length) generated[0].active = true;
  data.identities.push(...generated);
  saveFile(data);
  return { ok: true, identities: data.identities, generated: generated.length, source };
}

// ── CRUD ──

export function getIdentities() {
  return loadFile().identities;
}

export function getActiveIdentity() {
  const ids = getIdentities();
  return ids.find(i => i.active) || ids[0] || null;
}

export function setActiveIdentity(id) {
  const data = loadFile();
  for (const identity of data.identities) {
    identity.active = identity.id === id;
  }
  saveFile(data);
  return { ok: true, active: data.identities.find(i => i.id === id) || null };
}

export function createIdentity({ name, icon, description }) {
  const data = loadFile();
  const identity = {
    id: randomUUID(),
    name: name || "新身份",
    icon: icon || "📌",
    description: description || "",
    categories: emptyCategories(),
    active: false,
    autoGenerated: false,
    createdAt: Date.now(),
  };
  data.identities.push(identity);
  saveFile(data);
  return { ok: true, identity };
}

export function updateIdentity(id, updates) {
  const data = loadFile();
  const idx = data.identities.findIndex(i => i.id === id);
  if (idx === -1) return { ok: false, error: "Identity not found" };
  const allowed = ["name", "icon", "description", "categories"];
  for (const key of allowed) {
    if (updates[key] !== undefined) data.identities[idx][key] = updates[key];
  }
  saveFile(data);
  return { ok: true, identity: data.identities[idx] };
}

export function deleteIdentity(id) {
  const data = loadFile();
  const idx = data.identities.findIndex(i => i.id === id);
  if (idx === -1) return { ok: false, error: "Identity not found" };
  const wasActive = data.identities[idx].active;
  data.identities.splice(idx, 1);
  if (wasActive && data.identities.length) data.identities[0].active = true;
  saveFile(data);
  return { ok: true };
}

// ── Category-level operations ──

export function setCategoryEnabled(identityId, categoryId, enabled) {
  const data = loadFile();
  const identity = data.identities.find(i => i.id === identityId);
  if (!identity) return { ok: false, error: "Identity not found" };
  if (!identity.categories) identity.categories = emptyCategories();
  if (!identity.categories[categoryId]) identity.categories[categoryId] = { enabled: false, skills: {} };
  identity.categories[categoryId].enabled = enabled;
  saveFile(data);
  return { ok: true, identity };
}

export function setSkillInCategory(identityId, categoryId, skillDir, enabled) {
  const data = loadFile();
  const identity = data.identities.find(i => i.id === identityId);
  if (!identity) return { ok: false, error: "Identity not found" };
  if (!identity.categories) identity.categories = emptyCategories();
  if (!identity.categories[categoryId]) identity.categories[categoryId] = { enabled: true, skills: {} };
  identity.categories[categoryId].skills[skillDir] = enabled;
  // If enabling a skill, make sure the category is also enabled
  if (enabled) identity.categories[categoryId].enabled = true;
  saveFile(data);
  return { ok: true, identity };
}

export function enableAllInCategory(identityId, categoryId) {
  const data = loadFile();
  const identity = data.identities.find(i => i.id === identityId);
  if (!identity) return { ok: false, error: "Identity not found" };
  if (!identity.categories) identity.categories = emptyCategories();
  identity.categories[categoryId] = { enabled: true, skills: {} };
  saveFile(data);
  return { ok: true, identity };
}

export function disableAllInCategory(identityId, categoryId) {
  const data = loadFile();
  const identity = data.identities.find(i => i.id === identityId);
  if (!identity) return { ok: false, error: "Identity not found" };
  if (!identity.categories) identity.categories = emptyCategories();
  identity.categories[categoryId] = { enabled: false, skills: {} };
  saveFile(data);
  return { ok: true, identity };
}

// ── Auto-generate: smart multi-category identity templates ──

const IDENTITY_TEMPLATES = [
  {
    name: "红队渗透", icon: "🎯",
    desc: "完整攻击链：Web漏洞利用、注入攻击、认证绕过、权限提升、横向移动",
    cats: ["security-web", "security-injection", "security-auth", "security-os", "security-infra"],
  },
  {
    name: "安全审计", icon: "🔍",
    desc: "代码审计与安全审查：Web安全、认证鉴权、业务逻辑漏洞、供应链风险",
    cats: ["security-web", "security-auth", "security-misc", "coding"],
  },
  {
    name: "安全研究", icon: "🔬",
    desc: "深度漏洞研究：二进制逆向、密码分析、移动安全、注入攻击原理",
    cats: ["security-binary", "security-crypto", "security-mobile", "security-injection"],
  },
  {
    name: "全栈开发", icon: "💻",
    desc: "完整开发能力：编程开发、TDD、原型设计、架构改进、代码审查",
    cats: ["coding"],
  },
  {
    name: "DevSecOps", icon: "⚡",
    desc: "开发安全一体化：编程开发 + 依赖安全 + Web安全 + 基础设施安全",
    cats: ["coding", "security-web", "security-infra", "security-misc"],
  },
  {
    name: "Web安全专家", icon: "🌐",
    desc: "专注Web应用：XSS、SQL注入、SSRF、CSRF、CORS、请求走私等",
    cats: ["security-web", "security-injection"],
  },
  {
    name: "内网渗透", icon: "🏗️",
    desc: "内网攻防：AD域渗透、Kerberos攻击、横向移动、隧道代理、权限维持",
    cats: ["security-os", "security-infra", "security-auth"],
  },
];

export function autoGenerateIdentities(allSkills) {
  const categorized = categorizeAllSkills(allSkills);
  const data = loadFile();

  // Remove old auto-generated
  data.identities = data.identities.filter(i => !i.autoGenerated);

  // Build skill counts per category for viability check
  const catCounts = {};
  for (const s of categorized) {
    const c = s.category || "other";
    catCounts[c] = (catCounts[c] || 0) + 1;
  }

  const newIdentities = [];
  for (const tpl of IDENTITY_TEMPLATES) {
    // Only create identity if at least 2 categories have skills
    const viable = tpl.cats.filter(c => (catCounts[c] || 0) > 0);
    if (viable.length < 1) continue;

    const cats = emptyCategories();
    let totalSkills = 0;
    for (const catId of tpl.cats) {
      if ((catCounts[catId] || 0) > 0) {
        cats[catId] = { enabled: true, skills: {} };
        totalSkills += catCounts[catId] || 0;
      }
    }

    newIdentities.push({
      id: randomUUID(),
      name: tpl.name,
      icon: tpl.icon,
      description: tpl.desc + " (" + totalSkills + " Skills)",
      categories: cats,
      active: false,
      autoGenerated: true,
      createdAt: Date.now(),
    });
  }

  const hasActive = data.identities.some(i => i.active);
  if (!hasActive && newIdentities.length) newIdentities[0].active = true;

  data.identities.push(...newIdentities);
  saveFile(data);
  return { ok: true, identities: data.identities, generated: newIdentities.length };
}

// ── Resolve for sync ──

export function resolveActiveSkills(allCategorizedSkills) {
  const active = getActiveIdentity();
  if (!active) return [];
  return resolveIdentitySkillDirectories(active, allCategorizedSkills);
}
