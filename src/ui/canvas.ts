/**
 * Simplified factory rendering on a 2D canvas.
 *
 * Design goals, in order:
 *  1. proportions match the game — one grid cell is one metre in DSP, so a 3x3
 *     Assembling Machine is drawn three times the size of a 1x1 belt, and every
 *     building is placed at its real blueprint coordinate;
 *  2. buildings are drawn with their real in-game icon, rotated by their recorded
 *     yaw;
 *  3. anything the dataset cannot identify still appears (as a coloured block with
 *     its prototype id) rather than being silently dropped.
 */

import type { FactoryModel, FactoryNode, SorterEndKind } from '../engine/factory.ts';
import { getIcon, iconFor } from './icons.ts';
import {
  beltDirection,
  beltTravelDirection,
  drawBelt,
  drawSorter,
  glyphColour,
  SORTER_END_COLOUR,
  SORTER_MAX_REACH_CELLS,
  sorterDirection,
} from './glyphs.ts';

export const NODE_COLOURS: Record<string, string> = {
  producer: '#26a69a',
  research: '#ab47bc',
  belt: '#546e7a',
  sorter: '#8d6e63',
  logistics: '#5c6bc0',
  power: '#ffca28',
  storage: '#78909c',
  other: '#455a64',
};

export interface ViewTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface RenderOptions {
  /** Extra zoom multiplier on top of fit-to-view. */
  zoom?: number;
  /** Draw building labels. */
  labels?: boolean;
  /** Draw sorter connection lines. */
  links?: boolean;
  /** Draw the grid. */
  grid?: boolean;
  /**
   * Diagonal offset in cells applied per vertical layer. Many real blueprints are
   * vertical stacks ("堆叠蓝图"), where thousands of buildings share an (x, y) footprint
   * at different heights; a plain top-down view draws them on top of each other. A small
   * offset per layer is an exploded view that keeps every layer visible.
   */
  layerSeparation?: number;
  /**
   * Screen-space translation applied *after* fitting the layout to the view.
   *
   * The fit already centres the drawing, so these are a delta from that: they are what
   * drag-to-pan moves. Keeping them separate from the fit means a pan survives a redraw at
   * the same zoom, and a new blueprint starts centred again instead of inheriting the
   * previous one's pan.
   */
  panX?: number;
  panY?: number;
  /**
   * Draw belts as nothing at all.
   *
   * Belt-heavy blueprints are mostly conveyor: the 2971-building sample carries 1197 belts and
   * 1195 sorters against a handful of machines, so the machines are hard to pick out. This is a
   * view filter — the statistics still report every belt in the blueprint.
   */
  hideBelts?: boolean;
}

const CELL_PADDING = 0.12;

/**
 * The canvas's CSS size and its backing-store size for one draw.
 *
 * `rect` must be the canvas's **border box** (`getBoundingClientRect`), and the page uses
 * `box-sizing: border-box`, which makes this mapping a **fixed point**: feeding the returned
 * `cssWidth`/`cssHeight` back in as the measured rect yields the same numbers. That property
 * is the whole point, and its absence was a real bug.
 *
 * The renderer used to size itself from `canvas.clientHeight`, which is the *content* box and
 * therefore excludes the canvas's 1px border. Writing that value back as an inline height set
 * the *border* box, so every draw shrank the canvas by 2px. Rare draws hid it; drag-to-pan
 * redraws on every pointermove, which collapsed the view from its full height to the 240px
 * floor within seconds of dragging.
 */
export function canvasBackingSize(
  rect: { width: number; height: number },
  dpr: number,
): { cssWidth: number; cssHeight: number; pixelWidth: number; pixelHeight: number } {
  const cssWidth = Math.max(320, Math.round(rect.width || 0));
  // Before the first draw the canvas has no explicit height, so `height: auto` resolves it
  // from the width; if even that is unavailable, use the documented 0.58 ratio.
  const cssHeight = Math.max(240, Math.round(rect.height || 0) || Math.round(cssWidth * 0.58));
  return {
    cssWidth,
    cssHeight,
    pixelWidth: Math.max(1, Math.round(cssWidth * dpr)),
    pixelHeight: Math.max(1, Math.round(cssHeight * dpr)),
  };
}

/** Default per-layer offset for the exploded view, in cells. */
export const DEFAULT_LAYER_SEPARATION = 0.45;

