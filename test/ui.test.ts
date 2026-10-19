/**
 * UI smoke test: boots the real app against a jsdom document with the real
 * index.html markup and the real dataset, then exercises the user-visible flows.
 *
 * This is the closest thing to "it actually works in a browser" that runs in CI:
 * it catches missing element ids, thrown render errors, and wiring mistakes that
 * a type check cannot see.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { PROJECT } from '../src/ui/project.ts';

const ROOT = resolve(import.meta.dirname, '..');

/** Boot a fresh app instance and return the window plus captured errors. */
async function bootApp(): Promise<{ window: JSDOM['window']; errors: string[] }> {
  const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
  const errors: string[] = [];

  // jsdom lacks these; the app touches them through the codec and clipboard.
  const { TextEncoder, TextDecoder } = await import('node:util');
  dom.window.TextEncoder = TextEncoder as unknown as typeof dom.window.TextEncoder;
  dom.window.TextDecoder = TextDecoder as unknown as typeof dom.window.TextDecoder;
  Object.assign(dom.window, {
    CompressionStream: (globalThis as { CompressionStream?: unknown }).CompressionStream,
    DecompressionStream: (globalThis as { DecompressionStream?: unknown }).DecompressionStream,
  });

  // Node 24 exposes `window`/`navigator` as getter-only globals, so plain
  // assignment throws. Redefine the properties instead.
  const g = globalThis as unknown as Record<string, unknown>;
  const define = (name: string, value: unknown): void => {
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  };
  define('window', dom.window);
  define('document', dom.window.document);
  define('navigator', dom.window.navigator);
  define('HTMLElement', dom.window.HTMLElement);
  define('Node', dom.window.Node);
  define('Event', dom.window.Event);
  define('CustomEvent', dom.window.CustomEvent);
  // jsdom exposes these on the window, but the icon loader uses the bare global
  // names (as a browser would), so mirror them onto globalThis.
  define('Image', dom.window.Image);
  define('CompressionStream', (dom.window as unknown as Record<string, unknown>).CompressionStream);
  define('DecompressionStream', (dom.window as unknown as Record<string, unknown>).DecompressionStream);
  define('TextEncoder', TextEncoder);
  define('TextDecoder', TextDecoder);
  expect(g.document).toBe(dom.window.document);
  dom.window.addEventListener('error', (e: ErrorEvent) => errors.push(String(e.message)));
  dom.window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => errors.push(String(e.reason)));

  // Re-execute the entry point per test so module-level state does not leak.
  // `vi.resetModules()` plus a static specifier is required: a computed import
  // path cannot be resolved by the test transformer.
  vi.resetModules();
  const mod = await import('../src/ui/main.ts');
  expect(mod).toBeTruthy();
  return { window: dom.window, errors };
}

function q<T extends Element = HTMLElement>(window: JSDOM['window'], selector: string): T {
  const found = window.document.querySelector<T>(selector);
  if (!found) throw new Error(`missing element ${selector}`);
  return found;
}

