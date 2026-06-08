import { existsSync, readFileSync, mkdirSync, readdirSync, statSync, copyFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import { query, run, PATHS } from "./connection.js";
import { backupClaudeSkills } from "./backup.js";

export function list() {
  return query(`SELECT id,name,description,directory,enabled_claude,installed_at,updated_at FROM skills ORDER BY enabled_claude DESC,LOWER(name)`).map(r => ({
    id: r.id, name: r.name, description: r.description || "", directory: r.directory,
    enabledClaude: Boolean(r.enabled_claude), installedAt: r.installed_at || 0, updatedAt: r.updated_at || 0,
    inCcSwitch: existsSync(join(PATHS.CC_SKILLS, r.directory)),
    inClaude: existsSync(join(PATHS.CLAUDE_SKILLS, r.directory)),
  }));
}

export function sync(dirs = null) {
  mkdirSync(PATHS.CLAUDE_SKILLS, { recursive: true });
  let rows;
  if (dirs != null) {
    const ph = dirs.map(() => "?").join(",");
    rows = query(`SELECT name,directory FROM skills WHERE directory IN (${ph})`, dirs);
  } else {
    rows = query(`SELECT name,directory FROM skills WHERE enabled_claude=1`);
  }
  const copied = [], skipped = [], missing = [];
  const wanted = new Set(rows.map(r => r.directory));
  let backedUp = false;
  const ensureBackup = () => {
    if (backedUp) return;
    backupClaudeSkills();
    backedUp = true;
  };
  const removed = pruneClaudeSkills(wanted, ensureBackup);
  for (const r of rows) {
    const src = join(PATHS.CC_SKILLS, r.directory), dst = join(PATHS.CLAUDE_SKILLS, r.directory);
    if (!existsSync(src)) { missing.push(r.name); continue; }
    if (existsSync(dst) && statSync(dst).isDirectory()) {
      try {
        if (hashDir(src) === hashDir(dst)) {
          skipped.push(r.name);
          continue;
        }
      } catch {}
    }
    if (existsSync(dst)) { ensureBackup(); rmSync(dst, { recursive: true, force: true }); }
    copyDir(src, dst); copied.push(r.name);
  }
  return { ok: true, copied, skipped, missing, removed };
}

export function previewSync(dirs = null) {
  let rows;
  if (dirs != null) {
    const ph = dirs.map(() => "?").join(",");
    rows = query(`SELECT name,directory FROM skills WHERE directory IN (${ph})`, dirs);
  } else {
    rows = query(`SELECT name,directory FROM skills WHERE enabled_claude=1`);
  }
  const planned = rows.map(r => {
    const src = join(PATHS.CC_SKILLS, r.directory);
    const dst = join(PATHS.CLAUDE_SKILLS, r.directory);
    let action = "copy";
    if (!existsSync(src)) action = "missing";
    else if (existsSync(dst)) {
      try {
        action = statSync(dst).isDirectory() && hashDir(src) === hashDir(dst) ? "skip" : "overwrite";
      } catch {
        action = "overwrite";
      }
    }
    return {
      name: r.name,
      directory: r.directory,
      existsInSource: existsSync(src),
      existsInClaude: existsSync(dst),
      action,
    };
  });
  const current = existsSync(PATHS.CLAUDE_SKILLS) ? readdirSync(PATHS.CLAUDE_SKILLS) : [];
  const wanted = new Set(rows.map(r => r.directory));
  const extra = current.filter(name => !wanted.has(name));
  return {
    count: planned.length,
    copy: planned.filter(i => i.action === "copy").length,
    overwrite: planned.filter(i => i.action === "overwrite").length,
    skipped: planned.filter(i => i.action === "skip").length,
    missing: planned.filter(i => i.action === "missing").length,
    extra,
    planned,
  };
}

export function rescan() {
  mkdirSync(PATHS.CC_SKILLS, { recursive: true });
  const dirs = readdirSync(PATHS.CC_SKILLS).filter(d => {
    const p = join(PATHS.CC_SKILLS, d);
    return statSync(p).isDirectory();
  });

  const now = Math.floor(Date.now() / 1000);
  const found = new Set();
  let added = 0, updated = 0;

  for (const dir of dirs) {
    found.add(dir);
    const dirPath = join(PATHS.CC_SKILLS, dir);
    const meta = extractSkillMeta(dirPath, dir);
    const name = meta.name, desc = meta.desc;
    // Upsert
    const existing = query("SELECT id FROM skills WHERE directory=?", [dir]);
    if (existing.length) {
      run("UPDATE skills SET name=?, description=?, updated_at=? WHERE directory=?", [name, desc, now, dir]);
      updated++;
    } else {
      run("INSERT INTO skills (id,name,description,directory,enabled_claude,installed_at,updated_at) VALUES (?,?,?,?,1,?,?)",
        ["local:" + dir, name, desc, dir, now, now]);
      added++;
    }
  }

  // Remove stale entries
  const all = query("SELECT directory FROM skills");
  let removed = 0;
  for (const r of all) {
    if (!found.has(r.directory)) {
      // Also clean up claude skills copy
      const dst = join(PATHS.CLAUDE_SKILLS, r.directory);
      if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });
      run("DELETE FROM skills WHERE directory=?", [r.directory]);
      removed++;
    }
  }

  return { ok: true, added, updated, removed, scanned: dirs.length };
}

