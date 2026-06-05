/* command-palette.js — Cmd+K command palette for global actions */

import { data, state, save } from './state.js';
import { $ } from './helpers.js';

let deps = {};
let activeIndex = 0;
let filteredItems = [];

export function configure(d) { deps = d; }

const SETTINGS_TABS = [
  { id: 'providers', icon: '🔗', label: '提供商设置' },
  { id: 'teams', icon: '👥', label: 'Teams 工作流' },
  { id: 'tasks', icon: 'WT', label: 'Agent Tasks' },
  { id: 'identities', icon: '🎭', label: '身份管理' },
  { id: 'skills', icon: '⚡', label: '技能管理' },
  { id: 'mcp', icon: '🔌', label: 'MCP 服务' },
  { id: 'plugins', icon: '🧩', label: '插件管理' },
  { id: 'runners', icon: '🏃', label: 'Runner 状态' },
  { id: 'usage', icon: '📊', label: '用量统计' },
  { id: 'diagnostics', icon: '🔍', label: '环境诊断' },
  { id: 'general', icon: '⚙️', label: '通用设置' },
];

function buildCommands() {
  const cmds = [];

  // Actions
  cmds.push({ group: '操作', items: [
    { icon: '💬', label: '新建对话', hint: 'Ctrl+N', action: () => deps.newChat?.() },
    { icon: '🔍', label: '搜索', hint: 'Ctrl+/', action: () => deps.openSearchPanel?.() },
    { icon: '📐', label: '切换侧边栏', hint: 'Ctrl+B', action: () => $('#sidebarToggle')?.click() },
    { icon: '📋', label: '切换右侧面板', hint: 'Ctrl+.', action: () => $('#contextToggle')?.click() },
    { icon: 'WIN', label: '打开新的本地工作区窗口', action: () => deps.openWorkspaceWindow?.() },
    { icon: '🌓', label: '切换主题', hint: 'Ctrl+Shift+T', action: () => deps.toggleTheme?.() },
    { icon: '📏', label: '切换密度', hint: 'Ctrl+Shift+D', action: () => deps.cycleDensity?.() },
    { icon: 'MD', label: '导出对话 Markdown', action: () => deps.exportConversation?.('md') },
    { icon: '{}', label: '导出对话 JSON', action: () => deps.exportConversation?.('json') },
    { icon: 'RP', label: '打开会话回放', action: () => deps.openReplayPanel?.() },
    { icon: 'SEC', label: '权限与沙箱安全中心', action: () => deps.openSettings?.('diagnostics') },
    { icon: '❓', label: '使用帮助', action: () => deps.openHelp?.() },
    { icon: '⌨️', label: '快捷键速查', action: () => deps.showShortcuts?.() },
  ]});

  // Settings
  cmds.push({ group: '设置', items: SETTINGS_TABS.map(t => ({
    icon: t.icon, label: t.label, action: () => deps.openSettings?.(t.id)
  }))});

  // Projects
  if (data.projects?.length) {
    cmds.push({ group: '项目', items: data.projects.slice(0, 10).map(p => ({
      icon: '📁', label: deps.compactPath?.(p.path) || p.path,
      action: () => deps.selectProject?.(p)
    }))});
  }

  if (data.agentTasks?.length) {
    const readyCount = data.agentTasks.filter(task => task.queueReady).length;
    const taskItems = [];
    taskItems.push({
      icon: 'RUN',
      label: `运行就绪 Agent Task 队列（${readyCount}）`,
      desc: '按依赖顺序依次运行可执行任务',
      action: () => {
        deps.openSettings?.('tasks');
        setTimeout(() => document.querySelector('#runQueueBtn')?.click(), 80);
      }
    });
    taskItems.push(...data.agentTasks.slice(0, 12).map(task => ({
      icon: task.status === 'committed' ? 'CM' : task.status === 'done' ? 'OK' : task.status === 'error' ? 'ERR' : task.worktreePath ? 'WT' : 'TK',
      label: task.title,
      desc: task.blockedBy?.length ? `阻塞：${task.blockedBy.map(item => item.title).join(', ')}` : (task.branch || task.cwd || task.prompt),
      action: () => deps.openSettings?.('tasks')
    })));
    cmds.push({ group: 'Agent Tasks', items: taskItems });
  }

  // Identities
  if (data.identities?.length) {
    cmds.push({ group: '切换身份', items: data.identities.map(id => ({
      icon: '🎭', label: id.name, desc: id.description,
      action: () => deps.switchIdentity?.(id.id)
    }))});
  }

  // Providers
  if (data.providers?.length) {
    cmds.push({ group: '切换提供商', items: data.providers.map(p => ({
      icon: '🔗', label: p.name,
      action: () => deps.switchProvider?.(p.id)
    }))});
  }

  return cmds;
}