function click(window: JSDOM['window'], selector: string): void {
  q(window, selector).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

describe('web UI smoke test', () => {
  let window: JSDOM['window'];
  let errors: string[];

  beforeEach(async () => {
    const booted = await bootApp();
    window = booted.window;
    errors = booted.errors;
  });

  it('boots without throwing and reports the dataset in the header/footer', () => {
    const meta = q(window, '#dataset-meta').textContent ?? '';
    expect(meta).toMatch(/数据集 v0\.10\.35/);
    expect(meta).toMatch(/物品 \/ \d+ 配方/);
    const footer = q(window, '#footer-status').textContent ?? '';
    expect(footer).toContain('引擎就绪');
    expect(errors).toEqual([]);
  });

  it('has all five tabs and switches panels', () => {
    const tabs = [...window.document.querySelectorAll('.tab')];
    expect(tabs.map((t) => (t as HTMLElement).dataset.tab)).toEqual(['blueprint', 'planner', 'tech', 'mining', 'about']);

    click(window, '.tab[data-tab="planner"]');
    expect(q(window, '#panel-planner').classList.contains('active')).toBe(true);
    expect(q(window, '#panel-blueprint').classList.contains('active')).toBe(false);

    click(window, '.tab[data-tab="tech"]');
    expect(q(window, '#panel-tech').classList.contains('active')).toBe(true);
  });

  it('renders the tech tree from the real dataset', () => {
    click(window, '.tab[data-tab="tech"]');
    const cards = window.document.querySelectorAll('.tech-card');
    expect(cards.length).toBeGreaterThan(50);
    // Toggle one and confirm the store reacted.
    const first = cards[0] as HTMLElement;
    first.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const researched = window.document.querySelectorAll('.tech-card.researched');
    expect(researched.length).toBe(1);
  });

  it('plans a production chain and fills the tables', () => {
    click(window, '.tab[data-tab="planner"]');
    click(window, '#plan-run');

    const stats = q(window, '#plan-stats').textContent ?? '';
    expect(stats).toContain('机器总数');
    expect(stats).toContain('总耗电');

    // The tree should contain the recipe chain.
    const tree = q(window, '#plan-tree').textContent ?? '';
    expect(tree).toContain('电磁矩阵');
    expect(tree).toContain('磁线圈');

    // Shopping list and raw materials tables get rows.
    const buildings = window.document.querySelectorAll('#plan-buildings tbody tr');
    expect(buildings.length).toBeGreaterThan(1);
    const raw = window.document.querySelectorAll('#plan-raw tbody tr');
    expect(raw.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  it('loads the sample blueprint, draws the canvas and lists lines', () => {
    click(window, '#bp-sample');
    const status = q(window, '#bp-status').textContent ?? '';
    expect(status).toContain('示例蓝图');

    const stats = q(window, '#bp-stats').textContent ?? '';
    expect(stats).toContain('建筑总数');
    expect(stats).toContain('分拣器');
    // The power figure only counts crafting lines, so its label must not read as a blueprint's
    // total draw — a solar farm legitimately shows 0 kW and that must not look like "no power".
    expect(stats).toContain('制造耗电');
    expect(stats).toContain('发电/用电建筑');
    expect(stats).not.toContain('电力消耗');
    // Geometric sorter diagnostics: a defect count, and how many machines have a sorter on them.
    expect(stats).toContain('悬空分拣器');
    expect(stats).toContain('分拣器接入机器');

    const rows = window.document.querySelectorAll('#bp-lines tbody tr');
    expect(rows.length).toBeGreaterThanOrEqual(2); // IronIngot + Gear

    const balance = q(window, '#bp-balance').textContent ?? '';
    expect(balance).toContain('铁块');
    expect(errors).toEqual([]);
  });

  it('links to the project from the topbar and the About view', () => {
    // The topbar href is in index.html so it works before the module loads, while the About view
    // renders from src/ui/project.ts. This is what stops the two copies from drifting apart.
    const topbar = window.document.getElementById('repo-link') as HTMLAnchorElement | null;
    expect(topbar, 'no #repo-link in the markup').toBeTruthy();
    expect(topbar!.getAttribute('href')).toBe(PROJECT.repo);
    expect(topbar!.getAttribute('target')).toBe('_blank');

    const about = q(window, '#about-project').textContent ?? '';
    expect(about).toContain(PROJECT.repo);
    expect(about).toContain(PROJECT.demo);
    expect(about).toContain(PROJECT.issues);

    // A relative or placeholder href would silently 404 once deployed under a subpath.
    for (const url of [PROJECT.repo, PROJECT.demo, PROJECT.issues]) {
      expect(url.startsWith('https://')).toBe(true);
    }
  });

  it('draws the factory onto the canvas (rendering path exercised)', () => {
    // jsdom has no 2D context, so install a recording stub covering the full API
    // the renderer uses (transforms, image drawing, dashed strokes, text).
    const calls: string[] = [];
    const drawnImages: unknown[] = [];
    const stub = {
      calls,
      canvas: null as unknown,
      clearRect: () => calls.push('clearRect'),
      beginPath: () => calls.push('beginPath'),
      moveTo: () => calls.push('moveTo'),
      lineTo: () => calls.push('lineTo'),
      quadraticCurveTo: () => calls.push('quadraticCurveTo'),
      arc: () => calls.push('arc'),
      stroke: () => calls.push('stroke'),
      fill: () => calls.push('fill'),
      closePath: () => calls.push('closePath'),
      rect: () => calls.push('rect'),
      fillRect: () => calls.push('fillRect'),
      strokeRect: () => calls.push('strokeRect'),
      fillText: (text: string) => calls.push(`fillText:${text}`),
      measureText: (text: string) => ({ width: text.length * 6 }),
      // Transform / state API used by the new renderer.
      setTransform: () => calls.push('setTransform'),
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      translate: () => calls.push('translate'),
      rotate: () => calls.push('rotate'),
      scale: () => calls.push('scale'),
      setLineDash: () => calls.push('setLineDash'),
      drawImage: (image: unknown) => {
        calls.push('drawImage');
        drawnImages.push(image);
      },
      set fillStyle(_v: string) {},
      set strokeStyle(_v: string) {},
      set lineWidth(_v: number) {},
      set globalAlpha(_v: number) {},
      set font(_v: string) {},
      set textAlign(_v: string) {},
      set textBaseline(_v: string) {},
      // The belt/sorter glyphs set line caps and joins.
      set lineCap(_v: string) {},
      set lineJoin(_v: string) {},
      get lineCap() {
        return 'butt';
      },
      get lineJoin() {
        return 'miter';
      },
      get fillStyle() {
        return '#000';
      },
      get strokeStyle() {
        return '#000';
      },
      get lineWidth() {
        return 1;
      },
      get globalAlpha() {
        return 1;
      },
      get font() {
        return '';
      },
      get textAlign() {
        return 'left';
      },
      get textBaseline() {
        return 'alphabetic';
      },
    };
    const canvas = q<HTMLCanvasElement>(window, '#bp-canvas');
    (canvas as unknown as { getContext: (id: string) => unknown }).getContext = () => stub;
    // Give the canvas a measurable box: jsdom reports zero for layout sizes.
    (canvas as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
      ({ width: 900, height: 520, top: 0, left: 0, right: 900, bottom: 520, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    click(window, '#bp-sample');

    expect(calls).toContain('clearRect');
    expect(calls).toContain('setTransform');
    // Buildings are drawn as icons when decoded, otherwise as coloured blocks; the
    // sample asks for both paths (icons may not have decoded yet in jsdom). Belt tracks
    // and sorter heads are paths rather than `fillRect` now, so building coverage is
    // asserted from the block/icon primitives specifically.
    expect(calls.filter((c) => c === 'fillRect').length + drawnImages.length).toBeGreaterThan(0);
    expect(calls.filter((c) => c === 'translate').length).toBeGreaterThan(3);
    expect(calls).toContain('rotate'); // orientation is applied
    expect(calls.some((c) => c.startsWith('fillText:'))).toBe(true); // legend / labels
    // The sample contains belts and sorters, which must take the schematic glyph path
    // instead of the building-icon path. Both shapes are identifiable from the recorded
    // calls without counting strokes, which stopped being a proxy for glyph count when the
    // belt glyph began scaling its chevron count with the cell size.
    expect(calls).toContain('quadraticCurveTo'); // belt track corner
    expect(calls).toContain('fill'); // sorter arrowheads
    expect(calls).toContain('closePath'); // the head is a closed triangle
    expect(errors).toEqual([]);
  });

  it('exposes zoom and layer toggles that redraw without errors', () => {
    const canvas = q<HTMLCanvasElement>(window, '#bp-canvas');
    (canvas as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
      ({ width: 900, height: 520, top: 0, left: 0, right: 900, bottom: 520, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    click(window, '#bp-sample');

    for (const id of ['bp-zoom', 'bp-labels', 'bp-links']) {
      const control = q<HTMLInputElement>(window, `#${id}`);
      expect(control).toBeTruthy();
    }
    const zoom = q<HTMLInputElement>(window, '#bp-zoom');
    zoom.value = '250';
    zoom.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(q(window, '#bp-zoom-out').textContent).toBe('250%');

    const labels = q<HTMLInputElement>(window, '#bp-labels');
    labels.checked = false;
    labels.dispatchEvent(new window.Event('change', { bubbles: true }));
    const links = q<HTMLInputElement>(window, '#bp-links');
    links.checked = false;
    links.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(errors).toEqual([]);
  });

  it('exports a blueprint string that the codec can read back', async () => {
    click(window, '#bp-sample');
    click(window, '#bp-export-text');
    // The export handler is async; let the microtask queue drain.
    await new Promise((r) => setTimeout(r, 30));
    const out = (q(window, '#bp-output') as HTMLTextAreaElement).value;
    expect(out.startsWith('BLUEPRINT:')).toBe(true);

    const { decodeBlueprint } = await import('../src/engine/bp/codec.ts');
    const decoded = await decodeBlueprint(out);
    expect(decoded.body.buildings.length).toBeGreaterThan(0);
    expect(decoded.hashWarning).toBeUndefined();
  });

  it('imports a pasted blueprint and reports parse errors clearly', async () => {
    const input = q(window, '#bp-input') as HTMLTextAreaElement;
    input.value = 'BLUEPRINT:0,10,0';
    click(window, '#bp-load');
    await new Promise((r) => setTimeout(r, 30));
    expect(q(window, '#bp-status').textContent).toMatch(/解析失败/);

    input.value = 'not a blueprint at all';
    click(window, '#bp-load');
    await new Promise((r) => setTimeout(r, 30));
    expect(q(window, '#bp-status').textContent).toMatch(/无法识别/);
  });

  it('shows the mining numbers and reacts to the Veins Utilisation slider', () => {
    click(window, '.tab[data-tab="mining"]');
    const before = q(window, '#mine-stats').textContent ?? '';
    expect(before).toContain('单矿脉产出');

    const slider = q(window, '#mine-level') as HTMLInputElement;
    slider.value = '10';
    slider.dispatchEvent(new window.Event('input', { bubbles: true }));
    const after = q(window, '#mine-stats').textContent ?? '';
    expect(after).not.toBe(before);
    // 30 * (1 + 0.10*10) = 60 per vein at level 10.
    expect(after).toContain('60');
    expect(errors).toEqual([]);
  });

  it('renders the belt and sorter throughput tables', () => {
    click(window, '.tab[data-tab="mining"]');
    const text = q(window, '#belt-table').textContent ?? '';
    expect(text).toContain('传送带');
    expect(text).toContain('分拣器');
    expect(text).toContain('360'); // Mk.I belt 360/min
    expect(text).toContain('1800'); // Mk.III belt 1800/min
  });

  it('lists data sources and known limitations in the about tab', () => {
    click(window, '.tab[data-tab="about"]');
    const sources = q(window, '#about-sources').textContent ?? '';
    expect(sources).toContain('dsp-wiki.com');
    const limits = window.document.querySelectorAll('#about-limits li');
    expect(limits.length).toBeGreaterThan(3);
  });
});
