/**
 * Building icon assets.
 *
 * Icons are downloaded from dsp-wiki.com by `tools/fetch-icons.mjs` into
 * `public/icons/`, with a manifest at `src/engine/data/building-icons.json` that
 * maps dataset building keys to files. Loaded images are cached and decoded once;
 * every canvas that needs them can register a callback to redraw when a load
 * finishes.
 *
 * Icons belong to Youthcat Studio / the wiki's contributors — this is a fan tool.
 */

import manifestJson from '../engine/data/building-icons.json';
import type { BuildingDef } from '../engine/types.ts';

/** Tight box around the visible art inside a source image. */
export interface IconBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface IconPalette {
  /** Mean of saturated mid-tone pixels: the building's characteristic colour. */
  accent: string;
  /** Mean of all opaque pixels. */
  mean: string;
  /** Shaded accent, for outlines behind the art. */
  dark: string;
}

export interface IconAsset {
  /** URL served to the browser, e.g. `/icons/Icon_Arc_Smelter.png`. */
  file: string;
  width: number | null;
  height: number | null;
  /**
   * Tight bounding box of the non-transparent pixels, measured from the PNG by
   * `tools/fetch-icons.mjs`.
   *
   * The wiki sprites are ~80x80 with a lot of empty margin (the belt icon fills
   * only 87% of its canvas, the Tesla Tower 77%). Scaling the padded square to a
   * footprint leaves the building looking undersized and detached from its
   * neighbours, so the renderer crops to this box first and scales the visible art
   * to the footprint instead.
   */
  bbox: IconBBox | null;
  palette: IconPalette | null;
}

const MANIFEST: Record<string, IconAsset> = (manifestJson as { icons: Record<string, IconAsset> }).icons;

/**
 * Icon URL rebased onto the deployment root.
 *
 * The manifest stores repository-absolute paths (`/icons/Icon_Arc_Smelter.png`), which are
 * correct only when the app is served from the domain root. GitHub Pages serves a project site
 * from `/<repo>/`, so a leading slash would send every icon request to the wrong place and the
 * canvas would silently fall back to coloured blocks.
 *
 * `import.meta.env.BASE_URL` is whatever `base` resolved to at build time, and always ends in a
 * separator, so this works unchanged for `/` and for `/dsp-factory-sim/`.
 */
function rebase(file: string): string {
  const base = import.meta.env.BASE_URL || '/';
  return base.replace(/\/$/, '') + '/' + file.replace(/^\/+/, '');
}

/** Dataset building keys that have a downloaded icon. */
export const ICON_KEYS: ReadonlySet<string> = new Set(Object.keys(MANIFEST));

/** Every icon URL in the manifest, for preloading. */
export function allIconUrls(): string[] {
  return [...new Set(Object.values(MANIFEST).map((i) => rebase(i.file)))];
}

export function iconFor(buildingKey: string | null): IconAsset | null {
  if (!buildingKey) return null;
  const asset = MANIFEST[buildingKey];
  return asset ? { ...asset, file: rebase(asset.file) } : null;
}

/**
 * Colour behind a building's art, sampled from its own icon.
 *
 * Used as the footprint block fill so a schematic view still reads as "this is an
 * Arc Smelter" even before the sprite decodes, and as the outline afterwards.
 */
export function paletteFor(buildingKey: string | null): IconPalette | null {
  if (!buildingKey) return null;
  return MANIFEST[buildingKey]?.palette ?? null;
}

type Ready = (image: HTMLImageElement | null) => void;

interface Entry {
  image: HTMLImageElement | null;
  failed: boolean;
  listeners: Set<Ready>;
  loading: boolean;
}

const cache = new Map<string, Entry>();
const globalListeners = new Set<Ready>();

/** Ask to be told whenever any icon finishes loading (so views can redraw). */
export function onIconLoaded(listener: Ready): () => void {
  globalListeners.add(listener);
  return () => globalListeners.delete(listener);
}

/**
 * Return the decoded image for a building, or null when it is still loading or
 * unavailable. Never blocks: the view draws a fallback and is redrawn by
 * `onIconLoaded` when the image arrives.
 */
export function getIcon(buildingKey: string | null): HTMLImageElement | null {
  const asset = iconFor(buildingKey);
  if (!asset) return null;
  const existing = cache.get(asset.file);
  if (existing) return existing.image;

  const entry: Entry = { image: null, failed: false, listeners: new Set(), loading: true };
  cache.set(asset.file, entry);

  const image = new Image();
  image.decoding = 'async';
  image.onload = () => {
    entry.image = image;
    entry.loading = false;
    for (const listener of entry.listeners) listener(image);
    entry.listeners.clear();
    for (const listener of globalListeners) listener(image);
  };
  image.onerror = () => {
    entry.failed = true;
    entry.loading = false;
    for (const listener of globalListeners) listener(null);
  };
  image.src = asset.file;
  return null;
}

/** Kick off loading for every icon so the first frame is usually warm. */
export function preloadIcons(): void {
  for (const key of Object.keys(MANIFEST)) getIcon(key);
}

export function iconCoverage(buildings: readonly BuildingDef[]): { withIcon: number; total: number; missing: string[] } {
  const missing = buildings.filter((b) => !MANIFEST[b.key]).map((b) => b.key);
  return { withIcon: buildings.length - missing.length, total: buildings.length, missing };
}