/**
 * Vertical layering of a layout.
 *
 * `height` is the rounded z coordinate. The corpus contains blueprints whose layers sit
 * on a 1-unit lattice and others with fractional heights, so layers are found by
 * clustering the observed heights rather than by dividing z.
 */
export interface LayerInfo {
  /** How many distinct heights the layout occupies. */
  layers: number;
  /** Buildings that share an (x, y) footprint with a building at another height. */
  stacked: number;
  /** Lowest height, for reporting. */
  minZ: number;
  /** Highest height, for reporting. */
  maxZ: number;
}

/** Cluster the layout's heights and report how much of it is a vertical stack. */
export function layerInfo(model: FactoryModel): LayerInfo {
  if (model.nodes.length === 0) return { layers: 0, stacked: 0, minZ: 0, maxZ: 0 };

  // Cluster heights with a tolerance, because fractional heights appear in real files.
  const heights: number[] = [];
  for (const node of model.nodes) {
    const z = node.z;
    if (!heights.some((h) => Math.abs(h - z) < 1e-3)) heights.push(z);
  }
  heights.sort((a, b) => a - b);

  // Group by footprint to count what is genuinely stacked rather than merely coplanar.
  const perFootprint = new Map<string, Set<number>>();
  for (const node of model.nodes) {
    const key = `${Math.round(node.x)},${Math.round(node.y)}`;
    let set = perFootprint.get(key);
    if (!set) {
      set = new Set<number>();
      perFootprint.set(key, set);
    }
    set.add(heights.findIndex((h) => Math.abs(h - node.z) < 1e-3));
  }
  let stacked = 0;
  for (const set of perFootprint.values()) if (set.size > 1) stacked += set.size - 1;

  return { layers: heights.length, stacked, minZ: heights[0]!, maxZ: heights[heights.length - 1]! };
}

/**
 * Per-building pixel offset that separates vertical layers, so a stacked blueprint draws
 * as an exploded view instead of one pile of overdraw.
 */
export function layerOffset(
  model: FactoryModel,
  separationCells: number,
): (node: FactoryNode) => { dx: number; dy: number } {
  if (separationCells <= 0) return () => ({ dx: 0, dy: 0 });

  const heights: number[] = [];
  for (const node of model.nodes) {
    if (!heights.some((h) => Math.abs(h - node.z) < 1e-3)) heights.push(node.z);
  }
  heights.sort((a, b) => a - b);
  // Centre the spread so the layout does not drift away from its bounding box.
  const centre = (heights.length - 1) / 2;
  const layerOf = (z: number): number => heights.findIndex((h) => Math.abs(h - z) < 1e-3);

  return (node) => {
    const layer = layerOf(node.z) - centre;
    return { dx: layer * separationCells, dy: -layer * separationCells };
  };
}

/** Footprint in cells; unknown buildings default to 1x1 and belts/sorters to 1x1. */
export function footprintOf(node: FactoryNode): { w: number; h: number } {
  const fp = node.footprint;
  if (fp && fp.w > 0 && fp.h > 0) return { w: fp.w, h: fp.h };
  return { w: 1, h: 1 };
}

/** A per-building drawing offset, used to explode vertical layers. */
export type NodeOffset = (node: FactoryNode) => { dx: number; dy: number };

/**
 * Bounding box of the whole layout in grid cells, accounting for each building's
 * extent. Using only centre points would clip large buildings at the edges.
 *
 * `offset` is applied so an exploded view still fits the canvas.
 */
export function layoutBounds(
  model: FactoryModel,
  offset?: NodeOffset,
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of model.nodes) {
    const fp = footprintOf(node);
    const { dx, dy } = offset ? offset(node) : { dx: 0, dy: 0 };
    minX = Math.min(minX, node.x + dx - fp.w / 2);
    maxX = Math.max(maxX, node.x + dx + fp.w / 2);
    minY = Math.min(minY, node.y + dy - fp.h / 2);
    maxY = Math.max(maxY, node.y + dy + fp.h / 2);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return { minX, minY, maxX, maxY };
}

/** Margin kept clear around the layout when fitting it to the canvas. */
const FIT_MARGIN = 34;
/** Room for the label strip that sits under each producer. */
const LABEL_ROOM = 22;

