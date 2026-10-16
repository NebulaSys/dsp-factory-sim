/**
 * UI entry point: load the dataset, wire tabs, boot every view.
 */

import datasetJson from '../engine/data/dsp-vanilla.json';
import slotsJson from '../engine/data/building-slots.json';
import { loadDataset } from '../engine/loader.ts';
import { Store } from './store.ts';
import { initBlueprintView } from './views/blueprint.ts';
import { initPlannerView } from './views/planner.ts';
import { initTechView } from './views/tech.ts';
import { initMiningView } from './views/mining.ts';
import { initAboutView } from './views/about.ts';

function boot(): void {
  let store: Store;
  try {
    const data = loadDataset(datasetJson, slotsJson);
    store = new Store(data);
  } catch (err) {
    document.body.innerHTML = `<main><h2 style="color:#ef5350">数据集加载失败</h2><pre style="white-space:pre-wrap;color:#d8e4ee"></pre></main>`;
    const pre = document.querySelector('pre');
    if (pre) pre.textContent = String((err as Error).stack ?? err);
    return;
  }

  // Tabs
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tab')];
  const panels = [...document.querySelectorAll<HTMLElement>('.panel')];
  function activate(name: string): void {
    for (const tab of tabs) tab.classList.toggle('active', tab.dataset.tab === name);
    for (const panel of panels) panel.classList.toggle('active', panel.id === `panel-${name}`);
    // The canvas has a fixed backing size; redraw when it becomes visible.
    window.dispatchEvent(new Event('resize'));
  }
  for (const tab of tabs) {
    tab.addEventListener('click', () => activate(tab.dataset.tab ?? 'blueprint'));
  }

  initBlueprintView(store);
  initPlannerView(store);
  initTechView(store);
  initMiningView(store);
  initAboutView(store);

  // Deep links, so a layout can be shared or screenshotted from a URL:
  //   ?tab=blueprint|planner|tech|mining|about
  //   ?sample=1        load the built-in sample blueprint
  //   ?zoom=150        zoom the canvas (%)
  //   ?proliferator=Proliferator3&mode=speedup
  applyUrlParameters(store, activate);

  const errors: string[] = [];
  window.addEventListener('error', (event) => errors.push(String(event.message)));
  window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)));
  if (errors.length > 0) {
    const footer = document.getElementById('footer-status');
    if (footer) footer.textContent = `运行期错误：${errors[0]}`;
  }

  // Expose the engine for console-based experiments and automated checks.
  (window as unknown as { dspSim?: unknown }).dspSim = { store };
}

/**
 * Apply `?tab=`, `?sample=1`, `?zoom=` and `?proliferator=`/`?mode=` from the URL.
 * Used both by users sharing a link and by the screenshot tooling.
 */
function applyUrlParameters(store: Store, activate: (name: string) => void): void {
  const params = new URLSearchParams(window.location.search);

  const proliferator = params.get('proliferator');
  const mode = params.get('mode');
  if (proliferator || mode) {
    const marks = store.state.data.proliferatorMarks;
    const markKey = proliferator
      ? (marks.find((m) => m.key.toLowerCase() === proliferator.toLowerCase())?.key ?? proliferator)
      : null;
    const chosenMode = (mode ?? (markKey ? 'extraProducts' : 'none')) as 'none' | 'extraProducts' | 'speedup';
    store.update((s) => {
      s.proliferator = { markKey, mode: chosenMode };
      s.planProliferator = { markKey, mode: chosenMode };
    });
    const markSelect = document.getElementById('bp-mark') as HTMLSelectElement | null;
    if (markSelect && markKey) markSelect.value = markKey;
    const modeSelect = document.getElementById('bp-mode') as HTMLSelectElement | null;
    if (modeSelect) modeSelect.value = chosenMode;
  }

  if (params.get('sample') === '1') {
    (document.getElementById('bp-sample') as HTMLButtonElement | null)?.click();
  }

  // Bounds mirror the slider: the zoom is absolute, so a blueprint can need anything from a few
  // percent (a whole planet's factory) to a few hundred (a single machine).
  const zoom = Number(params.get('zoom'));
  if (Number.isFinite(zoom) && zoom >= 5 && zoom <= 800) {
    const zoomInput = document.getElementById('bp-zoom') as HTMLInputElement | null;
    if (zoomInput) {
      zoomInput.value = String(zoom);
      zoomInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  const tab = params.get('tab');
  if (tab) activate(tab);
}

boot();