function collectFiltered(term) {
  const groups = buildCommands();
  if (!term) return groups;
  const lower = term.toLowerCase();
  return groups.map(g => ({
    group: g.group,
    items: g.items.filter(i =>
      i.label.toLowerCase().includes(lower) ||
      (i.desc && i.desc.toLowerCase().includes(lower))
    )
  })).filter(g => g.items.length > 0);
}

function flatItems(groups) {
  const items = [];
  for (const g of groups) {
    for (const item of g.items) items.push(item);
  }
  return items;
}

function render(groups) {
  const body = $('#cmdPaletteResults');
  if (!body) return;
  body.innerHTML = '';
  filteredItems = flatItems(groups);

  if (!filteredItems.length) {
    body.innerHTML = '<div class="cmd-palette-empty">没有匹配的命令</div>';
    return;
  }

  let flatIdx = 0;
  for (const g of groups) {
    const groupEl = document.createElement('div');
    groupEl.className = 'cmd-palette-group';
    groupEl.textContent = g.group;
    body.appendChild(groupEl);

    for (const item of g.items) {
      const btn = document.createElement('button');
      btn.className = 'cmd-palette-item';
      btn.dataset.idx = flatIdx;
      if (flatIdx === activeIndex) btn.classList.add('is-active');
      btn.innerHTML = `<span class="cmd-palette-item-icon">${item.icon || ''}</span><span class="cmd-palette-item-label">${item.label}</span>${item.hint ? `<span class="cmd-palette-item-hint">${item.hint}</span>` : ''}`;
      btn.addEventListener('click', () => { execute(item); });
      btn.addEventListener('mouseenter', () => {
        activeIndex = parseInt(btn.dataset.idx);
        updateActive();
      });
      body.appendChild(btn);
      flatIdx++;
    }
  }
}

function updateActive() {
  const items = $('#cmdPaletteResults')?.querySelectorAll('.cmd-palette-item');
  if (!items) return;
  items.forEach((el, i) => el.classList.toggle('is-active', i === activeIndex));
  const active = items[activeIndex];
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function execute(item) {
  closeCommandPalette();
  item.action?.();
}

function onInput(e) {
  const term = e.target.value.trim();
  const groups = collectFiltered(term);
  activeIndex = 0;
  render(groups);
}

function onKeydown(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIndex = Math.min(activeIndex + 1, filteredItems.length - 1);
    updateActive();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex = Math.max(activeIndex - 1, 0);
    updateActive();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (filteredItems[activeIndex]) execute(filteredItems[activeIndex]);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeCommandPalette();
  }
}

export function openCommandPalette() {
  const overlay = $('#cmdPaletteOverlay');
  const input = $('#cmdPaletteInput');
  if (!overlay || !input) return;

  overlay.classList.add('is-open');
  input.value = '';
  activeIndex = 0;
  const groups = collectFiltered('');
  render(groups);

  setTimeout(() => input.focus(), 50);
}

export function closeCommandPalette() {
  const overlay = $('#cmdPaletteOverlay');
  if (overlay) overlay.classList.remove('is-open');
}

export function initCommandPalette() {
  const overlay = $('#cmdPaletteOverlay');
  const input = $('#cmdPaletteInput');
  if (!overlay || !input) return;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeCommandPalette();
  });

  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onKeydown);
}
