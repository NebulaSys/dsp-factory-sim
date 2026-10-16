/**
 * Tech view: the research tree with per-tech toggles, plus the repeatable
 * upgrade levels that feed straight into the engine's bonus aggregation.
 */

import type { Store } from '../store.ts';
import { clear, el } from '../dom.ts';

export function initTechView(store: Store): void {
  const data = store.state.data;
  const listHost = document.getElementById('tech-list') as HTMLElement;
  const filterInput = document.getElementById('tech-filter') as HTMLInputElement;

  function matches(techKey: string): boolean {
    const query = filterInput.value.trim().toLowerCase();
    if (!query) return true;
    const tech = data.tech(techKey);
    if (!tech) return false;
    const haystack = [
      tech.key,
      tech.name,
      tech.nameZh ?? '',
      ...(tech.unlocks?.recipes ?? []),
      ...(tech.unlocks?.buildings ?? []),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  }

  function render(): void {
    clear(listHost);
    const researched = store.state.research.technologies;
    const visible = data.technologies.filter((t) => matches(t.key)).sort((a, b) => a.key.localeCompare(b.key));

    if (visible.length === 0) {
      listHost.append(el('p', { class: 'hint', text: '没有匹配的科技。' }));
      return;
    }

    for (const tech of visible) {
      const isOn = researched.has(tech.key);
      const card = el('div', { class: `tech-card ${isOn ? 'researched' : ''}` });
      card.append(el('h4', { text: `${tech.nameZh ? `${tech.nameZh} · ` : ''}${tech.name}` }));

      const meta: string[] = [];
      if (tech.prerequisites.length > 0) meta.push(`前置：${tech.prerequisites.join(', ')}`);
      else meta.push('无前置');
      if (tech.cost?.items?.length) {
        meta.push(
          `成本：${tech.cost.items.map((c) => `${c.count}×${data.item(c.item)?.nameZh ?? c.item}`).join(' + ')}`,
        );
      }
      card.append(el('div', { class: 'meta', text: meta.join(' · ') }));

      const unlocks: string[] = [];
      if (tech.unlocks?.buildings?.length) unlocks.push(`建筑：${tech.unlocks.buildings.join(', ')}`);
      if (tech.unlocks?.recipes?.length) unlocks.push(`配方：${tech.unlocks.recipes.length} 项`);
      if (tech.effects?.length) {
        unlocks.push(
          `加成：${tech.effects
            .map((e) => `${e.kind}${e.value != null ? ` ${e.value > 0 ? '+' : ''}${Math.round(e.value * 100)}%` : ''}`)
            .join('、')}`,
        );
      }
      if (unlocks.length > 0) card.append(el('div', { class: 'unlocks', text: unlocks.join(' · ') }));

      card.addEventListener('click', () => {
        store.toggleTech(tech.key);
      });
      listHost.append(card);
    }
  }

  document.getElementById('tech-all')!.addEventListener('click', () => store.researchAll());
  document.getElementById('tech-none')!.addEventListener('click', () => store.clearResearch());
  filterInput.addEventListener('input', render);

  store.subscribe(render);
  render();
}
