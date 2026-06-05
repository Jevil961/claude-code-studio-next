/* data-transfer.js — Workspace import/export */

import { state, save, data } from './state.js';
import { safeBridge } from './bridge.js';
import { toast } from './helpers.js';

export async function exportWorkspace() {
  const exportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    state: { ...state },
    providers: data.providers || [],
    identities: data.identities || [],
    teams: data.teams || [],
    mcp: data.mcp || [],
    promptTemplates: state.promptTemplates || [],
  };

  const json = JSON.stringify(exportData, null, 2);
  const r = await safeBridge('saveFileDialog', null, 'ccs-workspace-backup.json', json);
  if (r && r.data) {
    toast('工作空间已导出', 'ok');
  } else if (r !== null) {
    // Fallback: download as file
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ccs-workspace-backup.json';
    a.click();
    URL.revokeObjectURL(url);
    toast('工作空间已导出', 'ok');
  }
}

export async function importWorkspace() {
  const r = await safeBridge('openFileDialog', null, ['json']);
  if (!r || !r.data) return;

  let parsed;
  try {
    const content = typeof r.data === 'string' ? r.data : r.data.content;
    parsed = JSON.parse(content);
  } catch {
    toast('无效的备份文件', 'error');
    return;
  }

  if (!parsed.version) {
    toast('备份文件格式不正确', 'error');
    return;
  }

  // Merge providers (don't overwrite existing)
  if (parsed.providers?.length) {
    const existingNames = new Set((data.providers || []).map(p => p.name));
    for (const p of parsed.providers) {
      if (!existingNames.has(p.name)) {
        await safeBridge('createProvider', null, p);
      }
    }
  }

  // Merge identities
  if (parsed.identities?.length) {
    const existingNames = new Set((data.identities || []).map(i => i.name));
    for (const id of parsed.identities) {
      if (!existingNames.has(id.name)) {
        await safeBridge('saveIdentity', null, id);
      }
    }
  }

  // Merge teams
  if (parsed.teams?.length) {
    const existingNames = new Set((data.teams || []).map(t => t.name));
    for (const t of parsed.teams) {
      if (!existingNames.has(t.name)) {
        await safeBridge('saveTeam', null, t);
      }
    }
  }

  // Import prompt templates
  if (parsed.promptTemplates?.length) {
    state.promptTemplates = [...(state.promptTemplates || []), ...parsed.promptTemplates];
  }

  // Import non-sensitive state fields
  if (parsed.state) {
    if (parsed.state.keybindings) state.keybindings = parsed.state.keybindings;
    if (parsed.state.theme) state.theme = parsed.state.theme;
    if (parsed.state.density) state.density = parsed.state.density;
  }

  save();
  toast('工作空间已导入，部分数据需要刷新后生效', 'ok');
}
