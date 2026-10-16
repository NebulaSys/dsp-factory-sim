/**
 * Blueprint view: import/export blueprint strings and render a simplified,
 * drill-down-free layout of the decoded factory plus its real rates.
 */

import { decodeBlueprint, encodeBlueprint, looksLikeBlueprint, type BlueprintBody } from '../../engine/bp/codec.ts';
import { convertBlueprint } from '../../engine/factory.ts';
import type { FactoryNode, FactoryModel } from '../../engine/factory.ts';
import type { Store } from '../store.ts';
import { clear, el, fmt, itemCell, kw, stat, table } from '../dom.ts';
import {
  canvasBackingSize,
  clampZoom,
  DEFAULT_LAYER_SEPARATION,
  fitZoom,
  layerInfo,
  layerOffset,
  panForAnchoredZoom,
  renderFactory,
  ZOOM_MAX,
  ZOOM_MIN,
  type ViewTransform,
} from '../canvas.ts';
import { iconCoverage, onIconLoaded, preloadIcons } from '../icons.ts';
import {
  BLUEPRINT_REPOS,
  blueprintFiles,
  contentsApiUrl,
  describeGithubError,
  looksLikeBlueprintText,
  parseContents,
  parseRepoRef,
  subdirectories,
  type RepoRef,
} from '../github.ts';

const NODE_COLOURS: Record<string, string> = {
  producer: '#26a69a',
  research: '#ab47bc',
  belt: '#546e7a',
  sorter: '#8d6e63',
  logistics: '#5c6bc0',
  power: '#ffca28',
  storage: '#78909c',
  other: '#455a64',
};

/** A tiny but complete early-game line used by the "load sample" button. */
function sampleBlueprintBody(): BlueprintBody {
  const smelter = 2302;
  const assembler = 2303;
  const belt = 2001;
  const sorter = 2011;
  const buildings: BlueprintBody['buildings'] = [];
  let index = 0;
  const push = (itemId: number, x: number, y: number, recipeId: number, extra: Partial<BlueprintBody['buildings'][number]> = {}) => {
    buildings.push({
      index: index++,
      areaIndex: 0,
      x,
      y,
      z: 0,
      x2: 0,
      y2: 0,
      z2: 0,
      yaw: 0,
      yaw2: -1,
      itemId,
      recipeId,
      modelIndex: 0,
      outputObjectIndex: -1,
      inputObjectIndex: -1,
      outputToSlot: 0,
      inputFromSlot: 0,
      outputFromSlot: 0,
      inputToSlot: 0,
      outputOffset: 0,
      inputOffset: 0,
      filterId: 0,
      parameters: [],
      ...extra,
    });
    return index - 1;
  };

  // Two iron smelters feeding one gear assembler: 120 ingots/min -> 45 gears/min.
  const s1 = push(smelter, 0, 0, 1);
  const s2 = push(smelter, 4, 0, 1);
  const a1 = push(assembler, 9, 0, 12);
  // A short belt run and two sorters connecting them.
  push(belt, 0, 4, 0);
  push(belt, 4, 4, 0);
  push(belt, 9, 4, 0);
  push(sorter, 2, 2, 0, { outputObjectIndex: s1, inputObjectIndex: a1 });
  push(sorter, 6, 2, 0, { outputObjectIndex: s2, inputObjectIndex: a1 });
  return {
    header: { version: 1, cursorOffsetX: 0, cursorOffsetY: 0, cursorTargetArea: 0, dragboxSizeX: 20, dragboxSizeY: 20, primaryAreaIndex: 0, areaCount: 1 },
    areas: [{ index: 0, parentIndex: -1, tropicAnchor: 0, areaSegments: 5, anchorLocalOffsetX: 0, anchorLocalOffsetY: 0, width: 200, height: 200 }],
    buildings,
  };
}

