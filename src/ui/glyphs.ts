/**
 * Schematic glyphs for belts and sorters.
 *
 * Belts and sorters are flat, top-down mechanical parts and are drawn as invented
 * vector shapes rather than game icons, so the schematic stays readable at any zoom
 * and the flow direction is visible:
 *
 *   - a **belt** is a short dark track with three chevrons ("»»»") in its tier
 *     colour, pointing along the direction of travel;
 *   - a **sorter** is a bar from its pickup cell to its drop-off cell, ending in a
 *     solid triangular head, in its tier colour.
 *
 * Direction sourcing, stated honestly
 * ----------------------------------
 * A sorter's direction is *measured*: the blueprint stores which object it takes
 * from (`outputObjectIndex`) and which it delivers to (`inputObjectIndex`), so the
 * glyph points from the first to the second. When either endpoint is a belt (index
 * -1) the sorter's own recorded yaw is used instead.
 *
 * A belt's direction comes from its recorded `yaw`. This is the one part of the
 * schematic that rests on an unverified convention: `tools/probe-fields.ts` shows
 * the reference blueprint's 37 belts all store yaw = 0 while their coordinates form
 * a ring, so that blueprint carries no usable belt direction at all, and blueprints
 * in the local corpus cannot be decoded far enough to disagree. `BELT_YAW_ZERO_AXIS`
 * and `BELT_YAW_SIGN` therefore name the assumption in one place, and belts whose
 * yaw carries no information are drawn with the neutral glyph below instead of a
 * confidently wrong arrow.
 */

import type { FactoryModel, FactoryNode, SorterEndKind } from '../engine/factory.ts';

/**
 * Which world axis a belt with `yaw === 0` runs along.
 *
 * 'x' means yaw 0 points towards +x (right on screen). Flip this single constant if
 * a blueprint shows belts running perpendicular to their arrows.
 */
export const BELT_YAW_ZERO_AXIS: 'x' | 'y' = 'x';

/**
 * Sign of the angle. +1 means increasing yaw turns from +x towards +y (which is
 * downward on screen, since blueprint y grows with canvas y).
 */
export const BELT_YAW_SIGN: 1 | -1 = 1;

/** Below this magnitude a yaw is treated as "not recorded" rather than 0 degrees. */
export const YAW_EPSILON = 1e-3;

export interface Direction {
  dx: number;
  dy: number;
  /** True when the source data actually determined the direction. */
  known: boolean;
}

/**
 * Belt travel direction measured from the blueprint's own connection graph.
 *
 * The `yaw` field is **not** a usable two-dimensional rotation here: measured against the
 * real 2971-building blueprint, every belt that links to a neighbour carries the same
 * angle and the current radians/zero-+x interpretation scores -0.797 against the actual
 * travel direction (see tools/solve-yaw-convention.ts). The link target, by contrast, is
 * an exact object id with an exact position, so the direction between the two cells is
 * measured rather than assumed.
 *
 * Only belts that link to a neighbour at a different cell get an entry; everything else
 * falls back to `beltDirection`, which reports `known: false` when the data does not
 * determine a direction. That keeps the arrows honest instead of drawing a guess.
 */
export function beltTravelDirection(model: FactoryModel): Map<number, Direction> {
  const byIndex = new Map(model.nodes.map((n) => [n.index, n]));
  const result = new Map<number, Direction>();
  for (const node of model.nodes) {
    if (node.kind !== 'belt') continue;
    // Preferred: the direction measured at conversion time from the belt's recorded link
    // target, which survives filtering of the target out of `nodes`.
    if (node.travelDirection) {
      result.set(node.index, { dx: node.travelDirection.dx, dy: node.travelDirection.dy, known: true });
      continue;
    }
    // Fallback: the same measurement taken from a link target that is still visible.
    for (const target of node.outputsTo) {
      const to = byIndex.get(target);
      if (!to) continue;
      const dx = to.x - node.x;
      const dy = to.y - node.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      result.set(node.index, { dx: dx / len, dy: dy / len, known: true });
      break;
    }
  }
  return result;
}

