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

const MAX_TOASTS = 5;
const activeToasts = new Map(); // message -> { el, count }

export function toast(msg, type = "info", retryFn) {
  const box = document.querySelector("#toastBox");
  if (!box) return;

  // Dedup: if same message exists, update count
  if (activeToasts.has(msg)) {
    const existing = activeToasts.get(msg);
    existing.count++;
    const countEl = existing.el.querySelector('.toast-count');
    if (countEl) countEl.textContent = `×${existing.count}`;
    // Reset dismiss timer
    clearTimeout(existing.timer);
    existing.timer = setTimeout(() => removeToast(msg), 3000);
    return;
  }

  // Enforce max toasts
  while (activeToasts.size >= MAX_TOASTS) {
    const oldest = activeToasts.keys().next().value;
    removeToast(oldest);
  }

  const t = document.createElement("div");
  t.className = `toast ${type === "error" ? "err" : type === "success" ? "ok" : ""}`;
  t.setAttribute('role', 'alert');

  const textSpan = document.createElement('span');
  textSpan.textContent = msg;
  t.append(textSpan);

  const countSpan = document.createElement('span');
  countSpan.className = 'toast-count';
  countSpan.style.cssText = 'margin-left:4px;font-size:11px;opacity:0.7;';
  t.append(countSpan);

  if (retryFn && (type === 'error' || type === 'info')) {
    const retryBtn = document.createElement('button');
    retryBtn.className = 'toast-retry';
    retryBtn.textContent = '重试';
    retryBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeToast(msg);
      retryFn();
    });
    t.append(retryBtn);
  }

  box.append(t);

  const timer = setTimeout(() => removeToast(msg), 3000);
  activeToasts.set(msg, { el: t, count: 1, timer });
}

function removeToast(msg) {
  const entry = activeToasts.get(msg);
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.el.classList.add("out");
  setTimeout(() => { entry.el.remove(); activeToasts.delete(msg); }, 200);
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