/**
 * Screen size of one grid cell at 100% zoom, in CSS pixels.
 *
 * The zoom is **absolute** — `scale = CELL_PX * zoom` — so a given percentage always draws a
 * building at the same size. It used to be a multiple of "scale the whole layout to fit the
 * canvas", which meant the same percentage produced visibly different block sizes for different
 * blueprints: a large factory shrank the fit, and every building shrank with it. That made the
 * slider useless as a size control and contradicted the view's own claim that it draws to true
 * scale, where 1 cell is 1 metre.
 *
 * 12 px is a compromise: a belt (1 cell) stays large enough for its chevrons and a 3x3
 * assembler is 36 px, while a 300-cell-wide layout still fits a typical canvas at about a
 * quarter zoom.
 */
export const CELL_PX = 12;

/**
 * Zoom range the view offers; the wheel and the slider clamp to the same bounds.
 *
 * Far wider than the old 0.5..4 because the range now has to span blueprint sizes rather than
 * wobble around a fit: the corpus runs from an 11x11 fixture to a 298-cell-wide solar farm,
 * which at 12 px/cell need zooms three orders of magnitude apart to be viewed usefully.
 */
export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 8;

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/** Per-frame tallies of how the last render drew each kind of building. */
const imageStatus = { drawn: 0, fallback: 0 };
const glyphStatus = { belts: 0, sorters: 0 };

/**
 * Place the layout at an **absolute** scale, centred in the canvas.
 *
 * `zoom` no longer depends on the size of the layout, so equal zoom means equal block size.
 * Zooming scales about the layout's centre, so the drawing grows outward instead of sliding off
 * one corner.
 */
export function viewTransform(
  model: FactoryModel,
  width: number,
  height: number,
  zoom = 1,
  offset?: NodeOffset,
): ViewTransform {
  const bounds = layoutBounds(model, offset);
  const scale = CELL_PX * zoom;
  const centreX = (bounds.minX + bounds.maxX) / 2;
  const centreY = (bounds.minY + bounds.maxY) / 2;
  return {
    scale,
    offsetX: width / 2 - centreX * scale,
    offsetY: (height - LABEL_ROOM) / 2 - centreY * scale,
  };
}

/**
 * The zoom at which the whole layout fits the canvas.
 *
 * This is what a blueprint loads at, so the view still opens showing everything at once. The
 * difference is that it is now a **computed starting zoom** rather than the meaning of 100%:
 * a big blueprint opens at, say, 25%, and that 25% means the same block size it would on any
 * other blueprint.
 */
export function fitZoom(model: FactoryModel, width: number, height: number, offset?: NodeOffset): number {
  const bounds = layoutBounds(model, offset);
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  const pxPerCell = Math.min(
    (width - FIT_MARGIN * 2) / spanX,
    (height - FIT_MARGIN * 2 - LABEL_ROOM) / spanY,
  );
  return clampZoom(pxPerCell / CELL_PX);
}

export interface ZoomAnchorState {
  zoom: number;
  panX?: number;
  panY?: number;
  layerSeparation?: number;
}

/**
 * The pan that keeps one world position under the same screen point while zoom changes.
 *
 * Zooming about the canvas centre is disorienting as soon as the view has been panned: the
 * thing you are looking at slides away. Anchoring the zoom at the cursor keeps it put, which
 * is what makes wheel zoom usable on a large layout.
 *
 * The renderer's transform is affine — `screen = offset + world * scale`, with `offset`
 * depending on the zoom through the centring term — so the world point under the cursor is
 * recovered at the old scale and the pan needed to place it back is solved directly. It is
 * computed from `viewTransform` rather than from a copy of its algebra, so it cannot drift
 * away from what actually gets drawn.
 */
export function panForAnchoredZoom(
  model: FactoryModel,
  width: number,
  height: number,
  current: ZoomAnchorState,
  screenX: number,
  screenY: number,
  nextZoom: number,
): { x: number; y: number } {
  const offset = layerOffset(model, current.layerSeparation ?? 0);
  const before = viewTransform(model, width, height, current.zoom, offset);
  const worldX = (screenX - (before.offsetX + (current.panX ?? 0))) / before.scale;
  const worldY = (screenY - (before.offsetY + (current.panY ?? 0))) / before.scale;
  const after = viewTransform(model, width, height, nextZoom, offset);
  return {
    x: screenX - worldX * after.scale - after.offsetX,
    y: screenY - worldY * after.scale - after.offsetY,
  };
}

