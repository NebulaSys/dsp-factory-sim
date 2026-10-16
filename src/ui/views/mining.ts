/**
 * Mining & logistics view: the per-vein mining rate with Veins Utilisation, and
 * belt/sorter throughput including the logistics research multipliers.
 */

import {
  beltThroughputPerMin,
  computeBonuses,
  computeMiningRate,
  computeVeinDepletion,
  resolveProliferator,
  sorterThroughputPerSec,
  veinTotalAmount,
} from '../../engine/rules.ts';
import type { Store } from '../store.ts';
import { clear, el, fmt, kw, stat, table } from '../dom.ts';

export function initMiningView(store: Store): void {
  const data = store.state.data;
  const levelInput = document.getElementById('mine-level') as HTMLInputElement;
  const levelOut = document.getElementById('mine-level-out') as HTMLOutputElement;
  const veinsInput = document.getElementById('mine-veins') as HTMLInputElement;
  const resourceSelect = document.getElementById('mine-resource') as HTMLSelectElement;
  const statsHost = document.getElementById('mine-stats') as HTMLElement;
  const beltHost = document.getElementById('belt-table') as HTMLElement;

  function render(): void {
    const level = Number(levelInput.value);
    levelOut.textContent = String(level);

    const veins = Math.max(1, Number(veinsInput.value) || 1);
    const resource = Number(resourceSelect.value) || 1;
    const bonuses = store.state.bonuses;

    // Mining machines can themselves be sprayed (speedup mode).
    const sprayed = resolveProliferator(data, { markKey: 'Proliferator3', mode: 'speedup' }, bonuses);
    const perVein = computeMiningRate({ coveredVeins: 1, baseRatePerVeinPerMin: 30, bonuses, resourceMultiplier: resource });
    const total = computeMiningRate({ coveredVeins: veins, baseRatePerVeinPerMin: 30, bonuses, resourceMultiplier: resource });
    const totalSprayed = computeMiningRate({
      coveredVeins: veins,
      baseRatePerVeinPerMin: 30,
      bonuses,
      resourceMultiplier: resource,
      proliferator: sprayed,
    });
    const depletion = computeVeinDepletion(total, level);
    const reserves = veinTotalAmount(100000, level);
    const lifetimeHours = depletion > 0 ? reserves / depletion / 60 : Infinity;

    clear(statsHost);
    statsHost.append(
      stat('单矿脉产出', `${fmt(perVein)} /min`),
      stat(`${veins} 矿脉合计`, `${fmt(total)} /min`),
      stat('矿机耗电', kw(data.building('MiningMachine')?.powerConsumptionKW ?? 420)),
      stat('矿脉消耗', `${fmt(depletion)} /min`, depletion > total ? 'warn' : 'ok'),
      stat('10 万储量可采', Number.isFinite(lifetimeHours) ? `${fmt(lifetimeHours, 1)} 小时` : '—'),
      stat('增产剂 Mk.III 加速', `${fmt(totalSprayed)} /min`),
    );

    // Belt / sorter table with logistics multipliers.
    const rows: (Node | string)[][] = [];
    for (const belt of data.belts) {
      const effective = beltThroughputPerMin(data, belt.key, bonuses);
      rows.push([
        belt.nameZh ?? belt.name,
        `${fmt(belt.speedPerMin)} /min`,
        `${fmt(effective)} /min`,
        bonuses.beltSpeedMultiplier !== 1 ? `×${fmt(bonuses.beltSpeedMultiplier, 3)}` : '—',
      ]);
    }
    const sorterRows: (Node | string)[][] = [];
    for (const sorter of data.sorters) {
      const effective = sorterThroughputPerSec(data, sorter.key, bonuses);
      sorterRows.push([
        sorter.nameZh ?? sorter.name,
        `${fmt(sorter.speedPerSec)} /s`,
        `${fmt(effective)} /s`,
        kw(sorter.powerConsumptionKW),
      ]);
    }

    clear(beltHost);
    const belts = table(
      [{ label: '传送带' }, { label: '基础速率', numeric: true }, { label: '当前速率', numeric: true }, { label: '加成', numeric: true }],
      rows,
    );
    const sorters = table(
      [{ label: '分拣器' }, { label: '基础速率', numeric: true }, { label: '当前速率', numeric: true }, { label: '耗电', numeric: true }],
      sorterRows,
    );
    beltHost.append(el('h3', { text: '传送带' }), wrapTable(belts), el('h3', { text: '分拣器' }), wrapTable(sorters));
  }

  function wrapTable(t: HTMLTableElement): HTMLElement {
    const wrap = el('div', { class: 'table-wrap' });
    wrap.append(t);
    return wrap;
  }

  levelInput.addEventListener('input', () => {
    // The slider drives the real Veins Utilisation level so every view agrees.
    const level = Number(levelInput.value);
    levelOut.textContent = String(level);
    if ((store.state.research.upgradeLevels.VeinUtilization ?? 0) === level) {
      render();
      return;
    }
    store.update((s) => {
      s.research.upgradeLevels.VeinUtilization = level;
    });
    // store.update() recomputes bonuses and re-renders subscribed views.
  });
  veinsInput.addEventListener('change', render);
  resourceSelect.addEventListener('change', render);
  store.subscribe(render);
  render();
}
