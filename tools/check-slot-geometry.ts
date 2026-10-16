/**
 * Does a sorter's arm end land on one of its building's slot positions?
 *
 * The slot coordinates are prefab-local and the prefab is a Unity Y-up object, while a blueprint
 * stores x/y horizontal and z vertical — so landing on the right mapping is a real question, not
 * a formality. This measures the candidate mappings instead of assuming one, and reports the
 * fraction of sorter ends that land within a small tolerance of a real slot.
 *
 *   node --experimental-strip-types tools/check-slot-geometry.ts [sample]
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeBlueprint } from '../src/engine/bp/codec.ts';
import { loadDataset } from '../src/engine/loader.ts';

const ROOT = resolve(import.meta.dirname, '..');
const data = loadDataset(
  JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/dsp-vanilla.json'), 'utf8')),
  JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/building-slots.json'), 'utf8')),
);
const byId = new Map(data.buildings.map((b) => [b.id, b]));

const name = process.argv[2] ?? 'factory-v2.txt';
const decoded = await decodeBlueprint(readFileSync(resolve(ROOT, 'public/samples', name), 'utf8').trim());
const buildings = decoded.body.buildings;

const isSorter = (id: number): boolean => id >= 2011 && id <= 2014;
const isBelt = (id: number): boolean => id >= 2001 && id <= 2003;

console.log(`sample: ${name}   buildings: ${buildings.length}`);
console.log(
  `buildings carrying slot poses: ${data.buildings.filter((b) => b.sorterSlotPoses?.length).length}`,
);
console.log('');

// Which buildings in this blueprint have slot poses at all?
const withPoses = new Set(
  buildings.filter((b) => byId.get(b.itemId)?.sorterSlotPoses?.length).map((b) => b.index),
);
console.log(`blueprint buildings whose type has slot poses: ${withPoses.size}`);
console.log('');

/** Expected world positions of a building's slots under one mapping. */
function slotWorld(
  bx: number,
  by: number,
  bz: number,
  yawDeg: number,
  poses: { x: number; y: number; z: number }[],
  formula: 'a' | 'b',
  sign: 1 | -1,
): { x: number; y: number }[] {
  const r = (yawDeg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r) * sign;
  return poses.map((p) => {
    // Prefab (x, y, z) with y up  ->  blueprint offset (x, z) horizontal.
    const px = p.x;
    const py = p.z;
    const wx = formula === 'a' ? px * c - py * s : px * c + py * s;
    const wy = formula === 'a' ? px * s + py * c : -px * s + py * c;
    return { x: bx + wx, y: by + wy };
  });
}

const sorters = buildings.filter((b) => isSorter(b.itemId));
const grid = new Map<string, typeof buildings>();
const gk = (x: number, y: number): string => `${Math.floor(x)}|${Math.floor(y)}`;
for (const b of buildings) {
  const k = gk(b.x, b.y);
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k)!.push(b);
}
const near = (x: number, y: number, r = 3): typeof buildings => {
  const out: typeof buildings = [];
  for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) out.push(...(grid.get(gk(x + dx, y + dy)) ?? []));
  return out;
};

for (const formula of ['a', 'b'] as const) {
  for (const sign of [1, -1] as const) {
    let considered = 0;
    let hit = 0;
    let bestSum = 0;
    let bestWorst = 0;
    for (const s of sorters) {
      // The building this sorter touches, if any, with its nearest arm end.
      const ends: [number, number][] = [
        [s.x, s.y],
        [s.x2, s.y2],
      ];
      for (const [ex, ey] of ends) {
        const host = near(ex, ey).find(
          (c) => c !== s && withPoses.has(c.index) && Math.hypot(c.x - ex, c.y - ey) <= 4,
        );
        if (!host) continue;
        const poses = byId.get(host.itemId)!.sorterSlotPoses!;
        const world = slotWorld(host.x, host.y, host.z, host.yaw, poses, formula, sign);
        const d = Math.min(...world.map((w) => Math.hypot(w.x - ex, w.y - ey)));
        considered++;
        if (d <= 0.05) hit++;
        bestSum += d;
        bestWorst = Math.max(bestWorst, d);
      }
    }
    const pct = considered ? ((hit / considered) * 100).toFixed(1) : 'n/a';
    const mean = considered ? (bestSum / considered).toFixed(3) : 'n/a';
    console.log(
      `formula ${formula} sign ${String(sign).padStart(2)}:  ends=${String(considered).padStart(5)}  ` +
        `within 0.05 cells=${pct.padStart(5)}%  mean dist=${mean}  worst=${bestWorst.toFixed(1)}`,
    );
  }
}

console.log('');
console.log('=== distance histogram for the best-looking mapping (formula a, sign -1) ===');
const hist = new Map<string, number>();
for (const s of sorters) {
  for (const [ex, ey] of [
    [s.x, s.y],
    [s.x2, s.y2],
  ] as [number, number][]) {
    const host = near(ex, ey).find((c) => c !== s && withPoses.has(c.index) && Math.hypot(c.x - ex, c.y - ey) <= 4);
    if (!host) continue;
    const poses = byId.get(host.itemId)!.sorterSlotPoses!;
    const world = slotWorld(host.x, host.y, host.z, host.yaw, poses, 'a', -1);
    const d = Math.min(...world.map((w) => Math.hypot(w.x - ex, w.y - ey)));
    const b = d <= 0.05 ? '0' : d <= 0.2 ? '0-0.2' : d <= 0.5 ? '0.2-0.5' : d <= 1 ? '0.5-1' : d <= 2 ? '1-2' : '>2';
    hist.set(b, (hist.get(b) ?? 0) + 1);
  }
}
for (const b of ['0', '0-0.2', '0.2-0.5', '0.5-1', '1-2', '>2']) {
  const n = hist.get(b) ?? 0;
  if (n) console.log(`  ${b.padEnd(8)} ${n}`);
}
