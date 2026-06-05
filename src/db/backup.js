import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";

const BACKUP_ROOT = join(homedir(), ".claude-code-studio", "backups");
const MAX_BACKUPS = 30;

export function backupPaths(label, paths = []) {
  const existing = paths.filter(p => p && existsSync(p));
  if (!existing.length) return { ok: true, skipped: true, files: [] };

  const safeLabel = String(label || "backup").replace(/[^\w.-]+/g, "-").slice(0, 60) || "backup";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = join(BACKUP_ROOT, `${stamp}-${safeLabel}`);
  mkdirSync(target, { recursive: true });

  const copied = [];
  for (const source of existing) {
    const name = basename(source) || "root";
    const destination = join(target, name);
    cpSync(source, destination, { recursive: true, force: true });
    copied.push({ source, destination });
  }
  writeFileSync(join(target, "manifest.json"), JSON.stringify({ label, createdAt: new Date().toISOString(), copied }, null, 2), "utf8");
  pruneBackups();
  return { ok: true, path: target, files: copied };
}

export function backupClaudeSettings() {
  return backupPaths("claude-settings", [join(homedir(), ".claude", "settings.json")]);
}

export function backupClaudeSkills() {
  return backupPaths("claude-skills", [join(homedir(), ".claude", "skills")]);
}

function pruneBackups() {
  try {
    if (!existsSync(BACKUP_ROOT)) return;
    const dirs = readdirSync(BACKUP_ROOT)
      .map(name => ({ name, path: join(BACKUP_ROOT, name) }))
      .filter(item => statSync(item.path).isDirectory())
      .sort((a, b) => b.name.localeCompare(a.name));
    for (const item of dirs.slice(MAX_BACKUPS)) rmSync(item.path, { recursive: true, force: true });
  } catch (e) {
    console.error("[backup] pruneBackups failed:", e.message);
  }
}
