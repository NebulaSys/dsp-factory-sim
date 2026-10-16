/**
 * Calibrate prefab-local slot coordinates into blueprint coordinates.
 *
 * The slot points come from the Unity prefab, which is a Y-up object, while a blueprint stores
 * x/y horizontal and z vertical. Three things are therefore unknown and must be fitted rather
 * than assumed: the axis mapping, the yaw convention (zero axis and sign), and any constant
 * offset between the prefab root and the building's blueprint origin.
 *
 * Rather than guess, this collects (building yaw, sorter arm end relative to the building) pairs
 * from real blueprints and scores each candidate transform by how many arm ends land on a real
 * slot. It also prints a worked example so the transform can be eyeballed.
 *
 *   node --experimental-strip-types tools/calibrate-slots.ts [--corpus|--sample <name>]
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

interface B {
  index: number;
  itemId: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  x2: number;
  y2: number;
}

const useCorpus = process.argv.includes('--corpus');
const files: { name: string; path: string }[] = [];
if (useCorpus) {
  const dir = resolve(ROOT, 'docs/research/_raw/realbp');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.txt'))) files.push({ name: f, path: resolve(dir, f) });
} else {
  const dir = resolve(ROOT, 'public/samples');
  const wanted = process.argv.includes('--sample') ? process.argv[process.argv.indexOf('--sample') + 1] : null;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.txt'))) {
    if (wanted && !f.includes(wanted)) continue;
    files.push({ name: f, path: resolve(dir, f) });
  }
}

interface Pair {
  file: string;
  sorterIndex: number;
  hostKey: string;
  yaw: number;
  /** Arm ends relative to the host building's origin. */
  ea: { x: number; y: number };
  eb: { x: number; y: number };
  /** Slot points of the host, prefab-local. */
  slots: { x: number; y: number; z: number }[];
}

const pairs: Pair[] = [];
let sorterCount = 0;
let withHost = 0;

for (const f of files) {
  let bs: B[];
  try {
    bs = (await decodeBlueprint(readFileSync(f.path, 'utf8').trim())).body.buildings as unknown as B[];
  } catch {
    continue;
  }
  for (const s of bs) {
    if (!isSorter(s.itemId)) continue;
    sorterCount++;
    const hosts = bs.filter((c) => {
      if (c === s) return false;
      const def = byId.get(c.itemId);
      if (!def?.sorterSlotPoses?.length || !def.footprint) return false;
      // The host must actually contain the sorter's arm end, allowing a small overshoot.
      const hw = def.footprint.w / 2 + 0.6;
      const hh = def.footprint.h / 2 + 0.6;
      return (
        (Math.abs(s.x - c.x) <= hw && Math.abs(s.y - c.y) <= hh) ||
        (Math.abs(s.x2 - c.x) <= hw && Math.abs(s.y2 - c.y) <= hh)
      );
    });
    const host = hosts[0];
    if (!host) continue;
    withHost++;
    const def = byId.get(host.itemId)!;
    pairs.push({
      file: f.name,
      sorterIndex: s.index,
      hostKey: def.key,
      yaw: host.yaw,
      ea: { x: s.x - host.x, y: s.y - host.y },
      eb: { x: s.x2 - host.x, y: s.y2 - host.y },
      slots: def.sorterSlotPoses!,
    });
  }
}

console.log(`blueprints scanned: ${files.length}`);
console.log(`sorters: ${sorterCount}   with a slot-bearing host: ${withHost}`);
const byHost = new Map<string, number>();
for (const p of pairs) byHost.set(p.hostKey, (byHost.get(p.hostKey) ?? 0) + 1);
console.log('hosts:', [...byHost.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  '));
console.log('');

if (pairs.length === 0) {
  console.log('No sorter arm end lands inside a slot-bearing building, so there is nothing to fit.');
  process.exit(0);
}

/** Apply one candidate transform to a prefab-local slot point: returns a blueprint-plane offset. */
function place(
  p: { x: number; y: number; z: number },
  yawDeg: number,
  axis: 'xz' | 'zx',
  sign: 1 | -1,
): { x: number; y: number } {
  const px = axis === 'xz' ? p.x : p.z;
  const py = axis === 'xz' ? p.z : p.x;
  const r = (yawDeg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r) * sign;
  return { x: px * c - py * s, y: px * s + py * c };
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

console.log('=== scoring transforms (an arm end is correct when it lands on a slot) ===');
console.log('axis  sign   end   within 0.05    within 0.25    mean dist');
let best = { score: -1, desc: '' };
for (const axis of ['xz', 'zx'] as const) {
  for (const sign of [1, -1] as const) {
    for (const which of ['a', 'b'] as const) {
      let hit = 0;
      let near = 0;
      let sum = 0;
      for (const p of pairs) {
        const e = which === 'a' ? p.ea : p.eb;
        const world = p.slots.map((sp) => place(sp, p.yaw, axis, sign));
        const d = Math.min(...world.map((w) => dist(w, e)));
        sum += d;
        if (d <= 0.05) hit++;
        if (d <= 0.25) near++;
      }
      const pct = ((hit / pairs.length) * 100).toFixed(1);
      const pctNear = ((near / pairs.length) * 100).toFixed(1);
      const mean = (sum / pairs.length).toFixed(3);
      console.log(
        `${axis}   ${String(sign).padStart(2)}   ${which}    ${pct.padStart(6)}%        ${pctNear.padStart(6)}%       ${mean}`,
      );
      if (hit > best.score) best = { score: hit, desc: `${axis} sign=${sign} end=${which}` };
    }
  }
}

console.log('');
console.log(`best: ${best.desc}  (${best.score} / ${pairs.length} within 0.05)`);
console.log('');
console.log('=== worked example: the first 6 pairs ===');
for (const p of pairs.slice(0, 6)) {
  console.log(`  ${p.file.slice(0, 34)}  sorter #${p.sorterIndex} -> ${p.hostKey}  yaw=${p.yaw}`);
  console.log(`      endA=(${p.ea.x.toFixed(3)}, ${p.ea.y.toFixed(3)})  endB=(${p.eb.x.toFixed(3)}, ${p.eb.y.toFixed(3)})`);
  console.log(
    `      slots(axis xz) = ${p.slots.map((s) => `(${s.x.toFixed(2)},${s.z.toFixed(2)})`).join(' ')}`,
  );
}