/**
 * Belt travel direction in grid space (y grows downwards on screen).
 *
 * Fallback for belts the connection graph cannot orient. Returns `known: false` when the
 * recorded yaw is within `YAW_EPSILON` of zero, which is what the reference blueprint
 * stores for every belt — treating that as a real direction would draw every arrow the
 * same way regardless of the belt's actual orientation.
 *
 * NOTE: the measured evidence says this field is in **degrees** bounded in [0, 360)
 * (exact 90/180/270 values, maximum 354), not radians. The best-fitting relation over the
 * real 2971-building blueprint is `(-sin(yaw), -cos(yaw))` in blueprint space, which
 * scores 0.995 against the measured travel direction where the radians/zero-+x reading
 * scores -0.797. That fit, however, rests on a single observed belt angle (180), so it is
 * a best effort and every value it produces is returned with `known: false` — the UI draws
 * those arrows dimmed rather than asserting a direction the data does not establish.
 */
export function beltDirection(node: FactoryNode): Direction {
  const degrees = Number.isFinite(node.yaw) ? node.yaw : 0;
  if (Math.abs(degrees) < YAW_EPSILON) return { dx: 1, dy: 0, known: false };
  const a = (BELT_YAW_SIGN * degrees * Math.PI) / 180;
  const x = -Math.sin(a);
  const y = -Math.cos(a);
  const len = Math.hypot(x, y) || 1;
  return { dx: x / len, dy: y / len, known: false };
}

/**
 * The longest reach a real sorter can have, in grid cells.
 *
 * DSP sorters span at most three cells. Measured across the decoded corpus, only 8 of 3232
 * sorters land at exactly 3 and the remaining non-degenerate ones land at 5 to 159 cells,
 * which no sorter can physically reach. Those endpoint pairs are therefore not a sorter's
 * travel, and the glyph refuses to draw a direction for them rather than inventing one.
 */
export const SORTER_MAX_REACH_CELLS = 3;

/**
 * What the recorded endpoints actually say about a sorter.
 *
 *  - `horizontal`: a real reach of 1-3 cells, so the arrow means something.
 *  - `vertical`: both endpoints sit on the same cell — 2997 of the corpus's 3232 sorters do
 *    this, because these blueprints stack buildings and the sorter moves items between
 *    layers. A horizontal arrow would be meaningless, so this gets its own glyph.
 *  - `unresolved`: the endpoints are further apart than a sorter can reach, so the recorded
 *    pair is not a travel direction and no arrow is drawn.
 */
export type SorterReach = 'horizontal' | 'vertical' | 'unresolved';

export interface SorterDirection {
  dx: number;
  dy: number;
  /** True only when the recorded endpoints establish the direction. */
  known: boolean;
  length: number;
  reach: SorterReach;
  /**
   * True when both the arm's axis *and* which end is the pickup are established.
   *
   * The record's own anchors give the axis (they are the two ends of the arm) but not the sign:
   * nothing in the record says which end picks up. A link whose target lies along the arm does
   * establish the sign, so that is what sets this. When it is false the glyph shows the axis
   * with a head at each end rather than asserting a heading it does not have.
   */
  signKnown: boolean;
  /**
   * What stands at the `armFrom` end and at the `armTo` end, resolved from position by the engine.
   *
   * The blueprint does not record the machine<->sorter attachment (machine categories write no
   * link fields at all), so the engine reproduces what the game does on paste: look at what is
   * standing there. Carrying it into the glyph turns "an arrow of unknown direction" into "this end
   * is on a machine, that end is on a belt".
   */
  fromKind?: SorterEndKind;
  toKind?: SorterEndKind;
  /**
   * True when an empty end cannot be trusted to mean "nothing is there", because the blueprint
   * stacks buildings and the attachment may be vertical.
   */
  endUncertain?: boolean;
}

/** End-marker colours, keyed by what stands at that end of the arm. */
export const SORTER_END_COLOUR: Record<SorterEndKind, string> = {
  machine: '#e0a33e',
  belt: '#3fa7d6',
  sorter: '#8a8f98',
  empty: '#d9534f',
};

