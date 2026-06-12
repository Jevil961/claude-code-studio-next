/* tooltip.js — Custom tooltip system using [data-tip] attributes */

let tipEl = null;
let showTimer = null;
let hideTimer = null;
let currentTarget = null;

function closestTipTarget(target) {
  return target?.closest?.('[data-tip]') || null;
}

function createTipEl() {
  if (tipEl) return;
  tipEl = document.createElement('div');
  tipEl.className = 'tooltip-content';
  tipEl.setAttribute('role', 'tooltip');
  document.body.appendChild(tipEl);
}

function positionTip(target, pos) {
  const r = target.getBoundingClientRect();
  const gap = 6;
  tipEl.style.left = '0px';
  tipEl.style.top = '0px';
  tipEl.style.visibility = 'hidden';
  tipEl.classList.add('is-visible');
  const tw = tipEl.offsetWidth;
  const th = tipEl.offsetHeight;
  tipEl.classList.remove('is-visible');
  tipEl.style.visibility = '';

  let x, y;
  if (pos === 'bottom') {
    x = r.left + r.width / 2 - tw / 2;
    y = r.bottom + gap;
  } else if (pos === 'left') {
    x = r.left - tw - gap;
    y = r.top + r.height / 2 - th / 2;
  } else if (pos === 'right') {
    x = r.right + gap;
    y = r.top + r.height / 2 - th / 2;
  } else {
    // top (default)
    x = r.left + r.width / 2 - tw / 2;
    y = r.top - th - gap;
  }

  // Clamp to viewport
  x = Math.max(4, Math.min(x, window.innerWidth - tw - 4));
  y = Math.max(4, Math.min(y, window.innerHeight - th - 4));

  tipEl.style.left = `${x}px`;
  tipEl.style.top = `${y}px`;
}

function showTip(target) {
  if (!target?.isConnected || target.getAttribute('aria-hidden') === 'true') return;
  const style = window.getComputedStyle(target);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || style.pointerEvents === 'none') return;
  const text = target.getAttribute('data-tip');
  if (!text) return;
  createTipEl();
  tipEl.textContent = text;
  const pos = target.getAttribute('data-tip-pos') || 'top';
  positionTip(target, pos);
  tipEl.classList.add('is-visible');
  currentTarget = target;
}

function hideTip() {
  if (tipEl) tipEl.classList.remove('is-visible');
  currentTarget = null;
}

export function initTooltip() {
  document.addEventListener('mouseenter', (e) => {
    const target = closestTipTarget(e.target);
    if (!target) return;
    clearTimeout(hideTimer);
    showTimer = setTimeout(() => showTip(target), 300);
  }, true);

  document.addEventListener('mouseleave', (e) => {
    const target = closestTipTarget(e.target);
    if (!target) return;
    clearTimeout(showTimer);
    hideTimer = setTimeout(hideTip, 100);
  }, true);

  // Hide on scroll/resize
  document.addEventListener('scroll', hideTip, true);
  window.addEventListener('resize', hideTip);
}
