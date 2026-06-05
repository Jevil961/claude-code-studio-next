/* slash-commands.js — Slash commands in the composer input */

import { state, save, data } from './state.js';
import { $ } from './helpers.js';

let deps = {};
let popupEl = null;
let activeIndex = 0;
let filteredItems = [];
let isVisible = false;

export function configure(d) { deps = d; }

const COMMANDS = [
  { cmd: '/clear', desc: '清空当前对话', action: () => deps.newChat?.() },
  { cmd: '/plan', desc: '切换到 Plan 模式', action: () => deps.setPerm?.('plan') },
  { cmd: '/auto', desc: '切换到 Auto 模式', action: () => deps.setPerm?.('auto') },
  { cmd: '/bypass', desc: '跳过所有确认', action: () => deps.setPerm?.('bypass') },
  { cmd: '/export', desc: '导出当前对话 Markdown', action: () => deps.exportConversation?.('md') },
  { cmd: '/export-json', desc: '导出当前对话 JSON 审计', action: () => deps.exportConversation?.('json') },
  { cmd: '/replay', desc: '打开会话回放', action: () => deps.openReplayPanel?.() },
  { cmd: '/window', desc: '打开新的本地工作区窗口', action: () => deps.openWorkspaceWindow?.() },
  { cmd: '/plugin', desc: '打开插件管理；也可输入 /plugin name@marketplace 安装', action: () => deps.openSettings?.('plugins') },
  { cmd: '/security', desc: '打开权限与沙箱安全中心', action: () => deps.openSettings?.('diagnostics') },
  { cmd: '/usage', desc: '查看用量统计', action: () => deps.openSettings?.('usage') },
  { cmd: '/diag', desc: '打开环境诊断', action: () => deps.openSettings?.('diagnostics') },
  { cmd: '/help', desc: '使用帮助', action: () => deps.openHelp?.() },
  { cmd: '/theme', desc: '切换亮/暗主题', action: () => deps.toggleTheme?.() },
];

function getTemplateCommands() {
  const templates = state.promptTemplates || [];
  return templates.map(t => ({
    cmd: `/${t.name}`,
    desc: t.body.slice(0, 60) + (t.body.length > 60 ? '...' : ''),
    action: () => insertTemplate(t.body),
    isTemplate: true,
  }));
}

function insertTemplate(body) {
  const input = $('#promptInput');
  if (!input) return;
  const val = input.value;
  const slashIdx = val.lastIndexOf('/');
  input.value = val.slice(0, slashIdx) + body;
  input.focus();
  deps.autosize?.();
}

function getAllCommands() {
  return [...COMMANDS, ...getTemplateCommands()];
}

function collectFiltered(term) {
  const all = getAllCommands();
  if (!term) return all;
  const lower = term.toLowerCase();
  return all.filter(c => c.cmd.toLowerCase().includes(lower) || c.desc.toLowerCase().includes(lower));
}

function createPopup() {
  if (popupEl) return;
  popupEl = document.createElement('div');
  popupEl.className = 'slash-popup';
  popupEl.setAttribute('role', 'listbox');
  document.body.appendChild(popupEl);
}

function positionPopup() {
  const input = $('#promptInput');
  if (!input || !popupEl) return;
  const r = input.getBoundingClientRect();
  popupEl.style.left = `${r.left}px`;
  popupEl.style.bottom = `${window.innerHeight - r.top + 4}px`;
  popupEl.style.maxWidth = `${r.width}px`;
}

function render(items) {
  if (!popupEl) return;
  popupEl.innerHTML = '';
  filteredItems = items;

  if (!items.length) { hideSlashPopup(); return; }

  items.forEach((item, i) => {
    const btn = document.createElement('button');
    btn.className = 'slash-item';
    btn.dataset.idx = i;
    if (i === activeIndex) btn.classList.add('is-active');
    btn.setAttribute('role', 'option');
    btn.innerHTML = `<span class="slash-item-cmd">${item.cmd}</span><span class="slash-item-desc">${item.desc}</span>`;
    btn.addEventListener('click', () => execute(item));
    btn.addEventListener('mouseenter', () => {
      activeIndex = i;
      updateActive();
    });
    popupEl.appendChild(btn);
  });
}

function updateActive() {
  if (!popupEl) return;
  const items = popupEl.querySelectorAll('.slash-item');
  items.forEach((el, i) => el.classList.toggle('is-active', i === activeIndex));
  const active = items[activeIndex];
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function execute(item) {
  hideSlashPopup();
  const input = $('#promptInput');
  if (!input) return;

  // Clear the slash text from input
  const val = input.value;
  const slashIdx = val.lastIndexOf('/');
  if (slashIdx >= 0) {
    input.value = val.slice(0, slashIdx);
  }

  item.action?.();
}

export function showSlashPopup(term) {
  createPopup();
  const search = term.startsWith('/') ? term : '/' + term;
  const items = collectFiltered(search);
  if (!items.length) { hideSlashPopup(); return; }

  activeIndex = 0;
  positionPopup();
  render(items);
  popupEl.classList.add('is-open');
  isVisible = true;
}

export function hideSlashPopup() {
  if (popupEl) popupEl.classList.remove('is-open');
  isVisible = false;
  activeIndex = 0;
}

export function isSlashVisible() { return isVisible; }

export function handleSlashKeydown(e) {
  if (!isVisible) return false;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIndex = Math.min(activeIndex + 1, filteredItems.length - 1);
    updateActive();
    return true;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex = Math.max(activeIndex - 1, 0);
    updateActive();
    return true;
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    if (filteredItems[activeIndex]) {
      e.preventDefault();
      execute(filteredItems[activeIndex]);
      return true;
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    hideSlashPopup();
    return true;
  }
  return false;
}

export function checkSlashTrigger(inputEl) {
  const val = inputEl.value;
  // Check if we're typing a slash command
  const match = val.match(/(?:^|\s)(\/\w*)$/);
  if (match) {
    showSlashPopup(match[1]);
  } else {
    hideSlashPopup();
  }
}

export function initSlashCommands() {
  // Hide on document click
  document.addEventListener('click', (e) => {
    if (isVisible && !popupEl?.contains(e.target)) {
      hideSlashPopup();
    }
  });
}
