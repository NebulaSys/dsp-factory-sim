/**
 * Is the slot/arm-end mismatch only a ROTATION problem?
 *
 * The global translation fit topped out at 4.8%, but ThermalPowerPlant alone reached 14.4% while
 * being split across yaw 0/90/180/270 — and roughly a quarter of its samples have yaw 0. That is
 * the signature of a correct translation with a wrong rotation: the unrotated cases fit, the
 * rest do not.
 *
 * This fits each yaw bucket separately. If yaw 0 fits well and the others do not, the offset is
 * solved and only the rotation convention remains.
 *
 *   node --experimental-strip-types tools/fit-by-yaw.ts
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

interface P {
  yaw: number;
  ex: number;
  ey: number;
  slots: { x: number; y: number; z: number }[];
}

const pairs: P[] = [];
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
      for (const [px, py] of [
        [s.x, s.y],
        [s.x2, s.y2],
      ] as [number, number][]) {
        if (Math.abs(px - c.x) > hw || Math.abs(py - c.y) > hh) continue;
        pairs.push({ yaw: Math.round(c.yaw), ex: px - c.x, ey: py - c.y, slots: def.sorterSlotPoses });
      }
    }
  }
}

console.log(`pairs: ${pairs.length}`);
const yaws = [...new Set(pairs.map((p) => p.yaw))].sort((a, b) => a - b);
console.log(`yaw values present: ${yaws.join(', ')}`);
console.log('');

const nearest = (p: P, dx: number, dy: number): number =>
  Math.min(...p.slots.map((s) => Math.hypot(s.x + dx - p.ex, s.z + dy - p.ey)));

console.log('=== per yaw, using the RAW offsets (no rotation applied) ===');
console.log('yaw     n     within0.05   within0.25   median   best dx,dy (hit%)');
for (const yaw of yaws) {
  const sub = pairs.filter((p) => p.yaw === yaw);
  const ds = sub.map((p) => nearest(p, 0, 0)).sort((a, b) => a - b);
  const h = (t: number): string => ((ds.filter((d) => d <= t).length / ds.length) * 100).toFixed(1).padStart(5);
  // Best translation for this bucket.
  let best = { hit: -1, dx: 0, dy: 0 };
  for (let dx = -3; dx <= 3 + 1e-9; dx += 0.05) {
    for (let dy = -3; dy <= 3 + 1e-9; dy += 0.05) {
      let hit = 0;
      for (const p of sub) if (nearest(p, dx, dy) <= 0.05) hit++;
      if (hit > best.hit) best = { hit, dx, dy };
    }
  }
  console.log(
    `${String(yaw).padStart(3)}  ${String(sub.length).padStart(6)}      ${h(0.05)}%       ${h(0.25)}%   ` +
      `${ds[Math.floor(ds.length / 2)]!.toFixed(3)}   dx=${best.dx.toFixed(2)} dy=${best.dy.toFixed(2)} (${((best.hit / sub.length) * 100).toFixed(1)}%)`,
  );
}

console.log('');
console.log('=== yaw 0 only, restricted to hosts with a square footprint ===');
const yaw0 = pairs.filter((p) => p.yaw === 0);
let best = { hit: -1, dx: 0, dy: 0 };
for (let dx = -4; dx <= 4 + 1e-9; dx += 0.05) {
  for (let dy = -4; dy <= 4 + 1e-9; dy += 0.05) {
    let hit = 0;
    for (const p of yaw0) if (nearest(p, dx, dy) <= 0.05) hit++;
    if (hit > best.hit) best = { hit, dx, dy };
  }
}
console.log(
  `yaw0 n=${yaw0.length}  best dx=${best.dx.toFixed(2)} dy=${best.dy.toFixed(2)}  ` +
    `${best.hit}/${yaw0.length} (${((best.hit / yaw0.length) * 100).toFixed(1)}%)`,
);
