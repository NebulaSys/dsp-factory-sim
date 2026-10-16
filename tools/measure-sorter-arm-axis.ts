/**
 * Split a sorter's own arm span into its horizontal and vertical parts.
 *
 * The record stores both arm ends; the 3D distance between them is 1-3 cells for 99.8% of
 * sorters. But a 3-cell span could be three cells *across* or three cells *up* — and a stacked
 * blueprint's sorter moving items between layers would be the latter. The renderer's choice
 * between a horizontal arm and a layer-transfer glyph depends on which it is, so measure it.
 *
 *   node --experimental-strip-types tools/measure-sorter-arm-axis.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeBlueprint } from '../src/engine/bp/codec.ts';

const ROOT = resolve(import.meta.dirname, '..');
const isSorter = (id: number): boolean => id >= 2011 && id <= 2014;

const buckets = new Map<string, number>();
let total = 0;
const samples: string[] = [];

for (const f of readdirSync(resolve(ROOT, 'docs/research/_raw/realbp')).filter((x) => x.endsWith('.txt'))) {
  let bs: { index: number; itemId: number; x: number; y: number; z: number; x2: number; y2: number; z2: number }[];
  try {
    bs = (await decodeBlueprint(readFileSync(resolve(ROOT, 'docs/research/_raw/realbp', f), 'utf8').trim()))
      .body.buildings as unknown as typeof bs;
  } catch {
    continue;
  }
  for (const s of bs) {
    if (!isSorter(s.itemId)) continue;
    total++;
    const h = Math.hypot(s.x2 - s.x, s.y2 - s.y);
    const v = Math.abs(s.z2 - s.z);
    const key =
      v < 0.05 && h >= 0.5 ? `horizontal ${h.toFixed(0)}` : h < 0.05 && v >= 0.05 ? `vertical ${v.toFixed(1)}` : h >= 0.05 && v >= 0.05 ? 'mixed' : 'degenerate';
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
    if (samples.length < 6 && key.startsWith('horizontal')) {
      samples.push(`#${s.index} (${s.x},${s.y},${s.z}) -> (${s.x2},${s.y2},${s.z2})  h=${h.toFixed(2)} v=${v.toFixed(2)}`);
    }
  }
}
// Also include the bundled samples.
for (const f of readdirSync(resolve(ROOT, 'public/samples')).filter((x) => x.endsWith('.txt'))) {
  let bs: { index: number; itemId: number; x: number; y: number; z: number; x2: number; y2: number; z2: number }[];
  try {
    bs = (await decodeBlueprint(readFileSync(resolve(ROOT, 'public/samples', f), 'utf8').trim()))
      .body.buildings as unknown as typeof bs;
  } catch {
    continue;
  }
  for (const s of bs) {
    if (!isSorter(s.itemId)) continue;
    total++;
    const h = Math.hypot(s.x2 - s.x, s.y2 - s.y);
    const v = Math.abs(s.z2 - s.z);
    const key =
      v < 0.05 && h >= 0.5 ? `horizontal ${h.toFixed(0)}` : h < 0.05 && v >= 0.05 ? `vertical ${v.toFixed(1)}` : h >= 0.05 && v >= 0.05 ? 'mixed' : 'degenerate';
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
}

console.log(`sorters: ${total}`);
console.log('');
for (const [k, n] of [...buckets.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(16)} ${String(n).padStart(6)}  ${((n / total) * 100).toFixed(1)}%`);
}
console.log('');
console.log('horizontal examples:');
for (const s of samples) console.log(`  ${s}`);
