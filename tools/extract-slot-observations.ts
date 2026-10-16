/**
 * Extracts sorter-to-slot observations from a real game blueprint.
 *
 * This is the empirical route to slot geometry: a blueprint records, for every
 * sorter, its cell, which object it pulls from and pushes to (with those objects'
 * cells, so the direction is exact), and which slot index it used on each end. So
 * every record is one labelled observation of "building at origin, direction d,
 * slot index n", and enough of them pin down where each slot physically sits.
 *
 *   node --experimental-strip-types tools/extract-slot-observations.ts [blueprint.txt]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { base64ToBytes, decodeBody } from '../src/engine/bp/codec.ts';
import { gunzipBytes } from '../src/engine/bp/gzip.ts';

const ROOT = resolve(import.meta.dirname, '..');
const path =
  process.argv[2] ??
  resolve(ROOT, 'docs/research/_raw/realbp/仙术_Illegal_仙_无带堆叠锅13824.txt.txt');

const text = readFileSync(resolve(path), 'utf8').trim();
const body = text.slice('BLUEPRINT:'.length);
const closeQuote = body.lastIndexOf('"');
const prefix = body.slice(0, closeQuote);
const token = prefix.slice(prefix.lastIndexOf(',') + 1);
const raw = await gunzipBytes(base64ToBytes(token.slice(token.indexOf('"') + 1)));
const parsed = decodeBody(raw);

const buildings = parsed.buildings;
const byIndex = new Map(buildings.map((b) => [b.index, b]));

console.log(`buildings: ${buildings.length}`);
console.log(`areas    : ${parsed.areas.length}`);
console.log(`layout   : ${parsed.layout}`);

// Prototype histogram, so it is clear what this blueprint contains.
const byProto = new Map<number, number>();
for (const b of buildings) byProto.set(b.itemId, (byProto.get(b.itemId) ?? 0) + 1);
const top = [...byProto.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
console.log('\ntop prototypes:');
for (const [id, n] of top) console.log(`  itemId ${String(id).padStart(5)}  ${String(n).padStart(5)}`);

// Sorters are 2010 < itemId < 2020.
const sorters = buildings.filter((b) => b.itemId > 2010 && b.itemId < 2020);
console.log(`\nsorters: ${sorters.length}`);

interface Observation {
  sorterIndex: number;
  sorterItem: number;
  x: number;
  y: number;
  outputToSlot: number;
  inputFromSlot: number;
  outputFromSlot: number;
  inputToSlot: number;
  /** Target building (what this sorter feeds). */
  toIndex: number;
  toItem: number;
  toX: number;
  toY: number;
  /** Source building (what this sorter pulls from). */
  fromIndex: number;
  fromItem: number;
  fromX: number;
  fromY: number;
}

const observations: Observation[] = [];
for (const s of sorters) {
  const to = s.inputObjectIndex >= 0 ? byIndex.get(s.inputObjectIndex) : undefined;
  const from = s.outputObjectIndex >= 0 ? byIndex.get(s.outputObjectIndex) : undefined;
  observations.push({
    sorterIndex: s.index,
    sorterItem: s.itemId,
    x: s.x,
    y: s.y,
    outputToSlot: s.outputToSlot,
    inputFromSlot: s.inputFromSlot,
    outputFromSlot: s.outputFromSlot,
    inputToSlot: s.inputToSlot,
    toIndex: to?.index ?? -1,
    toItem: to?.itemId ?? -1,
    toX: to?.x ?? NaN,
    toY: to?.y ?? NaN,
    fromIndex: from?.index ?? -1,
    fromItem: from?.itemId ?? -1,
    fromX: from?.x ?? NaN,
    fromY: from?.y ?? NaN,
  });
}

console.log(`\nslot index values observed:`);
for (const field of ['outputToSlot', 'inputFromSlot', 'outputFromSlot', 'inputToSlot'] as const) {
  const hist = new Map<number, number>();
  for (const o of observations) hist.set(o[field], (hist.get(o[field]) ?? 0) + 1);
  const entries = [...hist.entries()].sort((a, b) => a[0] - b[0]);
  console.log(`  ${field.padEnd(15)} ${entries.map(([v, n]) => `${v}:${n}`).join('  ')}`);
}

// For each prototype that receives from a sorter, report the target-relative
// direction per slot index. That is the actual slot geometry signal.
interface Bucket {
  count: number;
  byDirection: Map<string, number>;
}
const geometry = new Map<string, Bucket>();
for (const o of observations) {
  if (o.toIndex < 0) continue;
  const dx = Math.round((o.x - o.toX) * 100) / 100;
  const dy = Math.round((o.y - o.toY) * 100) / 100;
  const key = `${o.toItem}|${o.inputFromSlot}`;
  const bucket = geometry.get(key) ?? { count: 0, byDirection: new Map() };
  bucket.count++;
  const dir = `${dx},${dy}`;
  bucket.byDirection.set(dir, (bucket.byDirection.get(dir) ?? 0) + 1);
  geometry.set(key, bucket);
}

const targetProtos = [...new Set([...geometry.keys()].map((k) => Number(k.split('|')[0])))].sort((a, b) => a - b);
console.log(`\nslot geometry by (receiving prototype, inputFromSlot) — sorter offset from the building centre:`);
for (const proto of targetProtos.slice(0, 10)) {
  const rows = [...geometry.entries()].filter(([k]) => Number(k.split('|')[0]) === proto);
  console.log(`  prototype ${proto}:`);
  for (const [key, bucket] of rows.sort((a, b) => Number(a[0].split('|')[1]) - Number(b[0].split('|')[1]))) {
    const slot = key.split('|')[1] ?? '?';
    const dirs = [...bucket.byDirection.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([d, n]) => `${d}(${n})`)
      .join(' ');
    console.log(`    slot ${slot.padStart(2)}  n=${String(bucket.count).padStart(4)}  offsets: ${dirs}`);
  }
}

const out = resolve(ROOT, 'docs/research/slot-observations.json');
writeFileSync(out, JSON.stringify({ source: path, total: observations.length, observations }, null, 1));
console.log(`\nwrote ${observations.length} observations to ${out}`);