/** How many belts and sorters the last frame drew as schematic glyphs. */
export function lastGlyphCounts(): { belts: number; sorters: number } {
  return { ...glyphStatus };
}

/**
 * Per-model render cache.
 *
 * Everything here is derived only from the model plus the view filters, never from the pan/zoom,
 * so it is identical on every frame of a drag. Recomputing it per frame was the bulk of the cost:
 * the draw order sorted 8687 nodes while the comparator called `footprintOf` twice per comparison,
 * and `beltTravelDirection` rebuilt a Map over the whole model.
 */
interface ModelCache {
  hideBelts: boolean;
  ordered: FactoryNode[];
  beltDirs: ReturnType<typeof beltTravelDirection>;
  links: [number, number][];
}
const MODEL_CACHE = new WeakMap<FactoryModel, ModelCache>();

function modelCacheFor(model: FactoryModel, hideBelts: boolean): ModelCache {
  const hit = MODEL_CACHE.get(model);
  if (hit && hit.hideBelts === hideBelts) return hit;

  const visible = model.nodes.filter((node) => !(hideBelts && node.kind === 'belt'));
  // Large buildings first so small ones stay visible on top; within a size class, higher layers
  // draw last so a stacked tower reads bottom-up.
  visible.sort((a, b) => {
    const fa = footprintOf(a);
    const fb = footprintOf(b);
    const area = fb.w * fb.h - fa.w * fa.h;
    return area !== 0 ? area : a.z - b.z;
  });

  // Link segments that stay on one layer and within reach. A link that crosses layers is a
  // vertical transfer between stacked buildings, and drawing it as a diagonal is misleading.
  const byIndex = new Map(model.nodes.map((n) => [n.index, n]));
  const links: [number, number][] = [];
  for (const node of visible) {
    for (const target of node.outputsTo) {
      const to = byIndex.get(target);
      if (!to) continue;
      if (hideBelts && to.kind === 'belt') continue;
      const cellGap = Math.hypot(to.x - node.x, to.y - node.y);
      if (cellGap < 0.05 && Math.abs(to.z - node.z) > 0.05) continue;
      if (cellGap > SORTER_MAX_REACH_CELLS + 0.05) continue;
      links.push([node.index, to.index]);
    }
  }

  const entry: ModelCache = { hideBelts, ordered: visible, beltDirs: beltTravelDirection(model), links };
  MODEL_CACHE.set(model, entry);
  return entry;
}

/**
 * Opt-in frame timing, enabled by adding `?perf` to the URL.
 *
 * Kept in the shipped code because the cost of a frame depends on the blueprint (a 3732-building
 * smelter block and an 8687-building solar farm behave differently) and a number measured in a
 * test is not the same as a number measured in the browser.
 */
const PERF = typeof location !== 'undefined' && /[?&]perf\b/.test(location.search);
let perfFrames = 0;
let perfTotal = 0;
let perfWorst = 0;

export function renderFactory(
  ctx: CanvasRenderingContext2D,
  model: FactoryModel | null,
  width: number,
  height: number,
  options: RenderOptions = {},
): ViewTransform {
  const perfStart = PERF ? performance.now() : 0;
  const view = renderFactoryInner(ctx, model, width, height, options);
  if (PERF) {
    const ms = performance.now() - perfStart;
    perfFrames++;
    perfTotal += ms;
    perfWorst = Math.max(perfWorst, ms);
    // One line per frame while the flag is on: this is an explicit debug mode, and a drag needs
    // the steady-state numbers rather than a periodic sample.
    console.log(
      `[perf] frame=${perfFrames} nodes=${model?.nodes.length ?? 0} ` +
        `last=${ms.toFixed(1)}ms avg=${(perfTotal / perfFrames).toFixed(1)}ms worst=${perfWorst.toFixed(1)}ms`,
    );
  }
  return view;
}

