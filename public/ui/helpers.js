import { escapeHtml } from "../markdown.js";

export const $ = s => document.querySelector(s);

export function basename(p) { return String(p || "").split(/[\\/]/).filter(Boolean).pop() || p || ""; }

export function fmtTime(sec) {
  if (!sec) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(sec * 1000));
}

export function fmtNum(v) { return new Intl.NumberFormat("zh-CN").format(Number(v || 0)); }

export function searchable(v) { return String(v || "").toLowerCase(); }

export function hlMatch(v, term) {
  if (!term) return escapeHtml(v);
  return escapeHtml(v).replace(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"), "<mark>$1</mark>");
}

export function toast(msg, type = "info") {
  const box = document.querySelector("#toastBox");
  if (!box) return;
  const t = document.createElement("div");
  t.className = `toast ${type === "error" ? "err" : type === "success" ? "ok" : ""}`;
  t.textContent = msg;
  box.append(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 200); }, 3000);
}

export function closeAllDropdowns() {
  document.querySelectorAll(".float-dropdown.is-open").forEach(d => d.classList.remove("is-open"));
}

export function positionDropdown(dd, anchor) {
  const rect = anchor.getBoundingClientRect();
  dd.style.top = "auto";
  dd.style.left = rect.left + "px";
  dd.style.bottom = (window.innerHeight - rect.top + 6) + "px";
}
