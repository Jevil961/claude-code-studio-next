/* skeleton.js — Skeleton loading screens */

export function renderSkeleton(container, type, count = 3) {
  if (!container) return;
  container.innerHTML = '';
  const frag = document.createDocumentFragment();

  if (type === 'messages') {
    for (let i = 0; i < count; i++) {
      const row = document.createElement('div');
      row.className = 'skeleton-msg';
      row.innerHTML = `<div class="skeleton skeleton-avatar"></div><div class="skeleton-msg-body"><div class="skeleton skeleton-line w-80"></div><div class="skeleton skeleton-line w-60"></div>${i === 0 ? '<div class="skeleton skeleton-line w-40"></div>' : ''}</div>`;
      frag.appendChild(row);
    }
  } else if (type === 'list') {
    for (let i = 0; i < count; i++) {
      const row = document.createElement('div');
      row.className = 'skeleton-row';
      row.innerHTML = `<div class="skeleton skeleton-avatar"></div><div style="flex:1"><div class="skeleton skeleton-line w-80"></div><div class="skeleton skeleton-line w-40"></div></div>`;
      frag.appendChild(row);
    }
  } else if (type === 'settings') {
    for (let i = 0; i < count; i++) {
      const block = document.createElement('div');
      block.className = 'skeleton skeleton-block';
      block.style.height = `${60 + i * 20}px`;
      frag.appendChild(block);
    }
  } else if (type === 'detail') {
    const lines = ['w-80', 'w-full', 'w-60', 'w-full', 'w-40'];
    for (const w of lines) {
      const line = document.createElement('div');
      line.className = `skeleton skeleton-line ${w}`;
      frag.appendChild(line);
    }
  }

  container.appendChild(frag);
  return container;
}