function renderFactoryInner(
  ctx: CanvasRenderingContext2D,
  model: FactoryModel | null,
  width: number,
  height: number,
  options: RenderOptions = {},
): ViewTransform {
  const grid = options.grid !== false;
  const labels = options.labels !== false;
  const links = options.links !== false;

  ctx.clearRect(0, 0, width, height);

  if (!model || model.nodes.length === 0) {
    ctx.fillStyle = '#546e7a';
    ctx.font = '13px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.fillText('导入蓝图后，这里会按真实比例显示建筑。', 18, 30);
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }

  const separation = options.layerSeparation ?? 0;
  const offset = layerOffset(model, separation);
  const fitted = viewTransform(model, width, height, options.zoom ?? 1, offset);
  // Pan is a delta on top of the fit, so the returned transform is what was actually drawn
  // and can be handed straight back to hit-testing or a follow-up render.
  const view = { ...fitted, offsetX: fitted.offsetX + (options.panX ?? 0), offsetY: fitted.offsetY + (options.panY ?? 0) };
  const { scale, offsetX, offsetY } = view;
  // Every drawing call goes through these, so the exploded-layer offset is applied
  // consistently to buildings, links and labels.
  const tx = (x: number, dx = 0): number => offsetX + (x + dx) * scale;
  const ty = (y: number, dy = 0): number => offsetY + (y + dy) * scale;

  if (grid) drawGrid(ctx, width, height, scale, offsetX, offsetY);

  // Hiding belts is a view filter only: the layout bounds are still computed from every node,
  // so toggling the belts off does not make the rest of the factory jump around under the
  // cursor. It also keeps the statistics honest, which report the blueprint rather than the
  // current filter.
  const hideBelts = options.hideBelts === true;
  const isVisible = (node: FactoryNode): boolean => !(hideBelts && node.kind === 'belt');
  const cache = modelCacheFor(model, hideBelts);

  // Sorter connections below the buildings.
  //
  // Only links that stay on one layer AND within a sorter's real reach are drawn. Measured on
  // the corpus, 960 of 1195 sorter links join the same cell on different layers: with layers
  // exploded for visibility, those become long diagonals across the whole layout that read as
  // connections between unrelated machines. They are vertical transfers, so drawing them as
  // diagonals is both noisy and misleading.
  if (links) {
    const byIndex = new Map(model.nodes.map((n) => [n.index, n]));
    ctx.strokeStyle = 'rgba(141, 110, 99, 0.5)';
    ctx.lineWidth = 1.2;
    // Segment list is precomputed per model, so a drag only has to project and stroke it.
    for (const [from, to] of cache.links) {
      const a = byIndex.get(from);
      const b = byIndex.get(to);
      if (!a || !b) continue;
      const oa = offset(a);
      const ob = offset(b);
      ctx.beginPath();
      ctx.moveTo(tx(a.x, oa.dx), ty(a.y, oa.dy));
      ctx.lineTo(tx(b.x, ob.dx), ty(b.y, ob.dy));
      ctx.stroke();
    }
  }

  imageStatus.drawn = 0;
  imageStatus.fallback = 0;
  glyphStatus.belts = 0;
  glyphStatus.sorters = 0;

  // Draw large buildings first so small ones (belts, sorters) stay visible on top.
  // Within one size class, higher layers draw last so a stacked tower reads bottom-up.
  const panX = options.panX ?? 0;
  const panY = options.panY ?? 0;

  const ordered = cache.ordered;
  // Viewport culling. Drawing calls are the remaining cost once the ordering is cached, and when
  // the view is zoomed in most buildings are off-screen. The margin covers a footprint plus the
  // arm of a sorter whose far end can still reach into view.
  const margin = 4 * scale;
  const viewMinX = -margin;
  const viewMaxX = width + margin;
  const viewMinY = -margin;
  const viewMaxY = height + margin;

  // Measured from the connection graph where a belt links to a neighbour; only belts the
  // graph cannot orient fall back to the yaw field.
  const beltDirs = cache.beltDirs;

  let drawn = 0;
  // Level of detail, measured in pixels per grid cell.
  //
  // A cropped `drawImage` per building plus its plate and outline is three canvas calls; at the
  // fit-to-view zoom of a large blueprint a cell is only a few pixels, so the sprite is
  // indistinguishable from a dot while still costing the full draw. Measured on the 8687-building
  // solar farm a frame took ~85 ms and caching the draw order changed nothing, which says the
  // drawing calls are the cost. Below these thresholds the schematic uses flat marks instead —
  // cheaper, and all the eye can resolve at that size anyway.
  const detailedBuildings = scale >= 4;
  const detailedGlyphs = scale >= 3.5;

  for (const node of ordered) {
    const fp = footprintOf(node);
    const w = fp.w * scale;
    const h = fp.h * scale;
    const nodeOffset = offset(node);
    const cx = tx(node.x, nodeOffset.dx);
    const cy = ty(node.y, nodeOffset.dy);
    // Half a cell of slack: a glyph is drawn around the node centre, not only at it.
    if (cx + w < viewMinX || cx - w > viewMaxX || cy + h < viewMinY || cy - h > viewMaxY) continue;
    drawn++;
    const image = getIcon(node.buildingKey);
    const asset = iconFor(node.buildingKey);
    const palette = asset?.palette ?? null;
    const colour = palette?.accent ?? NODE_COLOURS[node.kind] ?? NODE_COLOURS.other!;

    // Cheap path for small cells: one filled rectangle, no plate, no outline, no sprite.
    if (!detailedBuildings) {
      if (node.kind === 'belt' || node.kind === 'sorter') {
        ctx.fillStyle = NODE_COLOURS[node.kind] ?? colour;
        ctx.globalAlpha = 0.85;
        const s = Math.max(1, Math.min(w, h));
        ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = colour;
        ctx.globalAlpha = node.kind === 'producer' || node.kind === 'research' ? 0.92 : 0.62;
        ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
        ctx.globalAlpha = 1;
        // A hairline border, because adjacent 1x1 cells otherwise merge into a solid blob and the
        // layout stops being readable — which is worse than a flat colour that still shows cells.
        ctx.strokeStyle = 'rgba(8, 13, 18, 0.55)';
        ctx.lineWidth = 1;
        ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
      }
      imageStatus.fallback++;
      continue;
    }

    ctx.save();
    ctx.translate(cx, cy);

    if (node.kind === 'belt') {
      const colour2 = glyphColour(palette?.accent, NODE_COLOURS.belt!);
      if (detailedGlyphs) {
        drawBelt(ctx, Math.min(w, h), beltDirs.get(node.index) ?? beltDirection(node), colour2);
      } else {
        ctx.fillStyle = colour2.main;
        ctx.fillRect(-w / 2, -h / 2, w, h);
      }
      glyphStatus.belts++;
      ctx.restore();
      continue;
    }
    if (node.kind === 'sorter') {
      const colour2 = glyphColour(palette?.accent, NODE_COLOURS.sorter!);
      if (detailedGlyphs) {
        drawSorter(ctx, Math.min(w, h), sorterDirection(node), colour2);
      } else {
        ctx.fillStyle = colour2.main;
        const s = Math.max(1, Math.min(w, h) * 0.6);
        ctx.fillRect(-s / 2, -s / 2, s, s);
      }
      glyphStatus.sorters++;
      ctx.restore();
      continue;
    }

    // `yaw` is stored in **degrees**, measured on the real blueprints (values are exact
    // right angles bounded in [0, 360)), so it must be converted before `rotate`, which
    // takes radians. Passing the raw value rotated icons by up to 28 extra turns.
    ctx.rotate(((node.yaw || 0) * Math.PI) / 180);
    if (image) {
      // Crop the sprite to its measured opaque bounding box, then scale that box to
      // the footprint. The source images are ~80x80 with wide transparent margins
      // (a belt fills 87% of its canvas, the Tesla Tower 77%), so scaling the padded
      // square instead would make every building look smaller than the space it
      // occupies and leave gaps against its neighbours.
      const box = asset?.bbox ?? null;
      const srcX = box?.x ?? 0;
      const srcY = box?.y ?? 0;
      const srcW = box?.w ?? image.width;
      const srcH = box?.h ?? image.height;
      // Keep the art's own aspect ratio inside the footprint box (belt icons are
      // 75x44, not square).
      const fit = Math.min(w / srcW, h / srcH) * (1 - CELL_PADDING * 0.4);
      const drawW = srcW * fit;
      const drawH = srcH * fit;
      // Footprint plate behind the art: a dark cell-sized backing that shows how
      // much of the grid the building occupies without competing with the sprite.
      // Kept dark and moderately transparent for the same reason the canvas is dark
      // — the sources are isometric renders, so a bright plate reads as a grey box
      // and hides the grid.
      ctx.fillStyle = '#0b1319';
      ctx.globalAlpha = 0.72;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = palette?.dark ?? colour;
      ctx.lineWidth = Math.max(1, Math.min(2, scale * 0.05));
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.drawImage(image, srcX, srcY, srcW, srcH, -drawW / 2, -drawH / 2, drawW, drawH);
      imageStatus.drawn++;
    } else {
      ctx.fillStyle = colour;
      ctx.globalAlpha = node.kind === 'producer' || node.kind === 'research' ? 0.92 : 0.62;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(11, 16, 21, 0.85)';
      ctx.lineWidth = 1;
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      imageStatus.fallback++;
    }
    ctx.restore();

    // Unknown prototypes are highlighted so nothing silently disappears.
    if (node.buildingKey === null) {
      ctx.strokeStyle = '#ef5350';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
      ctx.setLineDash([]);
    }
  }

  if (labels) drawLabels(ctx, model, view, offset);

  drawLegend(ctx, model, width, height, hideBelts);
  return view;
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scale: number,
  offsetX: number,
  offsetY: number,
): void {
  // Draw one line per grid cell while cells are big enough, otherwise coarsen.
  let step = 1;
  while (step * scale < 14) step *= 2;
  const cell = step * scale;
  ctx.strokeStyle = '#16212b';
  ctx.lineWidth = 1;
  const startX = offsetX - Math.floor(offsetX / cell) * cell;
  const startY = offsetY - Math.floor(offsetY / cell) * cell;
  ctx.beginPath();
  for (let x = startX; x < width; x += cell) {
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, height);
  }
  for (let y = startY; y < height; y += cell) {
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(width, Math.round(y) + 0.5);
  }
  ctx.stroke();
}

