import { data, state } from "../state.js";
import { fmtNum, basename } from "../helpers.js";
import { escapeHtml } from "../../markdown.js";

// Official Anthropic pricing per MTok (as of 2026) — https://www.anthropic.com/pricing
export const OFFICIAL_PRICES = {
  "claude-opus-4-7":  { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.50 },
  "claude-opus-4-6":  { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.50 },
  "claude-opus-4-5":  { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.50 },
  "claude-opus-4":    { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.50 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
  "claude-sonnet-4-5": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
  "claude-sonnet-4":   { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
  "claude-haiku-4-5":  { input: 0.80, output: 4, cacheWrite: 1.00, cacheRead: 0.08 },
  "claude-haiku-4":    { input: 0.80, output: 4, cacheWrite: 1.00, cacheRead: 0.08 },
  "claude-3.5-sonnet": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
  "claude-3.5-haiku":  { input: 0.80, output: 4, cacheWrite: 1.00, cacheRead: 0.08 },
  "claude-3-opus":     { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.50 },
  default:             { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
};

export function findPrice(model) {
  const key = (model || "").toLowerCase();
  // Custom price table first, then official, then default
  if (state.priceTable[key]) return { ...OFFICIAL_PRICES.default, ...state.priceTable[key] };
  for (const [k, v] of Object.entries(OFFICIAL_PRICES)) {
    if (key.includes(k)) return v;
  }
  return OFFICIAL_PRICES.default;
}

export function estimateCost(item) {
  const p = findPrice(item.model);
  const inputCost = Number(item.inputTokens || 0) / 1e6 * p.input;
  const outputCost = Number(item.outputTokens || 0) / 1e6 * p.output;
  const cacheWriteCost = Number(item.cacheCreationTokens || 0) / 1e6 * p.cacheWrite;
  const cacheReadCost = Number(item.cacheReadTokens || 0) / 1e6 * p.cacheRead;
  return { input: inputCost, output: outputCost, cacheWrite: cacheWriteCost, cacheRead: cacheReadCost, total: inputCost + outputCost + cacheWriteCost + cacheReadCost };
}

export async function renderUsageSettings(deps) {
  const { settingsBody, loadUsage } = deps;
  settingsBody.innerHTML = `<div class="loading-msg" style="padding:20px;text-align:center;color:var(--td-text-color-disabled);">加载用量数据...</div>`;
  await loadUsage();

  const u = data.usage;
  if (!u || !u.totals || !u.totals.totalTokens) {
    settingsBody.innerHTML = `<div class="scard"><div class="scard-title">暂无用量数据</div><div class="slist-sub">使用 Claude Code 进行对话后，会自动统计 token 用量。数据来源于 ~/.claude/projects/ 下的对话记录。</div></div>`;
    return;
  }

  settingsBody.innerHTML = "";
  const t = u.totals || {};

  const cc = Number(t.cacheCreationTokens || 0);
  const cr = Number(t.cacheReadTokens || 0);
  const cacheTotal = cc + cr;
  const cacheHitRate = cacheTotal > 0 ? (cr / cacheTotal * 100).toFixed(1) : "0.0";

  var summary = document.createElement("div");
  summary.className = "scard";
  summary.innerHTML = '<div class="scard-head"><span class="scard-title">总计</span></div><div style="font-size:28px;font-weight:700;padding:4px 0;">' + fmtNum(t.totalTokens) + ' <span style="font-size:13px;font-weight:400;color:var(--td-text-color-disabled);">tokens</span></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">' +
    '<div class="slist-item" style="flex-direction:column;align-items:flex-start;gap:2px;"><div class="slist-sub">输入</div><div class="slist-name">' + fmtNum(t.inputTokens) + '</div></div>' +
    '<div class="slist-item" style="flex-direction:column;align-items:flex-start;gap:2px;"><div class="slist-sub">输出</div><div class="slist-name">' + fmtNum(t.outputTokens) + '</div></div>' +
    '<div class="slist-item" style="flex-direction:column;align-items:flex-start;gap:2px;"><div class="slist-sub">缓存写入</div><div class="slist-name">' + fmtNum(cc) + '</div></div>' +
    '<div class="slist-item" style="flex-direction:column;align-items:flex-start;gap:2px;"><div class="slist-sub">缓存读取</div><div class="slist-name">' + fmtNum(cr) + '</div></div>' +
    '</div>' +
    '<div style="margin-top:10px;padding:8px 12px;border-radius:6px;background:var(--td-bg-color-page);">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;"><span class="slist-sub">缓存命中率</span><span style="font-weight:700;color:' + (Number(cacheHitRate) > 30 ? 'var(--td-success-color)' : 'var(--td-warning-color)') + ';">' + cacheHitRate + '%</span></div>' +
    '</div>';
  settingsBody.append(summary);

  if ((u.byModel || []).length) {
    var mt = document.createElement("div");
    mt.style.cssText = "font-size:12px;font-weight:600;padding:12px 0 6px;";
    mt.textContent = "按模型";
    settingsBody.append(mt);
    for (var i = 0; i < (u.byModel || []).slice(0, 10).length; i++) {
      var m = (u.byModel || []).slice(0, 10)[i];
      var card = document.createElement("div");
      card.className = "slist-item";
      card.innerHTML = '<div class="slist-body"><div class="slist-name">' + escapeHtml(m.model) + '</div><div class="slist-sub">' + fmtNum(m.requests) + ' 请求 / 入 ' + fmtNum(m.inputTokens) + ' / 出 ' + fmtNum(m.outputTokens) + ' / 缓存写 ' + fmtNum(m.cacheCreationTokens || 0) + ' / 缓存读 ' + fmtNum(m.cacheReadTokens || 0) + '</div></div><div class="slist-badge">' + fmtNum(m.totalTokens) + '</div>';
      settingsBody.append(card);
    }
  }

  if ((u.byProject || []).length) {
    var pt = document.createElement("div");
    pt.style.cssText = "font-size:12px;font-weight:600;padding:12px 0 6px;";
    pt.textContent = "按项目";
    settingsBody.append(pt);
    for (var j = 0; j < (u.byProject || []).slice(0, 10).length; j++) {
      var p = (u.byProject || []).slice(0, 10)[j];
      var card = document.createElement("div");
      card.className = "slist-item";
      var nm = p.path ? basename(p.path) : (p.name || p.id);
      card.innerHTML = '<div class="slist-body"><div class="slist-name">' + escapeHtml(nm) + '</div><div class="slist-sub">' + fmtNum(p.requests) + ' 请求 / ' + fmtNum(p.totalTokens) + ' tokens</div></div><div class="slist-badge">' + fmtNum(p.totalTokens) + '</div>';
      settingsBody.append(card);
    }
  }
}
