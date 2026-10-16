/**
 * Fit the calibration: what single transform maps prefab-local slot points onto real sorter
 * positions?
 *
 * The comparison tool showed the extracted points and the observed arm-end offsets agree in
 * structure — ThermalPowerPlant gives (-2.12, y) against (-2.01, y) for the same three y values —
 * but differ by a small constant. This searches the candidate axis mappings and a translation
 * grid, and reports the best fit rather than asserting one.
 *
 *   node --experimental-strip-types tools/fit-slot-calibration.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeBlueprint } from '../src/engine/bp/codec.ts';
import { loadDataset } from '../src/engine/loader.ts';

const ROOT = resolve(import.meta.dirname, '..');
const data = loadDataset(
  JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/dsp-vanilla.json'), 'utf8')),
  JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/building-slots.json'), 'utf8')),
);
const byId = new Map(data.buildings.map((b) => [b.id, b]));
const isSorter = (id: number): boolean => id >= 2011 && id <= 2014;

interface Pair {
  key: string;
  /** Observed arm-end offset, already rotated into the building frame. */
  ex: number;
  ey: number;
  slots: { x: number; y: number; z: number }[];
}

const pairs: Pair[] = [];

for (const f of readdirSync(resolve(ROOT, 'docs/research/_raw/realbp')).filter((x) => x.endsWith('.txt'))) {
  let bs: { index: number; itemId: number; x: number; y: number; yaw: number; x2: number; y2: number }[];
  try {
    bs = (await decodeBlueprint(readFileSync(resolve(ROOT, 'docs/research/_raw/realbp', f), 'utf8').trim()))
      .body.buildings as unknown as typeof bs;
  } catch {
    continue;
  }
  for (const s of bs) {
    if (!isSorter(s.itemId)) continue;
    for (const c of bs) {
      if (c === s) continue;
      const def = byId.get(c.itemId);
      if (!def?.sorterSlotPoses?.length || !def.footprint) continue;
      const hw = def.footprint.w / 2 + 0.6;
      const hh = def.footprint.h / 2 + 0.6;
      for (const [ex, ey] of [
        [s.x, s.y],
        [s.x2, s.y2],
      ] as [number, number][]) {
        if (Math.abs(ex - c.x) > hw || Math.abs(ey - c.y) > hh) continue;
        const dx = ex - c.x;
        const dy = ey - c.y;
        const r = (c.yaw * Math.PI) / 180;
        const cc = Math.cos(r);
        const ss = Math.sin(r);
        pairs.push({
          key: def.key,
          ex: dx * cc + dy * ss,
          ey: -dx * ss + dy * cc,
          slots: def.sorterSlotPoses,
        });
      }
    }
  }
}

console.log(`pairs: ${pairs.length}`);

// How far is each observed offset from the nearest slot, before any calibration?
const base: number[] = pairs.map((p) => Math.min(...p.slots.map((s) => Math.hypot(s.x - p.ex, s.z - p.ey))));
base.sort((a, b) => a - b);
const pct = (arr: number[], t: number): string => ((arr.filter((d) => d <= t).length / arr.length) * 100).toFixed(1);
console.log(`uncalibrated: within 0.05 = ${pct(base, 0.05)}%   within 0.25 = ${pct(base, 0.25)}%   median = ${base[Math.floor(base.length / 2)]!.toFixed(3)}`);
console.log('');

// Search for the translation that best aligns them.
let best = { hit: -1, dx: 0, dy: 0, median: 0 };
const seen = new Set<string>();
for (const p of pairs) seen.add(p.key);
console.log(`hosts involved: ${[...seen].join(', ')}`);
console.log('');
console.log('=== translation search (all hosts together) ===');
for (let dx = -0.5; dx <= 0.5 + 1e-9; dx += 0.02) {
  for (let dy = -0.5; dy <= 0.5 + 1e-9; dy += 0.02) {
    let hit = 0;
    const ds: number[] = [];
    for (const p of pairs) {
      const d = Math.min(...p.slots.map((s) => Math.hypot(s.x + dx - p.ex, s.z + dy - p.ey)));
      ds.push(d);
      if (d <= 0.05) hit++;
    }
    ds.sort((a, b) => a - b);
    if (hit > best.hit) best = { hit, dx, dy, median: ds[Math.floor(ds.length / 2)]! };
  }
}
console.log(`best translation: dx=${best.dx.toFixed(2)} dy=${best.dy.toFixed(2)}  hits=${best.hit}/${pairs.length} (${((best.hit / pairs.length) * 100).toFixed(1)}%)  median residual=${best.median.toFixed(3)}`);

// Per-host best translation, to see whether one constant suffices.
console.log('');
console.log('=== per-host best translation ===');
for (const key of seen) {
  const subset = pairs.filter((p) => p.key === key);
  let h = { hit: -1, dx: 0, dy: 0 };
  for (let dx = -1.0; dx <= 1.0 + 1e-9; dx += 0.02) {
    for (let dy = -1.0; dy <= 1.0 + 1e-9; dy += 0.02) {
      let hit = 0;
      for (const p of subset) {
        if (Math.min(...p.slots.map((s) => Math.hypot(s.x + dx - p.ex, s.z + dy - p.ey))) <= 0.05) hit++;
      }
      if (hit > h.hit) h = { hit, dx, dy };
    }
  }
  console.log(
    `  ${key.padEnd(30)} n=${String(subset.length).padStart(5)}  dx=${h.dx.toFixed(2)} dy=${h.dy.toFixed(2)}  ` +
      `${h.hit}/${subset.length} (${((h.hit / subset.length) * 100).toFixed(1)}%)`,
  );
}