/** Labels only when there is room; a dense blueprint must stay readable. */
function drawLabels(
  ctx: CanvasRenderingContext2D,
  model: FactoryModel,
  view: ViewTransform,
  offset: NodeOffset,
): void {
  const avgCell = view.scale;
  if (avgCell < 6) return;
  ctx.font = '10px "Segoe UI", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const node of model.nodes) {
    if (node.kind !== 'producer' && node.kind !== 'research') continue;
    const fp = footprintOf(node);
    const h = fp.h * view.scale;
    const { dx, dy } = offset(node);
    const cx = view.offsetX + (node.x + dx) * view.scale;
    const cy = view.offsetY + (node.y + dy) * view.scale;
    const text = node.recipeKey ? `${node.recipeKey} ${mainRate(node)}` : node.buildingName.slice(0, 16);
    const y = cy + h / 2 + 3;
    const w = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(8, 12, 16, 0.72)';
    ctx.fillRect(cx - w / 2 - 3, y - 1, w + 6, 13);
    ctx.fillStyle = '#dbe9f4';
    ctx.fillText(text, cx, y);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function mainRate(node: FactoryNode): string {
  const first = node.production?.outputsPerMin?.[0];
  if (!first) return '';
  const value = first.count;
  return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10}/m`;
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  model: FactoryModel,
  width: number,
  height: number,
  hideBelts = false,
): void {
  // Category swatches for the buildings drawn as icons/blocks, plus miniature versions of the
  // belt and sorter glyphs — one per mark the blueprint uses — so the invented shapes *and*
  // the per-mark colour code are both explained inside the view.
  const entries: [string, string][] = [
    ['生产机器', NODE_COLOURS.producer!],
    ['研究站', NODE_COLOURS.research!],
    ['物流', NODE_COLOURS.logistics!],
    ['电力', NODE_COLOURS.power!],
  ];
  if (model.unknown.length > 0) entries.push(['未识别原型', '#ef5350']);
  ctx.font = '11px "Segoe UI", "Microsoft YaHei", sans-serif';
  ctx.textBaseline = 'alphabetic';

  // One swatch per belt/sorter mark the blueprint actually uses, drawn in that mark's own
  // colour. A single generic belt and sorter swatch would hide the colour code entirely,
  // while listing all six marks would bloat the key for a blueprint that uses one.
  const marks: { kind: 'belt' | 'sorter'; label: string; colour: string }[] = [];
  const seenMarks = new Set<string>();
  for (const node of model.nodes) {
    if (node.kind !== 'belt' && node.kind !== 'sorter') continue;
    // A hidden belt gets no swatch: the key describes what is on screen.
    if (hideBelts && node.kind === 'belt') continue;
    const key = `${node.kind}:${node.itemId}`;
    if (seenMarks.has(key)) continue;
    seenMarks.add(key);
    const palette = iconFor(node.buildingKey)?.palette ?? null;
    const fallback = node.kind === 'belt' ? NODE_COLOURS.belt! : NODE_COLOURS.sorter!;
    marks.push({ kind: node.kind, label: node.buildingName, colour: glyphColour(palette?.accent, fallback).main });
  }
  // Belts before sorters, then by name, so the key reads the same way every time.
  marks.sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === 'belt' ? -1 : 1));

  const GAP = 14;
  const ROW = 15;
  // How many rows the mark swatches need, so the category row can sit above them.
  let rows = marks.length > 0 ? 1 : 0;
  let used = 14;
  for (const mark of marks) {
    const w = 18 + ctx.measureText(mark.label).width + GAP;
    if (used + w > width - 12) {
      rows++;
      used = 14;
    }
    used += w;
  }
  const markTop = height - 16 - (rows - 1) * ROW;
  const categoryY = markTop - (rows > 0 ? ROW : 0);

  // Sorter arm-end markers, on their own row above the categories. Only the kinds this blueprint
  // actually resolves are listed, and only when it has sorters at all — otherwise the key would
  // explain a code that is not on screen.
  const endLabels: [SorterEndKind, string][] = [
    ['machine', '接机器'],
    ['belt', '接传送带'],
    ['sorter', '接分拣器'],
    ['empty', '未接'],
  ];
  const presentEnds = new Set<SorterEndKind>();
  for (const node of model.nodes) {
    if (node.kind !== 'sorter') continue;
    if (node.armFromKind) presentEnds.add(node.armFromKind);
    if (node.armToKind) presentEnds.add(node.armToKind);
  }
  const endEntries = endLabels.filter(([kind]) => presentEnds.has(kind));
  const endY = categoryY - (endEntries.length > 0 ? ROW : 0);

  // Backdrop for the whole key. Without it the legend sits directly on top of the drawing and the
  // rate labels and belt glyphs behind it make the text unreadable — which defeats the point of a
  // key. Drawn first, so every row lands on top of it.
  const keyTop = endY - 14;
  ctx.fillStyle = 'rgba(10, 16, 22, 0.86)';
  ctx.fillRect(0, keyTop, width, height - keyTop);

  if (endEntries.length > 0) {
    const caption = '分拣器臂端';
    ctx.fillStyle = '#6f8496';
    ctx.fillText(caption, 14, endY);
    let ex = 14 + ctx.measureText(caption).width + 12;
    for (const [kind, label] of endEntries) {
      const colour = SORTER_END_COLOUR[kind];
      if (kind === 'empty') {
        ctx.strokeStyle = colour;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(ex + 5, endY - 4, 3.2, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.arc(ex + 5, endY - 4, 3.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#8ba0b3';
      ctx.fillText(label, ex + 13, endY);
      ex += 13 + ctx.measureText(label).width + 14;
    }
  }

  // Category swatches, on the row above the marks when marks are present.
  let cx = 14;
  for (const [label, colour] of entries) {
    ctx.fillStyle = colour;
    ctx.fillRect(cx, categoryY - 9, 10, 10);
    ctx.fillStyle = '#8ba0b3';
    ctx.fillText(label, cx + 14, categoryY);
    cx += 14 + ctx.measureText(label).width + 16;
  }

  // Mark swatches: the same shapes as the map glyphs, in each mark's colour.
  let mx = 14;
  let my = markTop;
  for (const mark of marks) {
    const textWidth = ctx.measureText(mark.label).width;
    if (mx + 18 + textWidth + GAP > width - 12) {
      mx = 14;
      my += ROW;
    }
    ctx.save();
    ctx.translate(mx + 8, my - 4);
    if (mark.kind === 'belt') {
      ctx.strokeStyle = mark.colour;
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 4 - 1.5, -4);
        ctx.lineTo(i * 4 + 1.5, 0);
        ctx.lineTo(i * 4 - 1.5, 4);
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'miter';
    } else {
      ctx.strokeStyle = mark.colour;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-7, 0);
      ctx.lineTo(2, 0);
      ctx.stroke();
      ctx.fillStyle = mark.colour;
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.lineTo(1, -4);
      ctx.lineTo(1, 4);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = '#8ba0b3';
    ctx.fillText(mark.label, mx + 18, my);
    mx += 18 + textWidth + GAP;
  }
}
