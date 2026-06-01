import { $ } from "./helpers.js";

export function showModal(title, fields) {
  return new Promise(resolve => {
    const overlay = $("#modalOverlay"), titleEl = $("#modalTitle"), fieldsEl = $("#modalFields");
    const okBtn = $("#modalOk"), cancelBtn = $("#modalCancel");
    titleEl.textContent = title; fieldsEl.innerHTML = "";
    for (const f of fields) {
      const div = document.createElement("div"); div.className = "modal-field";
      const lbl = document.createElement("label"); lbl.textContent = f.label;
      let inp;
      if (f.type === "textarea") { inp = document.createElement("textarea"); }
      else if (f.type === "select") { inp = document.createElement("select"); for (const o of (f.options || [])) { const opt = document.createElement("option"); opt.value = o.value; opt.textContent = o.label; inp.append(opt); } }
      else { inp = document.createElement("input"); inp.type = f.type || "text"; }
      inp.value = f.value || ""; inp.placeholder = f.placeholder || ""; inp.dataset.key = f.key;
      lbl.append(inp); div.append(lbl); fieldsEl.append(div);
    }
    overlay.classList.add("is-open");
    setTimeout(() => { const first = fieldsEl.querySelector("input,textarea,select"); if (first) first.focus(); }, 50);
    function close(r) { overlay.classList.remove("is-open"); okBtn.removeEventListener("click", onOk); cancelBtn.removeEventListener("click", onCancel); overlay.removeEventListener("click", onBg); document.removeEventListener("keydown", onKey); resolve(r); }
    function onOk() { const r = {}; for (const i of fieldsEl.querySelectorAll("input,textarea,select")) r[i.dataset.key] = i.value; close(r); }
    function onCancel() { close(null); }
    function onBg(e) { if (e.target === overlay) close(null); }
    function onKey(e) { if (e.key === "Escape") close(null); }
    okBtn.addEventListener("click", onOk); cancelBtn.addEventListener("click", onCancel);
    overlay.addEventListener("click", onBg); document.addEventListener("keydown", onKey);
  });
}

export function showConfirm(title, msg) {
  return new Promise(resolve => {
    const overlay = $("#confirmOverlay");
    $("#confirmTitle").textContent = title; $("#confirmMsg").textContent = msg;
    overlay.classList.add("is-open");
    function close(r) { overlay.classList.remove("is-open"); okBtn.removeEventListener("click", onOk); cancelBtn.removeEventListener("click", onCancel); overlay.removeEventListener("click", onBg); document.removeEventListener("keydown", onKey); resolve(r); }
    const okBtn = $("#confirmOk"), cancelBtn = $("#confirmCancel");
    function onOk() { close(true); }
    function onCancel() { close(false); }
    function onBg(e) { if (e.target === overlay) close(false); }
    function onKey(e) { if (e.key === "Escape") close(false); }
    okBtn.addEventListener("click", onOk); cancelBtn.addEventListener("click", onCancel);
    overlay.addEventListener("click", onBg); document.addEventListener("keydown", onKey);
  });
}