/**
 * Sorter direction and reach, classified from the record's own arm anchors where they exist.
 *
 * The two anchors `(x, y, z)` and `(x2, y2, z2)` are the ends of the arm itself — measured over
 * 4427 sorters, their horizontal span is 1-3 cells for 96% of them. That makes them a far better
 * source than `picksUpFrom` / `dropsOffAt`, which come from `outputObjectIndex` /
 * `inputObjectIndex`: those name the object a sorter is wired to logically, and several sorters
 * feeding one belt all point at the same belt record, so the pair is usually not the arm at all.
 *
 * The classification is what keeps the schematic honest:
 *  - `horizontal`: a real 1-3 cell arm — draw the arm, and show the sign only if a link agrees;
 *  - `vertical`: the anchors coincide, so the transfer is between stacked layers and there is no
 *    horizontal heading to show;
 *  - `unresolved`: no usable arm and the link pair is longer than a sorter can reach — the
 *    recorded pair is not a travel direction, so no arrow is drawn.
 */
export function sorterDirection(node: FactoryNode): SorterDirection {
  // Preferred source: the arm recorded on the sorter itself.
  if (node.armFrom && node.armTo) {
    const adx = node.armTo.x - node.armFrom.x;
    const ady = node.armTo.y - node.armFrom.y;
    const alen = Math.hypot(adx, ady);
    if (alen > 0.05 && alen <= SORTER_MAX_REACH_CELLS + 0.05) {
      const ux = adx / alen;
      const uy = ady / alen;
      // A link only confirms the sign when it lies along the arm and is itself in reach.
      const from = node.picksUpFrom ?? node;
      const to = node.dropsOffAt ?? node;
      const ldx = to.x - from.x;
      const ldy = to.y - from.y;
      const llen = Math.hypot(ldx, ldy);
      const signKnown =
        llen > 0.05 && llen <= SORTER_MAX_REACH_CELLS + 0.05 && (ldx * ux + ldy * uy) / llen > 0.5;
      return {
        dx: ux,
        dy: uy,
        known: signKnown,
        length: alen,
        reach: 'horizontal',
        signKnown,
        fromKind: node.armFromKind,
        toKind: node.armToKind,
        endUncertain: node.armEndUncertain,
      };
    }
  }

  const from = node.picksUpFrom ?? node;
  const to = node.dropsOffAt ?? node;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);

  if (length <= 0.05) {
    // Same cell: a vertical transfer. The yaw field cannot orient this, so it stays unknown.
    return { ...beltDirection(node), length, reach: 'vertical', signKnown: false };
  }
  if (length <= SORTER_MAX_REACH_CELLS + 0.05) {
    return { dx: dx / length, dy: dy / length, known: true, length, reach: 'horizontal', signKnown: true };
  }
  return { dx: dx / length, dy: dy / length, known: false, length, reach: 'unresolved', signKnown: false };
}

/**
 * Colour for a belt/sorter glyph: the tier colour sampled from its own icon.
 *
 * The sampled `accent` is the *mean of mid-tone pixels* of the building icon — chosen as a
 * fill colour to sit behind art, not as a thin stroke on a near-black canvas. Used raw, the
 * three sorter marks (`#978973`, `#598b8c`, `#608aaa`) all land in a narrow band of
 * saturation and lightness and read as "greyish", so the mark is hard to tell apart even
 * though the value is correct.
 *
 * The **hue** is what identifies the mark, so it is preserved exactly while saturation and
 * lightness are lifted to where thin strokes actually separate against `#0b1319`.
 */
export function glyphColour(
  accent: string | null | undefined,
  fallback: string,
): { main: string; dim: string } {
  const main = accent ? liftForDarkCanvas(accent) : fallback;
  return { main, dim: shade(main, 0.42) };
}

/** Multiply a `#rrggbb` colour towards black. */
export function shade(hex: string, factor: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  return toHex(rgb.map((v) => Math.max(0, Math.min(255, Math.round(v * factor)))));
}

