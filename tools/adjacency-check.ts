/**
 * Is a sorter's linked object geometrically adjacent to it?
 *
 * The raw distance test said no, but raw distance is only meaningful inside one area: a
 * blueprint can hold several areas, and each has its own local coordinate frame. This restricts
 * the comparison to the same area and, for each sorter, looks for the referenced building among
 * the buildings actually within sorter reach.
 *
 *   node --experimental-strip-types tools/adjacency-check.ts [sample]
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeBlueprint } from '../src/engine/bp/codec.ts';

const ROOT = resolve(import.meta.dirname, '..');
const name = process.argv[2] ?? 'factory-v2.txt';
const decoded = await decodeBlueprint(readFileSync(resolve(ROOT, 'public/samples', name), 'utf8').trim());
const buildings = decoded.body.buildings;

const belt = (id: number): boolean => id >= 2001 && id <= 2003;
const sorter = (id: number): boolean => id >= 2011 && id <= 2014;
const kind = (id: number): string => (belt(id) ? 'belt' : sorter(id) ? 'sorter' : 'machine');
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

console.log(`sample: ${name}  buildings: ${buildings.length}`);
console.log('layout keys:', Object.keys(decoded).join(', '));
const areas = decoded.body.areas ?? [];
console.log(`areas: ${areas.length}`);
for (const a of areas) {
  console.log(
    `  #${a.index} parent=${a.parentIndex} anchor=(${a.anchorLocalOffsetX},${a.anchorLocalOffsetY}) ` +
      `size=${a.width}x${a.height} tropicAnchor=${a.tropicAnchor}`,
  );
}

const areaCounts = new Map<number, number>();
for (const b of buildings) areaCounts.set(b.areaIndex, (areaCounts.get(b.areaIndex) ?? 0) + 1);
console.log('buildings per areaIndex:', [...areaCounts.entries()].sort().map(([k, v]) => `${k}:${v}`).join('  '));
console.log('');

const sorters = buildings.filter((b) => sorter(b.itemId));

// Spatial index per area so the nearest-neighbour lookup stays linear.
const cellKey = (a: number, x: number, y: number): string => `${a}|${Math.round(x)}|${Math.round(y)}`;
const grid = new Map<string, typeof buildings>();
for (const b of buildings) {
  const k = cellKey(b.areaIndex, b.x, b.y);
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k)!.push(b);
}
const neighbours = (b: (typeof buildings)[number], reach = 3): typeof buildings => {
  const out: typeof buildings = [];
  for (let dx = -reach; dx <= reach; dx++) {
    for (let dy = -reach; dy <= reach; dy++) {
      for (const c of grid.get(cellKey(b.areaIndex, b.x + dx, b.y + dy)) ?? []) {
        if (c !== b && dist(b, c) <= reach + 0.6) out.push(c);
      }
    }
  }
  return out;
};

let outHit = 0;
let inHit = 0;
let eitherHit = 0;
let neither = 0;
const reachHist = new Map<number, number>();
const examples: string[] = [];

for (const s of sorters) {
  const near = neighbours(s);
  const o = s.outputObjectIndex >= 0 ? buildings[s.outputObjectIndex] : undefined;
  const i = s.inputObjectIndex >= 0 ? buildings[s.inputObjectIndex] : undefined;
  const hitO = o !== undefined && near.includes(o);
  const hitI = i !== undefined && near.includes(i);
  if (hitO) outHit++;
  if (hitI) inHit++;
  if (hitO || hitI) eitherHit++;
  else {
    neither++;
    if (examples.length < 6) {
      examples.push(
        `  sorter #${s.index} area=${s.areaIndex} (${s.x.toFixed(1)},${s.y.toFixed(1)},${s.z.toFixed(1)})\n` +
          `     out=${s.outputObjectIndex} ${o ? `#${o.index} ${kind(o.itemId)} area=${o.areaIndex} (${o.x.toFixed(1)},${o.y.toFixed(1)},${o.z.toFixed(1)})` : 'n/a'}\n` +
          `     in =${s.inputObjectIndex} ${i ? `#${i.index} ${kind(i.itemId)} area=${i.areaIndex} (${i.x.toFixed(1)},${i.y.toFixed(1)},${i.z.toFixed(1)})` : 'n/a'}\n` +
          `     neighbours within 3 cells: ${near
            .slice(0, 5)
            .map((c) => `#${c.index} ${kind(c.itemId)} d=${dist(s, c).toFixed(1)}`)
            .join(', ')}`,
      );
    }
  }
  // How far is the nearest neighbour of each kind?
  for (const kindName of ['belt', 'sorter', 'machine'] as const) {
    const same = near.filter((c) => (kindName === 'belt' ? belt(c.itemId) : kindName === 'sorter' ? sorter(c.itemId) : !belt(c.itemId) && !sorter(c.itemId)));
    if (same.length === 0) continue;
    const d = Math.min(...same.map((c) => dist(s, c)));
    reachHist.set(Math.round(d * 2) / 2, (reachHist.get(Math.round(d * 2) / 2) ?? 0) + 1);
  }
}

console.log(`sorters: ${sorters.length}`);
console.log(`  outputObjectIndex is a same-area neighbour: ${outHit}`);
console.log(`  inputObjectIndex  is a same-area neighbour: ${inHit}`);
console.log(`  at least one link resolves:                 ${eitherHit}`);
console.log(`  neither resolves:                           ${neither}`);
console.log('');
if (examples.length) {
  console.log('=== unresolved examples ===');
  for (const e of examples) console.log(e);
  console.log('');
}
console.log('=== nearest same-area neighbour distance (any kind) ===');
for (const [d, c] of [...reachHist.entries()].sort((a, b) => a[0] - b[0]).slice(0, 12)) {
  console.log(`  ${d.toFixed(1)} cells : ${c}`);
}
