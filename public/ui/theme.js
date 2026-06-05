/* theme.js — Light/dark theme toggle and density system */

import { state, save } from './state.js';

export function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  state.theme = theme;
  save();
}

export function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  setTheme(next);
  return next;
}

export function setDensity(density) {
  document.documentElement.dataset.density = density;
  state.density = density;
  save();
}

export function cycleDensity() {
  const order = ['default', 'compact', 'spacious'];
  const cur = state.density || 'default';
  const next = order[(order.indexOf(cur) + 1) % order.length];
  setDensity(next);
  return next;
}

export function initTheme() {
  if (typeof document === 'undefined' || !document.documentElement) return;
  // Restore theme
  const prefersLight = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches;
  const theme = state.theme || (prefersLight ? 'light' : 'dark');
  document.documentElement.dataset.theme = theme;
  if (!state.theme) { state.theme = theme; save(); }

  // Restore density
  if (state.density === 'normal') {
    state.density = 'default';
    save();
  }
  if (state.density && state.density !== 'default') {
    document.documentElement.dataset.density = state.density;
  }
}