/**
 * Lifts a colour for thin strokes on the dark canvas **without flattening the set**.
 *
 * A uniform floor ("saturation at least 0.5, lightness at least 0.62") is the obvious move and
 * is wrong here: Sorter Mk.III and the Pile Sorter share a hue of about 205 degrees and differ
 * mostly in *saturation*, so flooring both maps them onto nearly the same blue (`#6ea5cf` vs
 * `#6ea8cf`) and destroys the very distinction the colour is meant to carry.
 *
 * Saturation is therefore scaled and lightness shifted, so colours that differed before still
 * differ afterwards.
 *
 * The gains are not chosen by eye. `tools/check-tier-colours.ts --tune` scans them and reports,
 * for each setting, how much any pair shrinks and what the closest pair ends up at. Two facts
 * come out of that scan and shape the choice:
 *
 *   * **no** setting is separation-preserving — every one compresses at least one pair, because
 *     a lightness shift necessarily pulls the set together; and
 *   * raising saturation *increases* the worst-case separation: the closest pair of the source
 *     accents is 31.1 apart, and at 2.0 it is 36.6.
 *
 * So the aim is not "never reduce" but "end up further apart than the source art was", which
 * these defaults achieve while still lifting lightness for legibility.
 */
export function liftForDarkCanvas(hex: string, saturationGain = 2.0, lightnessGain = 0.1): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const [h, s, l] = rgbToHsl(rgb);
  return hslToHex(h, Math.min(1, s * saturationGain), Math.min(0.9, l + lightnessGain));
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const value = parseInt(m[1]!, 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function toHex(rgb: number[]): string {
  return `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}

/** Hue in degrees, saturation and lightness in 0..1. */
function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = l - c / 2;
  const seg: [number, number, number] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  return toHex(seg.map((v) => (v + m) * 255));
}

/**
 * Draw a belt: a dark track with chevrons along the travel direction.
 *
 * `size` is the belt's cell size in pixels. Three details are tuned for the zoom range the
 * view actually uses:
 *
 *  - the **chevron count scales with size**, because three chevrons inside a 6-pixel cell
 *    turn into an unreadable smear; a single larger chevron reads better when zoomed out;
 *  - the track is a **rounded** tile with a soft tier-tinted edge instead of a hard square
 *    border, so a run of belts reads as one continuous path rather than a grid of tiles;
 *  - when the direction is unknown the chevrons are drawn faintly, so the cell still reads
 *    as a belt without asserting a heading.
 */
export function drawBelt(
  ctx: CanvasRenderingContext2D,
  size: number,
  direction: Direction,
  colour: { main: string; dim: string },
): void {
  const half = size / 2;
  const radius = Math.max(0, size * 0.14);

  // Track: a dark rounded tile tinted towards the tier colour so runs stay continuous.
  ctx.fillStyle = '#0b1319';
  ctx.globalAlpha = 0.9;
  roundRect(ctx, -half, -half, size, size, radius);
  ctx.fill();
  ctx.globalAlpha = 1;
  if (size >= 9) {
    ctx.strokeStyle = colour.dim;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(0.6, size * 0.05);
    roundRect(ctx, -half, -half, size, size, radius);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Chevrons in a local frame where travel is towards +x.
  ctx.save();
  ctx.rotate(Math.atan2(direction.dy, direction.dx));
  ctx.strokeStyle = colour.main;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = direction.known ? 1 : 0.4;

  // Fewer, larger chevrons when the cell is small; the full trio only when there is room.
  const count = size >= 16 ? 3 : size >= 10 ? 2 : 1;
  const pitch = size / (count + 1);
  const arm = size * (count === 1 ? 0.3 : 0.22);
  ctx.lineWidth = Math.max(1.2, size * (count === 1 ? 0.16 : 0.115));
  for (let i = 0; i < count; i++) {
    const cx = (i - (count - 1) / 2) * pitch;
    ctx.beginPath();
    ctx.moveTo(cx - arm * 0.5, -arm);
    ctx.lineTo(cx + arm * 0.62, 0);
    ctx.lineTo(cx - arm * 0.5, arm);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
}

/** Trace a rounded rectangle path (no fill/stroke), for older canvas targets. */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rad = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

/**
 * Draw a sorter.
 *
 * Deliberately a different silhouette from a belt so the two are distinguishable at a glance
 * even in the same tier colour, but the shape now depends on what the endpoints actually say:
 *
 *  - **horizontal** (a real 1-3 cell reach): a bar from the pickup pad to a filled head,
 *    spanning the measured distance so it visibly bridges the two cells;
 *  - **vertical** (both endpoints on one cell, which is 93% of the corpus): a compact
 *    in-place glyph — a pad with two opposed heads — because there is no horizontal heading
 *    to show and a horizontal arrow here would be a fabrication;
 *  - **unresolved** (endpoints further apart than a sorter can reach): a small hollow ring,
 *    which asserts no direction at all.
 */
export function drawSorter(
  ctx: CanvasRenderingContext2D,
  size: number,
  direction: SorterDirection,
  colour: { main: string; dim: string },
): void {
  const thickness = Math.max(1.8, size * 0.18);
  const head = Math.max(4, size * 0.34);

  if (direction.reach === 'vertical') {
    // In-place transfer: a pad with a head above and below, i.e. "this cell, both ways".
    const armLen = size * 0.42;
    ctx.strokeStyle = colour.main;
    ctx.lineWidth = thickness;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -armLen);
    ctx.lineTo(0, armLen);
    ctx.stroke();
    ctx.lineCap = 'butt';

    ctx.fillStyle = colour.main;
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, dir * (armLen + head * 0.5));
      ctx.lineTo(-head * 0.5, dir * armLen);
      ctx.lineTo(head * 0.5, dir * armLen);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = colour.dim;
    const pad = thickness * 1.5;
    ctx.fillRect(-pad / 2, -pad / 2, pad, pad);
    return;
  }

  if (direction.reach === 'unresolved') {
    // The recorded pair is not a distance a sorter can span, so show a neutral marker.
    ctx.strokeStyle = colour.dim;
    ctx.lineWidth = Math.max(1.2, size * 0.12);
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(2, size * 0.22), 0, Math.PI * 2);
    ctx.stroke();
    return;
  }

  ctx.save();
  ctx.rotate(Math.atan2(direction.dy, direction.dx));
  // Span the measured distance, with the tail starting at the pickup cell's edge.
  const span = direction.length * size;
  const reach = Math.max(size * 0.75, Math.min(span, size * (SORTER_MAX_REACH_CELLS + 0.5)));

  // Body bar from the pickup end to where the head begins.
  ctx.strokeStyle = colour.main;
  ctx.lineWidth = thickness;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-reach * 0.45, 0);
  ctx.lineTo(reach - head * 0.85, 0);
  ctx.stroke();
  ctx.lineCap = 'butt';

  // Pickup pad: a small filled square so the source end is identifiable. Only drawn when the
  // record actually establishes which end picks up; otherwise the pad would imply a sign the
  // data does not carry.
  if (direction.signKnown) {
    ctx.fillStyle = colour.dim;
    const pad = thickness * 1.5;
    ctx.fillRect(-reach * 0.45 - pad / 2, -pad / 2, pad, pad);
  }

  // Head(s) at the drop-off end. When the axis is known but the sign is not, put a head at each
  // end: that shows the arm's real span without asserting a heading.
  ctx.fillStyle = colour.main;
  const heads = direction.signKnown ? [reach] : [reach, -reach];
  for (const at of heads) {
    const dir = at >= 0 ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(at, 0);
    ctx.lineTo(at - dir * head, -head * 0.62);
    ctx.lineTo(at - dir * head, head * 0.62);
    ctx.closePath();
    ctx.fill();
  }

  // What is standing at each end of the arm. Drawn at the true arm ends (±span/2), not at the
  // decorative bar ends above, so the marker lands on the cell it is describing.
  // A red "empty" marker is suppressed when the blueprint stacks, because there the attachment can
  // be vertical and the x/y plane simply cannot see it — that is unresolved, not broken.
  const half = span / 2;
  for (const [at, kind] of [
    [-half, direction.fromKind],
    [half, direction.toKind],
  ] as const) {
    if (!kind) continue;
    if (kind === 'empty' && direction.endUncertain) continue;
    ctx.fillStyle = SORTER_END_COLOUR[kind];
    if (kind === 'empty') {
      // Hollow ring: "nothing here", distinct from any filled end marker.
      ctx.strokeStyle = SORTER_END_COLOUR.empty;
      ctx.lineWidth = Math.max(1, size * 0.1);
      ctx.beginPath();
      ctx.arc(at, 0, Math.max(1.6, size * 0.17), 0, Math.PI * 2);
      ctx.stroke();
    } else {
      const r = Math.max(1.6, size * 0.15);
      ctx.beginPath();
      ctx.arc(at, 0, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
