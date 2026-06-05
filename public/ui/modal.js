import { $ } from "./helpers.js";

let lastFocused = null;

function getFocusable(container) {
  return [...container.querySelectorAll('button, input, textarea, select, [tabindex]:not([tabindex="-1"])')]
    .filter(el => !el.disabled && el.offsetParent !== null);
}

function trapFocus(container, e) {
  const focusable = getFocusable(container);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function validateField(fieldDef, value, fieldEl) {
  const errEl = fieldEl.querySelector('.field-error');
  if (fieldDef.required && !value.trim()) {
    if (errEl) errEl.textContent = `${fieldDef.label}不能为空`;
    fieldEl.classList.add('is-invalid');
    return false;
  }
  if (fieldDef.pattern && value && !new RegExp(fieldDef.pattern).test(value)) {
    if (errEl) errEl.textContent = fieldDef.patternMessage || '格式不正确';
    fieldEl.classList.add('is-invalid');
    return false;
  }
  if (fieldDef.minlength && value && value.length < fieldDef.minlength) {
    if (errEl) errEl.textContent = `至少需要 ${fieldDef.minlength} 个字符`;
    fieldEl.classList.add('is-invalid');
    return false;
  }
  if (fieldDef.validate && value) {
    const msg = fieldDef.validate(value);
    if (msg) { if (errEl) errEl.textContent = msg; fieldEl.classList.add('is-invalid'); return false; }
  }
  if (errEl) errEl.textContent = '';
  fieldEl.classList.remove('is-invalid');
  return true;
}

export function showModal(title, fields) {
  return new Promise(resolve => {
    lastFocused = document.activeElement;
    const overlay = $("#modalOverlay"), titleEl = $("#modalTitle"), fieldsEl = $("#modalFields");
    const okBtn = $("#modalOk"), cancelBtn = $("#modalCancel");
    titleEl.textContent = title; fieldsEl.innerHTML = "";

    for (const f of fields) {
      const div = document.createElement("div"); div.className = "modal-field";
      const lbl = document.createElement("label"); lbl.textContent = f.label;
      let inp;
      if (f.type === "textarea") { inp = document.createElement("textarea"); }
      else if (f.type === "select") { inp = document.createElement("select"); for (const o of (f.options || [])) { const opt = document.createElement("option"); opt.value = o.value; opt.textContent = o.label; inp.append(opt); } }
      else {
        inp = document.createElement("input");
        inp.type = f.type || "text";
        if (f.type === 'password') {
          const wrap = document.createElement('div');
          wrap.className = 'pw-field';
          wrap.appendChild(inp);
          const toggle = document.createElement('button');
          toggle.type = 'button';
          toggle.className = 'pw-toggle';
          toggle.textContent = '显';
          toggle.setAttribute('aria-label', '显示密码');
          toggle.addEventListener('click', () => {
            inp.type = inp.type === 'password' ? 'text' : 'password';
            toggle.textContent = inp.type === 'password' ? '显' : '隐';
            toggle.setAttribute('aria-label', inp.type === 'password' ? '显示密码' : '隐藏密码');
          });
          wrap.appendChild(toggle);
          lbl.appendChild(wrap);
          div.append(lbl);
          inp.value = f.value || ""; inp.placeholder = f.placeholder || ""; inp.dataset.key = f.key;
          if (f.required) inp.setAttribute('required', '');
          if (f.minlength) inp.setAttribute('minlength', f.minlength);
          const errDiv = document.createElement('div'); errDiv.className = 'field-error';
          div.append(errDiv);
          fieldsEl.append(div);
          continue;
        }
      }
      inp.value = f.value || ""; inp.placeholder = f.placeholder || ""; inp.dataset.key = f.key;
      if (f.required) inp.setAttribute('required', '');
      if (f.minlength) inp.setAttribute('minlength', f.minlength);
      if (f.maxlength) inp.setAttribute('maxlength', f.maxlength);
      lbl.append(inp); div.append(lbl);
      const errDiv = document.createElement('div'); errDiv.className = 'field-error';
      div.append(errDiv);
      fieldsEl.append(div);

      // Live validation on input
      inp.addEventListener('input', () => validateField(f, inp.value, div));
    }

    overlay.classList.add("is-open");
    setTimeout(() => { const first = fieldsEl.querySelector("input,textarea,select"); if (first) first.focus(); }, 50);

    function close(r) {
      overlay.classList.remove("is-open");
      okBtn.removeEventListener("click", onOk); cancelBtn.removeEventListener("click", onCancel);
      overlay.removeEventListener("click", onBg); document.removeEventListener("keydown", onKey);
      if (lastFocused) { try { lastFocused.focus(); } catch {} }
      resolve(r);
    }

    function validateAll() {
      let valid = true;
      for (const f of fields) {
        const fieldEl = fieldsEl.querySelector(`[data-key="${f.key}"]`)?.closest('.modal-field');
        const inp = fieldsEl.querySelector(`[data-key="${f.key}"]`);
        if (fieldEl && inp) {
          if (!validateField(f, inp.value, fieldEl)) valid = false;
        }
      }
      return valid;
    }

    function onOk() {
      if (!validateAll()) return;
      const r = {}; for (const i of fieldsEl.querySelectorAll("input,textarea,select")) r[i.dataset.key] = i.value; close(r);
    }
    function onCancel() { close(null); }
    function onBg(e) { if (e.target === overlay) close(null); }
    function onKey(e) {
      if (e.key === "Escape") { close(null); return; }
      if (e.key === 'Tab') trapFocus(overlay.querySelector('.modal-box'), e);
    }
    okBtn.addEventListener("click", onOk); cancelBtn.addEventListener("click", onCancel);
    overlay.addEventListener("click", onBg); document.addEventListener("keydown", onKey);
  });
}

export function showConfirm(title, msg) {
  return new Promise(resolve => {
    lastFocused = document.activeElement;
    const overlay = $("#confirmOverlay");
    $("#confirmTitle").textContent = title; $("#confirmMsg").textContent = msg;
    overlay.classList.add("is-open");
    function close(r) {
      overlay.classList.remove("is-open");
      okBtn.removeEventListener("click", onOk); cancelBtn.removeEventListener("click", onCancel);
      overlay.removeEventListener("click", onBg); document.removeEventListener("keydown", onKey);
      if (lastFocused) { try { lastFocused.focus(); } catch {} }
      resolve(r);
    }
    const okBtn = $("#confirmOk"), cancelBtn = $("#confirmCancel");
    function onOk() { close(true); }
    function onCancel() { close(false); }
    function onBg(e) { if (e.target === overlay) close(false); }
    function onKey(e) {
      if (e.key === "Escape") { close(false); return; }
      if (e.key === 'Tab') trapFocus(overlay.querySelector('.modal-box'), e);
    }
    okBtn.addEventListener("click", onOk); cancelBtn.addEventListener("click", onCancel);
    overlay.addEventListener("click", onBg); document.addEventListener("keydown", onKey);
  });
}