export function clear() {
  if (!existsSync(PATHS.CLAUDE_SKILLS)) return;
  backupClaudeSkills();
  for (const f of readdirSync(PATHS.CLAUDE_SKILLS)) rmSync(join(PATHS.CLAUDE_SKILLS, f), { recursive: true, force: true });
}

function extractSkillMeta(dirPath, fallbackName) {
  let name = fallbackName, desc = "";
  for (const f of ["SKILL.md", "README.md"]) {
    const fp = join(dirPath, f);
    if (!existsSync(fp)) continue;
    const raw = readFileSync(fp, "utf8");
    const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
    if (fmMatch) {
      const fm = fmMatch[1];
      const fmName = fm.match(/^name:\s*(.+)$/m);
      const fmDesc = fm.match(/^description:\s*(.+)$/m);
      if (fmName) name = fmName[1].trim().slice(0, 80);
      if (fmDesc) desc = fmDesc[1].trim().slice(0, 200);
    }
    if (name === fallbackName) {
      const hMatch = raw.match(/^#\s+(.+)$/m);
      if (hMatch) name = hMatch[1].trim().slice(0, 80);
    }
    if (!desc) {
      const lines = raw.split(/\r?\n/);
      let inFM = false;
      for (const line of lines) {
        if (line.trim() === "---") { inFM = !inFM; continue; }
        if (inFM) continue;
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        desc = t.slice(0, 200);
        break;
      }
    }
    break;
  }
  if (!desc) desc = name;
  return { name, desc };
}

export function importDir(path) {
  if (!existsSync(path) || !statSync(path).isDirectory()) throw new Error("Not a directory");
  const dirBase = basename(path);
  let target = join(PATHS.CC_SKILLS, dirBase);
  mkdirSync(join(PATHS.CC_SKILLS), { recursive: true });
  if (existsSync(target)) target = join(PATHS.CC_SKILLS, dirBase + "-" + Date.now());
  const directory = basename(target);
  copyDir(path, target);
  const meta = extractSkillMeta(target, dirBase);
  const now = Math.floor(Date.now() / 1000);
  run("INSERT OR REPLACE INTO skills (id,name,description,directory,enabled_claude,installed_at,updated_at) VALUES (?,?,?,?,1,?,?)",
    ["local:" + directory, meta.name, meta.desc, directory, now, now]);
  return { ok: true, name: meta.name, directory };
}

export function update(dir, u) {
  if (u.enabledClaude !== undefined) run(`UPDATE skills SET enabled_claude=? WHERE directory=?`, [u.enabledClaude ? 1 : 0, dir]);
  if (u.name !== undefined) run(`UPDATE skills SET name=? WHERE directory=?`, [u.name, dir]);
  return { ok: true };
}

export function remove(dir) {
  const dst = join(PATHS.CLAUDE_SKILLS, dir), src = join(PATHS.CC_SKILLS, dir);
  backupClaudeSkills();
  if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });
  if (existsSync(src)) rmSync(src, { recursive: true, force: true });
  run(`DELETE FROM skills WHERE directory=?`, [dir]);
  return { ok: true };
}

function copyDir(s, d) {
  mkdirSync(d, { recursive: true });
  for (const f of readdirSync(s)) {
    const sp = join(s, f), dp = join(d, f);
    if (statSync(sp).isDirectory()) copyDir(sp, dp); else copyFileSync(sp, dp);
  }
}

function pruneClaudeSkills(wanted, ensureBackup = () => {}) {
  if (!existsSync(PATHS.CLAUDE_SKILLS)) return [];
  const removed = [];
  for (const name of readdirSync(PATHS.CLAUDE_SKILLS)) {
    if (wanted.has(name)) continue;
    const p = join(PATHS.CLAUDE_SKILLS, name);
    ensureBackup();
    rmSync(p, { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}

function hashDir(dir) {
  const hash = createHash("sha1");
  walkHash(dir, "");
  return hash.digest("hex");

  function walkHash(abs, rel) {
    const entries = readdirSync(abs).sort((a, b) => a.localeCompare(b));
    for (const name of entries) {
      const fp = join(abs, name);
      const st = statSync(fp);
      const relPath = rel ? `${rel}/${name}` : name;
      if (st.isDirectory()) {
        hash.update(`d\0${relPath}\0`);
        walkHash(fp, relPath);
      } else if (st.isFile()) {
        hash.update(`f\0${relPath}\0${st.size}\0`);
        hash.update(readFileSync(fp));
      }
    }
  }
}
