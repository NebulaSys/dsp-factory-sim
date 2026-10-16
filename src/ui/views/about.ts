/**
 * About view: data provenance, verification status and known limitations.
 * Everything shown here is derived from the shipped dataset, so it stays honest
 * when the data changes.
 */

import type { Store } from '../store.ts';
import { clear, el } from '../dom.ts';
import { ICON_KEYS } from '../icons.ts';
import { PROJECT } from '../project.ts';

export function initAboutView(store: Store): void {
  const data = store.state.data;
  const sourcesHost = document.getElementById('about-sources') as HTMLElement;
  const limitsHost = document.getElementById('about-limits') as HTMLElement;
  const metaHost = document.getElementById('dataset-meta') as HTMLElement;

  // Where the project lives, so the deployed app is not a dead end.
  const projectHost = document.getElementById('about-project');
  if (projectHost) {
    clear(projectHost);
    const links = el('ul', { class: 'about' });
    for (const [label, href] of [
      ['在线演示', PROJECT.demo],
      ['源码仓库', PROJECT.repo],
      ['问题反馈', PROJECT.issues],
    ] as const) {
      const li = el('li');
      li.append(el('a', { href, target: '_blank', rel: 'noreferrer', text: `${label} — ${href}` }));
      links.append(li);
    }
    projectHost.append(
      el('p', {
        text: '本模拟器是开源的非官方同人工具，欢迎提交问题与改进；蓝图格式与游戏数值的核对记录都在仓库文档里。',
      }),
      links,
    );
  }

  clear(sourcesHost);
  const sources = data.meta.sources ?? [];
  const list = el('ul', { class: 'about' });
  for (const url of sources.slice(0, 12)) {
    const li = el('li');
    const a = el('a', { href: url, target: '_blank', rel: 'noreferrer', text: url });
    li.append(a);
    list.append(li);
  }
  sourcesHost.append(
    el('p', {
      text: `数据集版本 ${data.meta.gameVersion}${data.meta.generatedAt ? `（生成于 ${data.meta.generatedAt}）` : ''}`,
    }),
    el('p', {
      text: `包含 ${data.items.length} 种物品、${data.buildings.length} 种建筑、${data.recipes.length} 条配方、${data.technologies.length} 项科技、${data.upgrades.length} 项可重复升级。`,
    }),
    list,
  );

  // Building icons are a separate asset with its own provenance.
  const iconHost = document.getElementById('about-icons');
  if (iconHost) {
    clear(iconHost);
    const mapped = data.buildings.filter((b) => ICON_KEYS.has(b.key)).length;
    iconHost.append(
      el('p', {
        text: `产线视图的建筑图标取自 dsp-wiki.com 的 Buildings 页面（共映射 ${mapped}/${data.buildings.length} 种建筑；其余建筑以彩色方块回退显示，并在控制台列出）。`,
      }),
      el('p', {
        text: '建筑占格（footprint）优先使用标定表：传送带/分拣器为实测 1×1（由 ground-truth 蓝图量得，相邻传送带正好相距 1 格），制造台等为已知 3×3；其余沿用游戏 prefab 的 selectSize 交互框，属于近似值。',
      }),
      el('p', {
        text: '图标版权归 Youthcat Studio 与 dsp-wiki.com 贡献者所有，本项目为非官方同人工具。',
      }),
    );
  }

  clear(limitsHost);
  const limits = [
    '蓝图视图是「简化重绘」：按真实坐标与分拣器连接布局建筑并计算速率，但不是逐格复刻游戏内的传送带模型。',
    '传送带上的物品级流动（堵带、混带、分拣器时序）未做逐帧模拟，速率按机器与带子吞吐上限核算。',
    '分馏塔（Fractionator）与轨道采集器等采集过程不是普通配方，按吞吐模型单独处理；相关的重氢产率需要按实际带速核算。',
    '矿脉数量、矿脉分布与行星风能/光照倍率由玩家设定，模拟器只能按你输入的条件换算。',
    '增产剂加成要求同一配方的所有原料都喷涂同一等级，取最低等级；本模拟器按全局设定统一施加。',
  ];
  for (const text of limits) limitsHost.append(el('li', { text }));

  const version = `数据集 v${data.meta.gameVersion} · ${data.items.length} 物品 / ${data.recipes.length} 配方`;
  metaHost.textContent = version;
  document.getElementById('footer-status')!.textContent = `引擎就绪 · ${version}`;
}
