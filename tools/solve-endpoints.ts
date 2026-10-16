/**
 * Validates candidate `outputObjectIndex`/`inputObjectIndex` offsets against ring
 * geometry.
 *
 * The ground-truth fixture is a closed ring of 37 belts on a 10x10 grid. In a belt
 * ring each belt feeds a specific geometric neighbour, so a correctly placed
 * endpoint field must point at one of the belts sitting one cell away. That is far
 * stronger than "the value is a plausible id": garbage that happens to look like an
 * id will not line up with the geometry.
 *
 *   node --experimental-strip-types tools/solve-endpoints.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { base64ToBytes } from '../src/engine/bp/codec.ts';
import { gunzipBytes } from '../src/engine/bp/gzip.ts';

const ROOT = resolve(import.meta.dirname, '..');
const text = readFileSync(resolve(ROOT, 'docs/research/_raw/reffix/blueprint.0.10.34.28326.txt'), 'utf8').trim();
const body = text.slice('BLUEPRINT:'.length);
const closeQuote = body.lastIndexOf('"');
const prefix = body.slice(0, closeQuote);
const tailToken = prefix.slice(prefix.lastIndexOf(',') + 1);
const raw = await gunzipBytes(base64ToBytes(tailToken.slice(tailToken.indexOf('"') + 1)));

const areaCount = raw[28] ?? 0;
const areasEnd = 29 + areaCount * 14;
const recStart = areasEnd + 4;
const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
const markers: number[] = [];
for (let o = recStart; o + 4 <= raw.length; o++) if (dv.getInt32(o, true) === -102) markers.push(o);
const SIZE = markers[1]! - markers[0]!;

interface Rec {
  bytes: Uint8Array;
  index: number;
  x: number;
  y: number;
}
const recs: Rec[] = markers.map((abs) => {
  const b = raw.subarray(abs, abs + SIZE);
  const v = new DataView(b.buffer, b.byteOffset, SIZE);
  return { bytes: b, index: v.getInt32(4, true), x: v.getFloat32(13, true), y: v.getFloat32(17, true) };
});

const byIndex = new Map(recs.map((r) => [r.index, r]));
const round = (v: number): number => Math.round(v * 100) / 100;

/** Indices of belts exactly one cell away from `r` (axis-aligned). */
function neighbours(r: Rec): Set<number> {
  const out = new Set<number>();
  for (const other of recs) {
    if (other.index === r.index) continue;
    const dx = Math.abs(round(other.x) - round(r.x));
    const dy = Math.abs(round(other.y) - round(r.y));
    if ((dx === 1 && dy === 0) || (dx === 0 && dy === 1)) out.add(other.index);
  }
  return out;
}

console.log(`records=${recs.length} size=${SIZE} indexRange=${Math.min(...recs.map((r) => r.index))}..${Math.max(...recs.map((r) => r.index))}`);
const deg = recs.map((r) => neighbours(r).size);
console.log(`neighbours per belt: min=${Math.min(...deg)} max=${Math.max(...deg)}`);

// Candidate offsets for a 32-bit endpoint field. Score = how often the value names
// a geometric neighbour of the pointing belt.
console.log('\noffset  value==neighbour  value==self  -1 count  sample values');
const scored: Array<{ off: number; hit: number }> = [];
for (let off = 25; off + 4 <= SIZE; off++) {
  let hit = 0;
  let self = 0;
  let minus1 = 0;
  const sample: number[] = [];
  for (const r of recs) {
    const value = new DataView(r.bytes.buffer, r.bytes.byteOffset + off, 4).getInt32(0, true);
    if (sample.length < 5) sample.push(value);
    if (value === -1) {
      minus1++;
      continue;
    }
    if (value === r.index) self++;
    if (neighbours(r).has(value)) hit++;
  }
  scored.push({ off, hit });
  if (hit > 0 || minus1 > recs.length * 0.5) {
    console.log(`  +${String(off).padStart(2)}      ${String(hit).padStart(2)}/${recs.length}          ${String(self).padStart(2)}        ${String(minus1).padStart(2)}       [${sample.join(', ')}]`);
  }
}

scored.sort((a, b) => b.hit - a.hit);
console.log(`\nbest offset: +${scored[0]!.off} with ${scored[0]!.hit}/${recs.length} pointing at a geometric neighbour`);

// For the record: are the decoded indices a permutation of 0..36 at all?
console.log('\nfull index listings at the best offset:');
const bestOff = scored[0]!.off;
for (const r of recs.slice(0, 12)) {
  const value = new DataView(r.bytes.buffer, r.bytes.byteOffset + bestOff, 4).getInt32(0, true);
  const target = byIndex.get(value);
  console.log(
    `  #${String(r.index).padStart(2)} at (${round(r.x)},${round(r.y)}) -> ${String(value).padStart(3)}${target ? ` (${round(target.x)},${round(target.y)})` : ''}  neighbours=[${[...neighbours(r)].join(',')}]`,
  );
}
