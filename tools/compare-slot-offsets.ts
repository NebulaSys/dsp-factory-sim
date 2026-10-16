/**
 * Compare where sorter arms actually sit on a building against where the extracted slots are.
 *
 * If the two sets are the same up to a rigid offset, the offset is the calibration and can be
 * solved. If they are not congruent at all, the extracted points are not the attachment points
 * and no transform will fix it — which is the more important thing to know.
 *
 *   node --experimental-strip-types tools/compare-slot-offsets.ts
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

const observed = new Map<string, Map<string, number>>();
const hostYaws = new Map<string, Set<number>>();

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
      const inside = (px: number, py: number): boolean => Math.abs(px - c.x) <= hw && Math.abs(py - c.y) <= hh;
      const ends: [number, number][] = [
        [s.x, s.y],
        [s.x2, s.y2],
      ];
      for (const [ex, ey] of ends) {
        if (!inside(ex, ey)) continue;
        // Rotate the observed offset back into the building's own frame.
        const dx = ex - c.x;
        const dy = ey - c.y;
        const r = (c.yaw * Math.PI) / 180;
        const cc = Math.cos(r);
        const ss = Math.sin(r);
        const lx = dx * cc + dy * ss;
        const ly = -dx * ss + dy * cc;
        const k = def.key;
        if (!observed.has(k)) observed.set(k, new Map());
        const key = `${lx.toFixed(2)},${ly.toFixed(2)}`;
        observed.get(k)!.set(key, (observed.get(k)!.get(key) ?? 0) + 1);
        if (!hostYaws.has(k)) hostYaws.set(k, new Set());
        hostYaws.get(k)!.add(Math.round(c.yaw));
      }
    }
  }
}

for (const [key, counts] of [...observed.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 4)) {
  const def = data.buildings.find((b) => b.key === key)!;
  console.log(`=== ${key}   footprint=${def.footprint?.w}x${def.footprint?.h}   slots=${def.sorterSlotPoses!.length}`);
  console.log(`    host yaws seen: ${[...(hostYaws.get(key) ?? [])].sort((a, b) => a - b).join(', ')}`);
  console.log('    observed arm-end offsets (rotated into the building frame), most common first:');
  for (const [k, n] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
    console.log(`      (${k})  x${n}`);
  }
  console.log('    extracted slot points (x, z):');
  console.log('      ' + def.sorterSlotPoses!.map((p) => `(${p.x.toFixed(2)},${p.z.toFixed(2)})`).join(' '));
  console.log('');
}
