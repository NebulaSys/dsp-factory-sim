/**
 * Determines the real convention for the blueprint `yaw` field, using the connection
 * graph as ground truth.
 *
 * `glyphs.ts` currently treats `yaw` as radians with zero along +x, but documents that
 * as unverified. The 2971-building real blueprint has 1197 belts and 1195 sorters whose
 * endpoints are recorded as exact object ids, so for every belt the direction it actually
 * travels is known from the position of the object it links to. That makes the field's
 * convention testable instead of assumed: the right interpretation is the one whose
 * predicted direction agrees with the measured travel direction.
 *
 * Candidates cover the plausible unit (radians vs degrees), the zero axis (+x vs +y) and
 * the sign, plus the y-flip between blueprint space and canvas space.
 *
 *   node --experimental-strip-types tools/solve-yaw-convention.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { base64ToBytes, decodeBody, type BlueprintBuilding } from '../src/engine/bp/codec.ts';
import { gunzipBytes } from '../src/engine/bp/gzip.ts';

const ROOT = resolve(import.meta.dirname, '..');

async function payloadOf(rel: string): Promise<Uint8Array> {
  const text = readFileSync(resolve(ROOT, 'docs/research/_raw/realbp', rel), 'utf8');
  const body = text.trim().slice('BLUEPRINT:'.length);
  const closeQuote = body.lastIndexOf('"');
  const prefix = body.slice(0, closeQuote);
  const token = prefix.slice(prefix.lastIndexOf(',') + 1);
  const quote = token.indexOf('"');
  return gunzipBytes(base64ToBytes(token.slice(quote + 1)));
}

const FILE = '仙术_Illegal_仙_无带堆叠锅13824.txt.txt';
const raw = await payloadOf(FILE);
const parsed = decodeBody(raw);
const byIndex = new Map(parsed.buildings.map((b) => [b.index, b]));

/** Every belt with a resolvable neighbour, as (yaw, measured direction). */
interface Sample {
  yaw: number;
  dx: number;
  dy: number;
}
const samples: Sample[] = [];
let beltsSeen = 0;
let noNeighbour = 0;

for (const b of parsed.buildings) {
  // Belts are prototypes 2001..2009.
  if (!(b.itemId > 2000 && b.itemId < 2010)) continue;
  beltsSeen++;
  const target = b.outputObjectIndex >= 0 ? byIndex.get(b.outputObjectIndex) : undefined;
  if (!target) {
    noNeighbour++;
    continue;
  }
  const dx = target.x - b.x;
  const dy = target.y - b.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) continue;
  samples.push({ yaw: b.yaw, dx: dx / len, dy: dy / len });
}

/**
 * Sorters have BOTH endpoints recorded, so their travel direction is fully determined by
 * geometry. Unlike the belts — which in this blueprint all share one angle — sorters
 * sample many directions, which is what makes the axis and sign identifiable.
 */
interface SorterSample {
  yaw: number;
  dx: number;
  dy: number;
}
const sorterSamples: SorterSample[] = [];
let sortersSeen = 0;
let sorterNoEnds = 0;
let sorterSameCell = 0;

for (const b of parsed.buildings) {
  if (!(b.itemId > 2010 && b.itemId < 2020)) continue;
  sortersSeen++;
  const from = b.outputObjectIndex >= 0 ? byIndex.get(b.outputObjectIndex) : undefined;
  const to = b.inputObjectIndex >= 0 ? byIndex.get(b.inputObjectIndex) : undefined;
  if (!from || !to) {
    sorterNoEnds++;
    continue;
  }
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) {
    sorterSameCell++;
    continue;
  }
  sorterSamples.push({ yaw: b.yaw, dx: dx / len, dy: dy / len });
}

console.log(`${FILE}`);
console.log(`buildings=${parsed.buildings.length}`);
console.log(`belts=${beltsSeen} withResolvableNeighbour=${samples.length} without=${noNeighbour}`);
console.log(`sorters=${sortersSeen} withBothEnds=${sorterSamples.length} missingAnEnd=${sorterNoEnds} sameCell=${sorterSameCell}`);

for (const [label, set] of [
  ['belt', samples],
  ['sorter', sorterSamples],
] as const) {
  const nonzero = set.filter((s) => Math.abs(s.yaw) > 1e-3);
  const distinct = [...new Set(nonzero.map((s) => s.yaw.toPrecision(7)))].sort();
  console.log(`\n${label}s: non-zero yaw ${nonzero.length}/${set.length}; distinct = ${distinct.slice(0, 12).join(', ')}${distinct.length > 12 ? ` …(${distinct.length})` : ''}`);
}

/** Mean dot product of predicted vs measured direction; 1.0 is a perfect fit. */
function score(
  set: { yaw: number; dx: number; dy: number }[],
  convert: (yaw: number) => number,
  axis: 'x' | 'y',
  sign: 1 | -1,
  flipY: boolean,
): { mean: number; n: number } {
  let sum = 0;
  let n = 0;
  for (const s of set) {
    const a = sign * convert(s.yaw);
    let px: number;
    let py: number;
    if (axis === 'x') {
      px = Math.cos(a);
      py = Math.sin(a);
    } else {
      px = -Math.sin(a);
      py = Math.cos(a);
    }
    if (flipY) py = -py;
    const len = Math.hypot(px, py) || 1;
    sum += (px / len) * s.dx + (py / len) * s.dy;
    n++;
  }
  return { mean: n ? sum / n : 0, n };
}

const radians = (y: number): number => y;
const degrees = (y: number): number => (y * Math.PI) / 180;

for (const [label, set] of [
  ['BELTS', samples],
  ['SORTERS', sorterSamples],
] as const) {
  console.log(`\n${'='.repeat(72)}\n${label}: candidate conventions (mean dot with measured travel; 1.0 = perfect)`);
  const rows: { label: string; mean: number; n: number }[] = [];
  for (const [unitName, convert] of [
    ['radians', radians],
    ['degrees', degrees],
  ] as const) {
    for (const axis of ['x', 'y'] as const) {
      for (const sign of [1, -1] as const) {
        for (const flipY of [false, true]) {
          const { mean, n } = score(set, convert, axis, sign, flipY);
          rows.push({ label: `yaw=${unitName}, zero +${axis}, sign ${sign > 0 ? '+' : '-'}, ${flipY ? 'y flipped' : 'y as-is'}`, mean, n });
        }
      }
    }
  }
  rows.sort((a, b) => b.mean - a.mean);
  for (const r of rows.slice(0, 6)) {
    console.log(`  ${r.mean >= 0 ? ' ' : ''}${r.mean.toFixed(4)}  n=${r.n}  ${r.label}`);
  }
  const best = rows[0]!;
  console.log(`  best: ${best.mean.toFixed(4)}  (${best.label})`);
  if (best.mean > 0.98) {
    console.log('  -> the graph confirms this convention');
  } else if (best.mean > 0.7) {
    console.log('  -> better than the alternatives but not exact');
  } else {
    console.log('  -> no candidate explains the measured directions');
  }
}
