/**
 * Small shared utilities for the UI: number formatting and DOM helpers.
 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) node.append(child);
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Compact number formatting: 1 decimal below 100, none above. */
export function fmt(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toFixed(0);
  if (abs >= 100) return value.toFixed(1);
  if (abs >= 1) return trimZeros(value.toFixed(digits));
  return trimZeros(value.toFixed(Math.min(6, digits + 2)));
}

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

export function pct(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function kw(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} GW`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(2)} MW`;
  return `${value.toFixed(0)} kW`;
}

/** Item category → CSS badge class. */
export function badgeClass(category: string): string {
  switch (category) {
    case 'raw':
      return 'badge raw';
    case 'intermediate':
      return 'badge mid';
    case 'component':
      return 'badge comp';
    case 'matrix':
      return 'badge matrix';
    case 'building':
      return 'badge building';
    case 'proliferator':
      return 'badge proliferator';
    case 'fuel':
      return 'badge fuel';
    case 'ammo':
      return 'badge ammo';
    default:
      return 'badge';
  }
}

export const CATEGORY_LABEL: Record<string, string> = {
  raw: '原料',
  intermediate: '中间体',
  component: '组件',
  matrix: '矩阵',
  building: '建筑',
  proliferator: '增产剂',
  fuel: '燃料',
  ammo: '弹药',
  other: '其他',
};

/** Build a table from a header row and body rows. */
export function table(
  headers: { label: string; numeric?: boolean }[],
  rows: (Node | string)[][],
  emptyMessage = '（无数据）',
): HTMLTableElement {
  const t = el('table');
  const thead = el('thead');
  const hr = el('tr');
  for (const h of headers) {
    const th = el('th', { text: h.label });
    if (h.numeric) th.className = 'num';
    hr.append(th);
  }
  thead.append(hr);
  t.append(thead);

  const tbody = el('tbody');
  if (rows.length === 0) {
    const tr = el('tr');
    const td = el('td', { text: emptyMessage });
    td.colSpan = Math.max(1, headers.length);
    tr.append(td);
    tbody.append(tr);
  } else {
    for (const row of rows) {
      const tr = el('tr');
      row.forEach((cell, i) => {
        if (cell instanceof Node) {
          const td = el('td');
          td.append(cell);
          if (headers[i]?.numeric) td.className = 'num';
          tr.append(td);
        } else {
          const td = el('td', { text: cell });
          if (headers[i]?.numeric) td.className = 'num';
          tr.append(td);
        }
      });
      tbody.append(tr);
    }
  }
  t.append(tbody);
  return t;
}

/**
 * One figure in a stat strip.
 *
 * `hint` exists because some totals are easy to read as something they are not. "电力消耗 0 kW"
 * on a blueprint of 576 ray receivers is arithmetically right and completely misleading — the
 * number only covers crafting lines. A stat whose scope is not obvious should say so on the card
 * rather than rely on a tooltip nobody hovers.
 */
export function stat(label: string, value: string, tone: '' | 'ok' | 'warn' | 'bad' = '', hint?: string): HTMLElement {
  return el('div', { class: `stat ${tone}`, title: hint ?? '' }, [
    el('div', { class: 'k', text: label }),
    el('div', { class: 'v', text: value }),
    ...(hint ? [el('div', { class: 'hint', text: hint })] : []),
  ]);
}

export function itemCell(name: string, nameZh: string | undefined, category: string): HTMLElement {
  const wrap = el('span');
  const badge = el('span', { class: badgeClass(category), text: CATEGORY_LABEL[category] ?? category });
  wrap.append(badge, document.createTextNode(` ${nameZh ? `${nameZh} ` : ''}${name}`));
  return wrap;
}
