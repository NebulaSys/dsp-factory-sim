/**
 * Planner view: pick a target item and rate, get the whole production chain with
 * machine counts, raw materials, power and a shopping list.
 */

import { buildPlan, powerReport, type PlanNode, type PlanResult } from '../../engine/planner.ts';
import type { Store } from '../store.ts';
import { clear, el, fmt, itemCell, kw, stat, table } from '../dom.ts';

export function initPlannerView(store: Store): void {
  const data = store.state.data;
  const targetSelect = document.getElementById('plan-target') as HTMLSelectElement;
  const rateInput = document.getElementById('plan-rate') as HTMLInputElement;
  const markSelect = document.getElementById('plan-mark') as HTMLSelectElement;
  const modeSelect = document.getElementById('plan-mode') as HTMLSelectElement;
  const alternatesCheck = document.getElementById('plan-alternates') as HTMLInputElement;
  const runButton = document.getElementById('plan-run') as HTMLButtonElement;
  const statsHost = document.getElementById('plan-stats') as HTMLElement;
  const treeHost = document.getElementById('plan-tree') as HTMLElement;
  const buildingsHost = document.getElementById('plan-buildings') as HTMLElement;
  const rawHost = document.getElementById('plan-raw') as HTMLElement;
  const upgradesHost = document.getElementById('plan-upgrades') as HTMLElement;

  // ---- target dropdown: craftable items only, grouped by category ----------
  const craftable = data.items.filter((item) => data.recipesProducing(item.key).length > 0);
  const byCategory = new Map<string, typeof craftable>();
  for (const item of craftable) {
    const list = byCategory.get(item.category) ?? [];
    list.push(item);
    byCategory.set(item.category, list);
  }
  const CATEGORY_ORDER = ['matrix', 'component', 'intermediate', 'building', 'fuel', 'ammo', 'proliferator', 'other'];
  const CATEGORY_NAME: Record<string, string> = {
    matrix: '矩阵',
    component: '组件',
    intermediate: '中间体',
    building: '建筑',
    fuel: '燃料',
    ammo: '弹药',
    proliferator: '增产剂',
    other: '其他',
  };
  for (const category of CATEGORY_ORDER) {
    const items = byCategory.get(category);
    if (!items?.length) continue;
    const group = el('optgroup', { label: CATEGORY_NAME[category] ?? category });
    for (const item of items.sort((a, b) => (a.nameZh ?? a.name).localeCompare(b.nameZh ?? b.name))) {
      group.append(el('option', { value: item.key, text: `${item.nameZh ?? item.name} (${item.name})` }));
    }
    targetSelect.append(group);
  }
  targetSelect.value = 'ElectromagneticMatrix';

  markSelect.append(el('option', { value: '', text: '不使用' }));
  for (const mark of data.proliferatorMarks) {
    markSelect.append(el('option', { value: mark.key, text: mark.key.replace(/^Proliferator/, '增产剂 Mk.') }));
  }

  // ---- upgrade sliders ----------------------------------------------------
  function renderUpgrades(): void {
    clear(upgradesHost);
    for (const upgrade of data.upgrades) {
      const level = store.state.research.upgradeLevels[upgrade.key] ?? 0;
      const wrap = el('div', { class: 'upgrade' });
      const label = el('div', { class: 'label' }, [
        el('span', { text: `${upgrade.nameZh ?? upgrade.name}` }),
        el('span', { class: 'lvl', text: String(level) }),
      ]);
      const slider = el('input', {
        type: 'range',
        min: '0',
        max: String(Math.min(upgrade.maxLevel, 100)),
        value: String(level),
      }) as HTMLInputElement;
      slider.addEventListener('input', () => {
        label.lastElementChild!.textContent = slider.value;
        store.update((s) => {
          s.research.upgradeLevels[upgrade.key] = Number(slider.value);
        });
        rerun();
      });
      wrap.append(label, slider);
      if (upgrade.curve) wrap.append(el('div', { class: 'meta', text: upgrade.curve }));
      upgradesHost.append(wrap);
    }
  }

  // ---- run ----------------------------------------------------------------
  function rerun(): void {
    const target = targetSelect.value;
    const perMin = Number(rateInput.value);
    if (!target || !(perMin > 0)) return;
    const plan = buildPlan(data, {
      target,
      targetPerMin: perMin,
      allowAlternates: alternatesCheck.checked,
      proliferator: store.state.planProliferator,
      bonuses: store.state.bonuses,
    });
    store.update((s) => {
      s.plan = plan;
    });
  }

  function render(): void {
    const plan = store.state.plan;
    clear(statsHost);
    clear(treeHost);
    clear(buildingsHost);
    clear(rawHost);

    if (!plan) {
      treeHost.append(el('p', { class: 'hint', text: '选择目标物品与速率，然后点击「生成生产链」。' }));
      return;
    }

    const generators = [
      { buildingKey: 'WindTurbine', outputKW: 300, count: 0 },
      { buildingKey: 'ThermalPowerPlant', outputKW: 2160, count: 0 },
      { buildingKey: 'MiniFusionPowerPlant', outputKW: 9000, count: 0 },
      { buildingKey: 'ArtificialStar', outputKW: 72000, count: 0 },
    ];
    const power = powerReport(plan.totalPowerKW, generators);

    statsHost.append(
      stat('目标', `${fmt(plan.targetPerMin)} ${data.item(plan.target)?.nameZh ?? plan.target}/min`),
      stat('机器总数', String(plan.totalMachines)),
      stat('总耗电', kw(plan.totalPowerKW)),
      stat('原料种类', String(plan.rawResources.length)),
      stat(
        '风电需求',
        `${power.generatorsNeeded.find((g) => g.buildingKey === 'WindTurbine')?.count ?? 0} 台`,
        'warn',
      ),
      stat('增产剂消耗', plan.spraysPerMin > 0 ? `${fmt(plan.spraysPerMin)} 次/min` : '—'),
    );

    // Tree
    treeHost.append(renderNode(plan.root, true));
    if (plan.warnings.length > 0) {
      const warnBox = el('div', { class: 'status warn' });
      warnBox.append(el('div', { text: `⚠ ${plan.warnings.length} 条提示：` }));
      const list = el('ul');
      for (const w of [...new Set(plan.warnings)].slice(0, 8)) list.append(el('li', { text: w }));
      warnBox.append(list);
      treeHost.append(warnBox);
    }

    // Shopping list
    buildingsHost.append(
      table(
        [{ label: '建筑' }, { label: '数量', numeric: true }, { label: '单台电力', numeric: true }, { label: '合计电力', numeric: true }],
        plan.buildingList.map((row) => {
          const building = data.building(row.buildingKey);
          const per = building?.powerConsumptionKW ?? 0;
          return [building?.nameZh ?? row.buildingKey, String(row.count), kw(per), kw(per * row.count)];
        }),
      ),
    );

    // Raw materials
    rawHost.append(
      table(
        [{ label: '原料' }, { label: '每分钟', numeric: true }, { label: '每秒', numeric: true }, { label: '所需矿脉数(矿机)', numeric: true }],
        plan.rawResources.map((row) => {
          const item = data.item(row.item);
          const veins = item?.isRaw && !item.isFluid ? Math.ceil(row.perMin / (30 * store.state.bonuses.miningSpeedMultiplier) - 1e-9) : 0;
          return [itemCell(item?.name ?? row.item, item?.nameZh, item?.category ?? 'other'), fmt(row.perMin), fmt(row.perMin / 60, 3), veins > 0 ? String(veins) : '—'];
        }),
      ),
    );
  }

  function renderNode(node: PlanNode, isRoot: boolean): HTMLElement {
    const wrap = el('div', { class: `tree-node ${node.kind}` });
    const row = el('div', { class: 'tree-row' });
    const item = data.item(node.item);
    row.append(el('span', { class: 'tree-item', text: `${item?.nameZh ?? node.item} (${node.item})` }));
    row.append(el('span', { class: 'tree-meta' }, [document.createTextNode('需要 '), el('b', { text: fmt(node.requiredPerMin) }), document.createTextNode('/min')]));

    if (node.kind === 'recipe' && node.recipeKey) {
      row.append(
        el('span', {
          class: 'tree-meta',
          text: `配方 ${node.recipeKey} · ${node.buildingKey ?? '—'} × ${node.machinesCeil ?? 0} 台（${fmt(node.machines ?? 0, 3)} 台等效）`,
        }),
      );
      if (node.craftsPerMin) row.append(el('span', { class: 'tree-meta' }, [document.createTextNode('工序 '), el('b', { text: fmt(node.craftsPerMin) }), document.createTextNode('/min')]));
      if (node.powerKW) row.append(el('span', { class: 'tree-meta' }, [document.createTextNode('电力 '), el('b', { text: kw(node.powerKW) })]));
      if (node.suppliedPerMin != null && node.suppliedPerMin > node.requiredPerMin + 1e-6) {
        row.append(el('span', { class: 'tree-meta', text: `产能 ${fmt(node.suppliedPerMin)}/min（余量 ${fmt(node.suppliedPerMin - node.requiredPerMin)}）` }));
      }
      if (node.byproducts?.length) {
        row.append(
          el('span', {
            class: 'tree-meta',
            text: `副产物 ${node.byproducts.map((b) => `${fmt(b.count)} ${data.item(b.item)?.nameZh ?? b.item}`).join('、')}`,
          }),
        );
      }
    } else if (node.kind === 'cycle') {
      row.append(el('span', { class: 'tree-meta', text: node.note ?? '循环依赖，按外部输入处理' }));
    } else {
      row.append(el('span', { class: 'tree-meta', text: '原料 / 外部输入' }));
    }
    wrap.append(row);
    for (const child of node.children) wrap.append(renderNode(child, false));
    return wrap;
  }

  // ---- wiring -------------------------------------------------------------
  runButton.addEventListener('click', rerun);
  targetSelect.addEventListener('change', rerun);
  rateInput.addEventListener('change', rerun);
  alternatesCheck.addEventListener('change', rerun);
  markSelect.addEventListener('change', () => {
    store.update((s) => {
      s.planProliferator.markKey = markSelect.value || null;
    });
    rerun();
  });
  modeSelect.addEventListener('change', () => {
    store.update((s) => {
      s.planProliferator.mode = modeSelect.value as typeof s.planProliferator.mode;
    });
    rerun();
  });

  store.subscribe(render);
  renderUpgrades();
  // Render upgrade sliders again whenever research changes (level caps etc).
  store.subscribe(() => {
    for (const upgrade of data.upgrades) {
      const level = store.state.research.upgradeLevels[upgrade.key] ?? 0;
      const wrap = upgradesHost.children[[...data.upgrades].indexOf(upgrade)];
      const lvl = wrap?.querySelector('.lvl');
      if (lvl) lvl.textContent = String(level);
    }
  });
  rerun();
}
