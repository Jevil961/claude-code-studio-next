import { readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

export function isInsidePath(root, target) {
  const base = resolve(root);
  const candidate = resolve(target);
  return candidate === base || candidate.startsWith(base + sep);
}

export function assertInsidePath(root, target, label = "path") {
  if (!root || !target || !isInsidePath(root, target)) {
    throw new Error(`${label} is outside the allowed directory`);
  }
  return resolve(target);
}

export function validatePluginInstallName(value) {
  const name = String(value || "").trim();
  if (!name) throw new Error("Plugin name is required");
  if (name.length > 120) throw new Error("Plugin name is too long");
  if (!/^[a-zA-Z0-9._@/-]+$/.test(name)) throw new Error("Plugin name contains unsupported characters");
  if (name.includes("..") || name.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(name)) {
    throw new Error("Plugin name must be a marketplace package name, not a local path");
  }
  return name;
}

export function safeReadTextFile(path, { maxBytes = 1024 * 1024 } = {}) {
  const st = statSync(path);
  if (!st.isFile()) throw new Error("Path is not a file");
  if (st.size > maxBytes) throw new Error("File is too large to preview");
  const text = readFileSync(path, "utf8");
  if (text.includes("\u0000")) throw new Error("Binary files cannot be previewed as text");
  return text;
}