export function initBlueprintView(store: Store): void {
  const input = document.getElementById('bp-input') as HTMLTextAreaElement;
  const output = document.getElementById('bp-output') as HTMLTextAreaElement;
  const status = document.getElementById('bp-status') as HTMLElement;
  const statsHost = document.getElementById('bp-stats') as HTMLElement;
  const canvas = document.getElementById('bp-canvas') as HTMLCanvasElement;
  const linesHost = document.getElementById('bp-lines') as HTMLElement;
  const balanceHost = document.getElementById('bp-balance') as HTMLElement;
  const markSelect = document.getElementById('bp-mark') as HTMLSelectElement;
  const modeSelect = document.getElementById('bp-mode') as HTMLSelectElement;
  const throughput = document.getElementById('bp-throughput') as HTMLInputElement;
  const throughputOut = document.getElementById('bp-throughput-out') as HTMLOutputElement;
  const zoomInput = document.getElementById('bp-zoom') as HTMLInputElement | null;
  const zoomOut = document.getElementById('bp-zoom-out') as HTMLOutputElement;
  const labelsInput = document.getElementById('bp-labels') as HTMLInputElement | null;
  const linksInput = document.getElementById('bp-links') as HTMLInputElement | null;
  const layersInput = document.getElementById('bp-layers') as HTMLInputElement | null;
  const hideBeltsInput = document.getElementById('bp-hide-belts') as HTMLInputElement | null;

  // Populate the proliferator dropdown from the dataset.
  markSelect.append(el('option', { value: '', text: '不使用' }));
  for (const mark of store.state.data.proliferatorMarks) {
    markSelect.append(el('option', { value: mark.key, text: mark.key.replace(/^Proliferator/, '增产剂 Mk.') }));
  }

  let lastBody: BlueprintBody | null = null;
  /** Tracks the model the pan was reset for, so a new blueprint starts centred. */
  let lastRenderedModel: FactoryModel | null = null;

  function setStatus(message: string, tone: 'ok' | 'err' | 'warn' | '' = ''): void {
    status.textContent = message;
    status.className = `status ${tone}`;
  }

  function analyse(): void {
    void (async () => {
      const text = input.value.trim();
      if (!text) {
        setStatus('请先粘贴蓝图串。', 'warn');
        return;
      }
      if (!looksLikeBlueprint(text)) {
        setStatus('无法识别：蓝图串应以 BLUEPRINT: 或 DYBP 开头。', 'err');
        return;
      }
      try {
        const decoded = await decodeBlueprint(text);
        lastBody = decoded.body;
        store.update((s) => {
          s.blueprintText = text;
          s.factory = convertBlueprint(store.state.data, decoded, {
            bonuses: s.bonuses,
            proliferator: s.proliferator,
            throughput: s.throughput,
          });
        });
        const model = store.state.factory!;
        const parts = [
          `格式 ${decoded.format}`,
          `建筑 ${model.totals.buildings}`,
          `产线 ${model.lines.length}`,
        ];
        if (decoded.hashWarning) {
          setStatus(`已解析，但校验哈希不匹配：${decoded.hashWarning}`, 'warn');
        } else {
          setStatus(`导入成功：${parts.join(' · ')}`, 'ok');
        }
        // Appended last: `store.update` above already triggered a render, and that render
        // must not be the thing that decides this text.
        appendStackingNote(model);
      } catch (err) {
        setStatus(`解析失败：${(err as Error).message}`, 'err');
      }
    })();
  }

  function render(): void {
    const model = store.state.factory;
    // A different blueprint starts centred, **and at its own fitting zoom**. The pan is a delta
    // from that view, so keeping the previous model's delta would drop the new layout off-screen;
    // and because the zoom is now an absolute size rather than a multiple of the fit, carrying it
    // over would open a big factory at whatever scale the last small one needed. All the paths
    // that set a factory (import, sample, real sample, clear, re-analysis) funnel through here.
    if (model !== lastRenderedModel) {
      pan = initialPan ?? { x: 0, y: 0 };
      initialPan = null;
      lastRenderedModel = model;
      canvas.style.cursor = model ? 'grab' : 'default';
      if (model) {
        const box = canvas.getBoundingClientRect();
        const width = box.width || canvas.width;
        const height = box.height || canvas.clientHeight;
        // `?zoom=` is an explicit request, so it wins over the fitting default. Assigned rather
        // than merely "not overwritten", because the URL parameter may be applied by `main.ts`
        // after a `?real=` blueprint has already started loading.
        zoom = initialZoom ?? fitZoom(model, width, height, layerOffset(model, layerSeparation()));
        initialZoom = null;
      }
    }
    clear(statsHost);
    clear(linesHost);
    clear(balanceHost);

    if (!model) {
      setStatus(input.value.trim() ? status.textContent : '尚未导入蓝图。点击「载入示例」可以直接看到一个完整例子。', '');
      drawScene(null);
      return;
    }

    const data = store.state.data;
    const buildingNames = new Map(model.nodes.map((n) => [n.index, n.buildingName]));

    statsHost.append(
      stat('建筑总数', String(model.totals.buildings)),
      stat('生产机器', String(model.totals.producers)),
      stat('传送带', String(model.totals.belts)),
      stat('分拣器', String(model.totals.sorters)),
      stat(
        '制造耗电',
        kw(model.totals.craftingPowerKW),
        '',
        '只统计制造产线（生产机器 × 配方耗电）。发电与用电建筑不计入。',
      ),
      stat(
        '发电/用电建筑',
        String(model.totals.powerBuildings),
        '',
        '太阳能板、射线接收站、火电等。本模拟器不核算它们的发电量或耗电。',
      ),
      stat('未知原型', String(model.unknown.length), model.unknown.length > 0 ? 'warn' : 'ok'),
    );

    linesHost.append(
      table(
        [
          { label: '配方' },
          { label: '机器' },
          { label: '台数', numeric: true },
          { label: '单台/min', numeric: true },
          { label: '总产出/min', numeric: true },
          { label: '电力', numeric: true },
          { label: '增产剂', numeric: true },
        ],
        model.lines.map((line) => {
          const recipe = data.recipe(line.recipeKey);
          const main = line.rate.outputsPerMin
            .map((o) => `${fmt(o.count)} ${data.item(o.item)?.nameZh ?? o.item}`)
            .join(' + ');
          return [
            el('span', { text: `${line.recipeName} ` }, [el('span', { class: 'badge', text: recipe?.facility ?? '' })]),
            line.buildingKey ?? '—',
            String(line.machines),
            fmt(line.rate.craftsPerMinPerMachine),
            main,
            kw(line.rate.totalPowerKW),
            line.rate.proliferator.mode === 'none' ? '—' : `${line.rate.proliferator.markKey} / ${line.rate.proliferator.mode}`,
          ];
        }),
      ),
    );

    balanceHost.append(
      table(
        [
          { label: '物品' },
          { label: '产出/min', numeric: true },
          { label: '消耗/min', numeric: true },
          { label: '净额/min', numeric: true },
        ],
        model.totals.balance.map((row) => {
          const item = data.item(row.item);
          const net = row.producedPerMin - row.consumedPerMin;
          const netCell = el('span', { text: fmt(net) });
          if (net < -1e-6) netCell.style.color = 'var(--bad)';
          else if (net > 1e-6) netCell.style.color = 'var(--ok)';
          return [itemCell(item?.name ?? row.item, item?.nameZh, item?.category ?? 'other'), fmt(row.producedPerMin), fmt(row.consumedPerMin), netCell];
        }),
      ),
    );

    drawScene(model);

    if (model.totals.warnings.length > 0) {
      setStatus(`${status.textContent ?? ''} · ${model.totals.warnings.length} 条警告`, 'warn');
    }
  }

  /**
   * Describes vertical stacking, which is a property of the loaded blueprint rather than
   * of a frame, so it is appended once when the blueprint is analysed instead of on every
   * render (a re-render would otherwise duplicate it).
   *
   * Many real blueprints are vertical stacks ("堆叠蓝图"): thousands of buildings share an
   * (x, y) footprint at different heights. A plain top-down view would draw them on top of
   * each other, so this says so rather than letting the picture imply otherwise.
   */
  function appendStackingNote(model: FactoryModel): void {
    const layers = layerInfo(model);
    if (layers.layers <= 1 || layers.stacked === 0) return;
    const share = Math.round((layers.stacked / Math.max(1, model.nodes.length)) * 100);
    setStatus(
      `${status.textContent ?? ''} · 垂直堆叠蓝图：${layers.layers} 层，约 ${share}% 的建筑与其他层共用同一 (x,y) 平面` +
        `（高度 ${fmt(layers.minZ)} → ${fmt(layers.maxZ)}）；视图已按层错开，取消勾选「分离堆叠层」可看真实俯视重合。`,
      '',
    );
  }

  // ---- wiring -------------------------------------------------------------

  document.getElementById('bp-load')!.addEventListener('click', analyse);
  document.getElementById('bp-sample')!.addEventListener('click', () => {
    input.value = '(示例蓝图)';
    const sample = sampleBlueprintBody();
    lastBody = sample;
    store.update((s) => {
      s.factory = convertBlueprint(
        store.state.data,
        {
          format: 'text',
          meta: { timestampTicks: 0, gameVersion: store.state.data.meta.gameVersion, shortDesc: '示例：铁矿→齿轮', longDesc: '', icon: { layout: 10, images: [0, 0, 0, 0, 0] } },
          body: sample,
        },
        { bonuses: s.bonuses, proliferator: s.proliferator, throughput: s.throughput },
      );
    });
    setStatus('已载入示例蓝图：2 台电弧熔炉 → 1 台制造台 Mk.I（齿轮）。', 'ok');
  });
  // Real game blueprints bundled under /samples. These are the cached exports that the
  // body-version-1 decoder was cracked against, so loading one here is the end-to-end
  // proof that a real player blueprint reaches the simulator.
  const loadReal = async (name: string, note: string): Promise<void> => {
    setStatus('正在载入真实蓝图…', '');
    try {
      // Rebased: GitHub Pages serves a project site from /<repo>/, so a leading slash would
      // miss. BASE_URL always ends in '/'.
      const res = await fetch(`${import.meta.env.BASE_URL}samples/${name}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = (await res.text()).trim();
      input.value = text;
      await analyse();
      setStatus(`已载入真实游戏蓝图（${note}）。`, 'ok');
    } catch (err) {
      setStatus(`真实蓝图载入失败：${(err as Error).message}`, 'err');
    }
  };

  const realHost = document.getElementById('bp-real');
  if (realHost) {
    void (async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}samples/manifest.json`);
        if (!res.ok) return;
        const manifest = (await res.json()) as { name: string; file: string; note: string }[];
        for (const entry of manifest) {
          const label = entry.name.includes('solar') ? '载入真实蓝图：太阳能农场' : '载入真实蓝图：带分拣器产线';
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = label;
          button.title = `${entry.note}\n来自 ${entry.file}`;
          button.dataset.sample = entry.name;
          button.addEventListener('click', () => void loadReal(entry.name, entry.note));
          realHost.append(button);
        }
        // `?real=<name>` loads a bundled sample directly, which makes the real-blueprint
        // path shareable as a link and checkable by the screenshot tooling.
        const wanted = new URLSearchParams(globalThis.location?.search ?? '').get('real');
        if (wanted) {
          const entry = manifest.find((m) => m.name === wanted || m.name.startsWith(wanted));
          if (entry) await loadReal(entry.name, entry.note);
          else setStatus(`找不到真实蓝图样本「${wanted}」。可用：${manifest.map((m) => m.name).join('、')}`, 'warn');
        }
      } catch (err) {
        setStatus(`真实蓝图样本清单载入失败：${(err as Error).message}`, 'err');
      }
    })();
  }

  // ---- GitHub --------------------------------------------------------------

  const repoInput = document.getElementById('bp-gh-repo') as HTMLInputElement | null;
  // Both hosts are in the shipped markup; the `??` keeps the view usable if the block is ever
  // removed from the page rather than throwing on a null during init.
  const navHost = document.getElementById('bp-gh-nav') ?? el('div');
  const filesHost = document.getElementById('bp-gh-files') ?? el('div');
  const ghSeparator = document.getElementById('bp-gh-sep');

  /**
   * Load one file from the repository.
   *
   * The content is checked before it reaches the decoder: a collection's `.txt` files are not
   * all blueprints, and "this file is not a blueprint" is a far better message than a decode
   * failure from inside the parser.
   */
  const loadFromGithub = async (url: string, label: string): Promise<void> => {
    setStatus(`正在下载 ${label}…`, '');
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = (await res.text()).trim();
      if (!looksLikeBlueprintText(text)) {
        setStatus(`${label} 不是蓝图文件：内容不以 BLUEPRINT: 或 DYBP 开头。`, 'warn');
        return;
      }
      input.value = text;
      await analyse();
      setStatus(`已从 GitHub 载入 ${label}（${Math.round(text.length / 1024)} KB）。`, 'ok');
    } catch (err) {
      setStatus(`GitHub 下载失败：${(err as Error).message}`, 'err');
    }
  };

  /** List a directory: sub-folders become navigable, blueprint files become selectable. */
  const listGithub = async (ref: RepoRef | null): Promise<void> => {
    clear(navHost);
    clear(filesHost);
    // The divider only means something once there is a listing below it; showing it against an
    // empty result would just be a stray line.
    if (ghSeparator) ghSeparator.hidden = true;
    if (!ref) {
      setStatus('请填入类似 owner/repo 的仓库，或一个 GitHub 仓库/文件夹链接。', 'warn');
      return;
    }
    setStatus(`正在读取 ${ref.owner}/${ref.repo}${ref.path ? `/${ref.path}` : ''}…`, '');
    try {
      const res = await fetch(contentsApiUrl(ref), { headers: { Accept: 'application/vnd.github+json' } });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setStatus(
          describeGithubError(res.status, body, res.headers.get('x-ratelimit-reset')),
          'err',
        );
        return;
      }
      const entries = parseContents(body);
      const dirs = subdirectories(entries);
      const files = blueprintFiles(entries, ref);

      // Breadcrumb back up to the repository root, so a deep folder is not a dead end.
      if (ref.path) {
        const up = ref.path.split('/').slice(0, -1).join('/');
        const upButton = el('button', { text: '↑ 上一级' }) as HTMLButtonElement;
        upButton.type = 'button';
        upButton.addEventListener('click', () => void listGithub({ ...ref, path: up }));
        navHost.append(upButton);
      }
      for (const dir of dirs) {
        const button = el('button', { text: `📁 ${dir.name}` }) as HTMLButtonElement;
        button.type = 'button';
        button.addEventListener('click', () => void listGithub({ ...ref, path: dir.path }));
        navHost.append(button);
      }
      for (const file of files) {
        const kb = file.size > 0 ? ` (${Math.round(file.size / 1024)} KB)` : '';
        const button = el('button', { text: `${file.name}${kb}` }) as HTMLButtonElement;
        button.type = 'button';
        button.title = `${file.path}\n${file.rawUrl}`;
        button.addEventListener('click', () => void loadFromGithub(file.rawUrl, file.name));
        filesHost.append(button);
      }

      if (files.length === 0 && dirs.length === 0) {
        setStatus('这个目录里既没有子文件夹，也没有 .txt / .dybp 文件。', 'warn');
      } else {
        // Only now is there something for the divider to separate from the shortcuts.
        if (ghSeparator) ghSeparator.hidden = false;
        setStatus(
          `找到 ${files.length} 个蓝图文件${dirs.length > 0 ? `、${dirs.length} 个子文件夹` : ''}。` +
            (files.length === 0 ? '可以进入子文件夹继续找。' : '点击文件名即可载入。'),
          'ok',
        );
      }
    } catch (err) {
      setStatus(`无法访问 GitHub：${(err as Error).message}（可能是网络或跨域被拦截）。`, 'err');
    }
  };

  const listFromInput = (): void => void listGithub(parseRepoRef(repoInput?.value ?? ''));
  document.getElementById('bp-gh-list')?.addEventListener('click', listFromInput);
  repoInput?.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Enter') listFromInput();
  });

  // One-click entry points. The repository is put in the field as well as listed, so the user
  // can see what is being browsed and edit it from there.
  const presetsHost = document.getElementById('bp-gh-presets');
  if (presetsHost) {
    for (const preset of BLUEPRINT_REPOS) {
      const button = el('button', { text: preset.label }) as HTMLButtonElement;
      button.type = 'button';
      button.title = `${preset.note}\n${preset.repo}`;
      button.addEventListener('click', () => {
        if (repoInput) repoInput.value = preset.repo;
        void listGithub(parseRepoRef(preset.repo));
      });
      presetsHost.append(button);
    }
  }
  // `?repo=` makes a repository shareable as a link, matching `?real=` for bundled samples.
  {
    const wanted = new URLSearchParams(globalThis.location?.search ?? '').get('repo');
    if (wanted && repoInput) {
      repoInput.value = wanted;
      void listGithub(parseRepoRef(wanted));
    }
  }

  document.getElementById('bp-clear')!.addEventListener('click', () => {    input.value = '';
    output.value = '';
    lastBody = null;
    store.update((s) => {
      s.factory = null;
      s.blueprintText = null;
    });
    setStatus('已清空。', '');
  });

  document.getElementById('bp-export-text')!.addEventListener('click', () => {
    void (async () => {
      if (!lastBody) {
        setStatus('没有可导出的蓝图：请先导入或载入示例。', 'warn');
        return;
      }
      output.value = await encodeBlueprint(lastBody, {
        meta: { shortDesc: 'DSP 模拟器导出', longDesc: 'generated by dsp-factory-sim', gameVersion: store.state.data.meta.gameVersion },
      });
      setStatus('已生成 BLUEPRINT 文本串（含 MD5F 校验）。', 'ok');
    })();
  });

  document.getElementById('bp-export-binary')!.addEventListener('click', () => {
    void (async () => {
      if (!lastBody) {
        setStatus('没有可导出的蓝图：请先导入或载入示例。', 'warn');
        return;
      }
      output.value = await encodeBlueprint(lastBody, { format: 'binary' });
      setStatus('已生成 DYBP 容器串。', 'ok');
    })();
  });

  document.getElementById('bp-copy')!.addEventListener('click', () => {
    void (async () => {
      if (!output.value) return;
      try {
        await navigator.clipboard.writeText(output.value);
        setStatus('已复制到剪贴板。', 'ok');
      } catch {
        output.select();
        setStatus('无法访问剪贴板，已为你选中文本。', 'warn');
      }
    })();
  });

  markSelect.addEventListener('change', () => {
    store.update((s) => {
      s.proliferator.markKey = markSelect.value || null;
    });
    reanalyse();
  });
  modeSelect.addEventListener('change', () => {
    store.update((s) => {
      s.proliferator.mode = modeSelect.value as typeof s.proliferator.mode;
      if (s.proliferator.mode !== 'none' && !s.proliferator.markKey) {
        s.proliferator.markKey = store.state.data.proliferatorMarks[2]?.key ?? null;
        markSelect.value = s.proliferator.markKey ?? '';
      }
    });
    reanalyse();
  });
  throughput.addEventListener('input', () => {
    const value = Number(throughput.value) / 100;
    throughputOut.textContent = `${throughput.value}%`;
    store.update((s) => {
      s.throughput = value;
    });
    reanalyse();
  });

  function reanalyse(): void {
    const text = (store.state.blueprintText ?? input.value).trim();
    if (!text || text === '(示例蓝图)') {
      // Re-run the sample path when the sample is loaded.
      if (lastBody && input.value === '(示例蓝图)') {
        store.update((s) => {
          s.factory = convertBlueprint(
            store.state.data,
            {
              format: 'text',
              meta: { timestampTicks: 0, gameVersion: store.state.data.meta.gameVersion, shortDesc: '示例', longDesc: '', icon: { layout: 10, images: [0, 0, 0, 0, 0] } },
              body: lastBody!,
            },
            { bonuses: s.bonuses, proliferator: s.proliferator, throughput: s.throughput },
          );
        });
      }
      return;
    }
    analyse();
  }


  // ---- canvas plumbing ----------------------------------------------------

  let view: ViewTransform = { scale: 1, offsetX: 0, offsetY: 0 };
  /**
   * 100% is the *fitted* view: the whole layout scaled to the canvas.
   *
   * The starting zoom and the reset target are the same constant on purpose. Reading the
   * starting value from the slider instead would let the two drift apart — changing the
   * slider's markup default would then make "reset" jump somewhere the user never chose.
   */
  const FIT_ZOOM = 1;
  let zoom = FIT_ZOOM;
  const showLabels = () => labelsInput?.checked !== false;
  const showLinks = () => linksInput?.checked !== false;
  /** Per-layer diagonal offset: zero when the user turns the exploded view off. */
  const layerSeparation = (): number => (layersInput?.checked === false ? 0 : DEFAULT_LAYER_SEPARATION);
  /**
   * The CSS size the last frame was drawn at.
   *
   * Wheel zoom needs the same box the renderer measured, not a fresh measurement taken while
   * the canvas is mid-layout; re-measuring there is what the sizing bug was made of.
   */
  const lastCssSize = { width: 0, height: 0 };

  /**
   * Drag-to-pan state, in screen pixels relative to the fitted view.
   *
   * The pan is a delta on top of the fit (see `RenderOptions.panX`), so it stays where the
   * user put it across redraws — toggling labels or layers does not snap the view back —
   * while a *new* blueprint starts centred, because that is what `resetView` does when a model
   * is loaded.
   */
  let pan = { x: 0, y: 0 };
  /**
   * Pan requested by `?pan=x,y`, applied to the first blueprint that loads.
   *
   * The other view settings are already link parameters (`?real=`, `?zoom=`), so panning one
   * too keeps a shared link showing the same picture. It is consumed rather than re-applied,
   * so loading a second blueprint still starts centred.
   */
  let initialPan: { x: number; y: number } | null = null;
  {
    // `location` is a browser global and is absent when this module is exercised outside a
    // browser document (the jsdom smoke test imports the app into a bare Node context), so
    // the read is guarded instead of assuming the global exists.
    const raw = new URLSearchParams(globalThis.location?.search ?? '').get('pan');
    const parts = (raw ?? '').split(',').map(Number);
    const px = parts[0];
    const py = parts[1];
    if (raw && px !== undefined && py !== undefined && Number.isFinite(px) && Number.isFinite(py)) {
      initialPan = { x: px, y: py };
    }
  }

  /**
   * Zoom requested by `?zoom=`, which takes precedence over the fitting default.
   *
   * Read here rather than relying on the slider, because the URL parameters are applied in
   * `main.ts` and a blueprint named by `?real=` may load before that runs. Consumed on first
   * use, so a second blueprint still opens fitted.
   */
  let initialZoom: number | null = null;
  {
    const raw = Number(new URLSearchParams(globalThis.location?.search ?? '').get('zoom'));
    if (Number.isFinite(raw) && raw > 0) initialZoom = clampZoom(raw / 100);
  }
  let drag: { pointerId: number; startX: number; startY: number; panX: number; panY: number } | null = null;
  /** Set once a drag actually moves, so a plain click can still be treated as a click. */
  let dragged = false;

  /**
   * Size the canvas to its CSS box at device pixel ratio and draw. Redrawing on
   * resize keeps the layout fitted when the window changes.
   */
  function drawScene(model: FactoryModel | null): void {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // The canvas box is owned by CSS (a flexible child of the column), and only the
    // backing store is synced to it here.
    //
    // This deliberately does **not** write `style.height`. Sizing used to read `clientHeight`
    // (the content box, which excludes the canvas's 1px border) and write it back as an inline
    // height (the border box under `box-sizing: border-box`), so every draw shrank the canvas by
    // 2px — a ratchet that drag-to-pan exposed by redrawing on every pointermove. Leaving the
    // height to CSS removes the feedback loop instead of carefully balancing it.
    const { cssWidth, cssHeight, pixelWidth, pixelHeight } = canvasBackingSize(
      { width: rect.width || canvas.width, height: rect.height || canvas.clientHeight },
      dpr,
    );
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    lastCssSize.width = cssWidth;
    lastCssSize.height = cssHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    view = renderFactory(ctx, model, cssWidth, cssHeight, {
      zoom,
      labels: showLabels(),
      links: showLinks(),
      layerSeparation: layerSeparation(),
      hideBelts: hideBeltsInput?.checked === true,
      panX: pan.x,
      panY: pan.y,
    });
    // The readout is synced here rather than only at each place that changes the zoom: the
    // loading path now picks a fitting zoom of its own, and without this the slider kept
    // claiming the starting 100% while the drawing was already at, say, 29%.
    syncZoomControl();
  }

  /**
   * Restore the fitted view: recentre **and** reset the zoom.
   *
   * Both are view state layered on top of the fit, and this is what a user reaches for when the
   * drawing has become unusable. Resetting only the pan would half-solve that — after wheel
   * zooming to 400% the button would appear to do nothing, because the drawing is still off the
   * screen while the pan is already at zero.
   */
  function resetView(): void {
    if (pan.x === 0 && pan.y === 0 && zoom === FIT_ZOOM) return;
    pan = { x: 0, y: 0 };
    zoom = FIT_ZOOM;
    syncZoomControl();
    drawScene(store.state.factory);
  }

  // ---- drag to pan --------------------------------------------------------

  // Pointer events cover mouse, touch and pen with one code path, and `setPointerCapture`
  // keeps the drag alive when the cursor leaves the canvas mid-gesture.
  canvas.addEventListener('pointerdown', (event: PointerEvent) => {
    if (!store.state.factory) return;
    // Left button / primary touch only, so a right-click or a middle-click is not swallowed.
    if (event.button !== 0) return;
    drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, panX: pan.x, panY: pan.y };
    dragged = false;
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = 'grabbing';
  });

  canvas.addEventListener('pointermove', (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    // A few pixels of slop keeps a shaky click from registering as a pan.
    if (!dragged && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    dragged = true;
    pan = { x: drag.panX + dx, y: drag.panY + dy };
    drawScene(store.state.factory);
  });

  const endDrag = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    drag = null;
    canvas.style.cursor = store.state.factory ? 'grab' : 'default';
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', (event: PointerEvent) => {
    // Only end on leave when the pointer was not captured; a captured drag continues.
    if (drag && !canvas.hasPointerCapture(event.pointerId)) endDrag(event);
  });

  // Double-click recentres, which is the usual way back from a lost layout.
  canvas.addEventListener('dblclick', resetView);

  document.getElementById('bp-pan-reset')?.addEventListener('click', resetView);
  if (store.state.factory) canvas.style.cursor = 'grab';

  // A wheel notch is a fixed *ratio* of zoom, so the gesture feels the same at 50% and 400%.
  const WHEEL_ZOOM_SENSITIVITY = 0.0015;

  /**
   * Normalise a wheel delta to pixels.
   *
   * `deltaMode` reports whether the delta is in pixels, lines or pages; without this a
   * line-mode mouse would zoom about 16x too fast.
   */
  function wheelPixels(event: WheelEvent): number {
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
    return event.deltaY * unit;
  }

  /** Keep the slider and its label showing the zoom the view is actually at. */
  function syncZoomControl(): void {
    if (!zoomInput) return;
    const percent = Math.round(zoom * 100);
    zoomInput.value = String(percent);
    zoomOut.textContent = `${percent}%`;
  }

  canvas.addEventListener(
    'wheel',
    (event: WheelEvent) => {
      const model = store.state.factory;
      if (!model) return;
      event.preventDefault();

      // Shift+wheel stays a horizontal pan so the two gestures do not fight over the wheel.
      if (event.shiftKey) {
        pan = { x: pan.x - wheelPixels(event), y: pan.y };
        drawScene(model);
        return;
      }

      const delta = wheelPixels(event);
      if (delta === 0) return;
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY)));
      // Already at a limit: leave the view alone rather than nudging the pan for nothing.
      if (next === zoom) return;

      // Anchor on the cursor, measured against the canvas box in the same CSS pixels the
      // renderer was given.
      const rect = canvas.getBoundingClientRect();
      const anchorX = event.clientX - rect.left;
      const anchorY = event.clientY - rect.top;
      pan = panForAnchoredZoom(
        model,
        lastCssSize.width || rect.width,
        lastCssSize.height || rect.height,
        { zoom, panX: pan.x, panY: pan.y, layerSeparation: layerSeparation() },
        anchorX,
        anchorY,
        next,
      );
      zoom = next;
      syncZoomControl();
      drawScene(model);
    },
    { passive: false },
  );

  zoomInput?.addEventListener('input', () => {
    zoom = Number(zoomInput.value) / 100;
    zoomOut.textContent = `${zoomInput.value}%`;
    drawScene(store.state.factory);
  });
  labelsInput?.addEventListener('change', () => drawScene(store.state.factory));
  linksInput?.addEventListener('change', () => drawScene(store.state.factory));
  layersInput?.addEventListener('change', () => drawScene(store.state.factory));
  hideBeltsInput?.addEventListener('change', () => drawScene(store.state.factory));

  // Icons decode asynchronously; repaint once they are available.
  onIconLoaded(() => drawScene(store.state.factory));
  preloadIcons();

  // Resizing the window must re-fit the drawing.
  const onResize = (): void => drawScene(store.state.factory);
  window.addEventListener('resize', onResize);

  // The canvas is a flexible child of the column, so its box also changes without any window
  // resize — filling the tables above it shortens it, and those tables only get their rows after
  // a blueprint is analysed. A window listener alone would leave the backing store describing
  // the previous box, showing a stretched drawing until something else triggered a redraw.
  // There is no feedback loop: the canvas height comes from the flex distribution, not from the
  // `height` attribute that `drawScene` writes.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => drawScene(store.state.factory)).observe(canvas);
  }

  // Report icon coverage so a missing asset is visible rather than silent.
  const coverage = iconCoverage(store.state.data.buildings);
  if (coverage.missing.length > 0) {
    console.info(`building icons: ${coverage.withIcon}/${coverage.total} mapped; no icon for ${coverage.missing.join(', ')}`);
  }

  store.subscribe(render);
  render();
}
