/**
 * Confirms the full record layout by requiring a consistent (coordinates, output,
 * input, slots, tail) reading.
 *
 * tools/solve-endpoints.ts already proved `outputObjectIndex` lives at +33: 34 of
 * 37 belts in the ground-truth ring point at a belt one cell away, and the chain
 * they form walks the ring in order. This step finds where the remaining fields sit
 * around that anchor, using constraints that must hold for belt data:
 *   - `inputObjectIndex` (4 bytes after output) is -1 for a belt;
 *   - the 6 slot bytes and the tail are constant across these 37 belts;
 *   - the record must end exactly at its measured size, with parameterCount = 0.
 *
 *   node --experimental-strip-types tools/confirm-layout.ts
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
const N = markers.length;

const recs = markers.map((base) => raw.subarray(base, base + SIZE));

/** Confirm +33 is the output field, then find the input field. */
console.log(`record size=${SIZE} records=${N}`);

// 1. Is +33 really the output index? Count links into a geometric neighbour and
//    verify the chain is a walk, not a scatter.
const pos = recs.map((b) => {
  const v = new DataView(b.buffer, b.byteOffset, SIZE);
  return { x: v.getFloat32(13, true), y: v.getFloat32(17, true) };
});
const idx = recs.map((b) => new DataView(b.buffer, b.byteOffset, SIZE).getInt32(4, true));
const round = (n: number): number => Math.round(n * 100) / 100;
const byIdx = new Map(idx.map((id, i) => [id, i]));
const neighbourHit = recs.filter((b, i) => {
  const out = new DataView(b.buffer, b.byteOffset, SIZE).getInt32(33, true);
  if (out === -1) return false;
  const j = byIdx.get(out);
  if (j === undefined) return false;
  const dx = Math.abs(round(pos[j]!.x) - round(pos[i]!.x));
  const dy = Math.abs(round(pos[j]!.y) - round(pos[i]!.y));
  return (dx === 1 && dy === 0) || (dx === 0 && dy === 1);
}).length;
console.log(`+33 resolves to a geometric neighbour for ${neighbourHit}/${N} belts (confirms output field)`);

// 2. Locate the input field: 4 bytes after output must be -1 for every belt.
for (const candidate of [37, 41, 29, 45]) {
  const allMinus1 = recs.every((b) => new DataView(b.buffer, b.byteOffset, SIZE).getInt32(candidate, true) === -1);
  console.log(`  int32 @+${candidate} == -1 for all belts: ${allMinus1}`);
}

// 3. Report the constant tail so the remaining bytes can be attributed.
console.log('\nconstant bytes across all 37 belts (offset: value x count):');
const constant: string[] = [];
for (let off = 29; off < SIZE; off++) {
  const values = new Set(recs.map((b) => b[off]!));
  if (values.size === 1) constant.push(`+${off}:${[...values][0]!.toString(16).padStart(2, '0')}`);
}
console.log('  ' + constant.join(' '));

console.log('\nbytes that vary (offset: distinct value count):');
for (let off = 29; off < SIZE; off++) {
  const values = new Set(recs.map((b) => b[off]!));
  if (values.size > 1) console.log(`  +${off}: ${values.size} distinct (${[...values].slice(0, 6).join(',')})`);
}

// 4. Total: does a layout with out@33, in@37, slots@41, recipe@47, filter@49,
//    params@51 and a 4-byte trailer account for every byte?
console.log('\nproposed layout account (record = 57 bytes):');
const proposal: Array<[string, number, number]> = [
  ['pathNumber', 0, 4],
  ['index', 4, 4],
  ['itemId', 8, 2],
  ['modelIndex', 10, 2],
  ['areaIndex', 12, 1],
  ['x', 13, 4],
  ['y', 17, 4],
  ['z', 21, 4],
  ['yaw', 25, 4],
  ['outputObjectIndex', 33, 4],
  ['inputObjectIndex', 37, 4],
  ['slots', 41, 6],
  ['recipeId', 47, 2],
  ['filterId', 49, 2],
  ['parameterCount', 51, 2],
  ['trailer', 53, 4],
];
let covered = 0;
for (const [name, at, len] of proposal) {
  console.log(`  ${name.padEnd(20)} +${String(at).padStart(2)} .. +${String(at + len - 1).padStart(2)}  (${len} bytes)`);
  covered += len;
}
console.log(`  total ${covered} bytes; gap between yaw(+28) and output(+33) = 4 bytes`);
