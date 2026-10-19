/**
 * Who USES the link fields, and what do they point at?  (follow-up to analyze-port-links.ts)
 *
 * The domain rule is: most buildings expose several input/output ports; a port can take an input-
 * or output-sorter; and stacking onto a Splitter adds a port. So a port->sorter reference should
 * (a) be written by the building that owns the port, or by the sorter standing on it, and
 * (b) usually point at something adjacent.
 *
 * analyze-port-links.ts found NO sorter is ever a link TARGET, which is hard to square with a
 * direct port->sorter pointer. This splits the numbers by the OWNER's category and prints the raw
 * slot values, which is what distinguishes "these fields are the port->sorter link" from
 * "these fields are something else and the sorter attachment is implicit in geometry".
 *
 *   node --experimental-strip-types tools/analyze-port-links-by-owner.ts
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
const SORTER = new Set([2011, 2012, 2013, 2014]);
const BELT = new Set([2001, 2002, 2003]);
const SPLITTER = 2020;
const cat = new Map(data.buildings.map((b) => [b.id, b.category]));
const fp = new Map(data.buildings.map((b) => [b.id, b.footprint]));
const kindOf = (id: number): string =>
  SORTER.has(id) ? 'sorter' : BELT.has(id) ? 'belt' : id === SPLITTER ? 'splitter' : (cat.get(id) ?? '?');

const distToBox = (px: number, py: number, bx: number, by: number, bw: number, bh: number): number => {
  const dx = Math.max(0, Math.abs(px - bx) - bw / 2);
  const dy = Math.max(0, Math.abs(py - by) - bh / 2);
  return Math.hypot(dx, dy);
};

interface OwnerStat {
  n: number;
  withOut: number;
  withIn: number;
  targets: Map<string, number>;
  dists: number[];
  slotVals: number[];
}
const owners = new Map<string, OwnerStat>();
const stat = (k: string): OwnerStat => {
  let s = owners.get(k);
  if (!s) {
    s = { n: 0, withOut: 0, withIn: 0, targets: new Map(), dists: [], slotVals: [] };
    owners.set(k, s);
  }
  return s;
};
const slotHist = new Map<number, number>();
const offsetVals = new Set<number>();
let files = 0;

for (const dir of ['docs/research/_raw/realbp', 'docs/research/_raw/realbp2']) {
  let names: string[] = [];
  try {
    names = readdirSync(resolve(ROOT, dir)).filter((f) => f.endsWith('.txt'));
  } catch {
    continue;
  }
  for (const f of names) {
    let bp;
    try {
      bp = await decodeBlueprint(readFileSync(resolve(ROOT, dir, f), 'utf8').trim());
    } catch {
      continue;
    }
    files++;
    const byIndex = new Map(bp.body.buildings.map((b) => [b.index, b]));
    for (const b of bp.body.buildings) {
      const k = kindOf(b.itemId);
      const s = stat(k);
      s.n++;
      for (const [v, isOut] of [
        [b.outputObjectIndex, true],
        [b.inputObjectIndex, false],
      ] as const) {
        if (v === -1) continue;
        if (isOut) s.withOut++;
        else s.withIn++;
        const t = byIndex.get(v);
        if (!t) {
          s.targets.set('out-of-range', (s.targets.get('out-of-range') ?? 0) + 1);
          continue;
        }
        s.targets.set(kindOf(t.itemId), (s.targets.get(kindOf(t.itemId)) ?? 0) + 1);
        const fpb = fp.get(b.itemId) ?? { w: 1, h: 1 };
        s.dists.push(distToBox(t.x, t.y, b.x, b.y, fpb.w, fpb.h));
      }
      // raw slot values, to see whether they are small per-port indices or something else
      for (const v of [b.outputToSlot, b.inputFromSlot, b.outputFromSlot, b.inputToSlot]) {
        slotHist.set(v, (slotHist.get(v) ?? 0) + 1);
      }
      offsetVals.add(b.outputOffset);
      offsetVals.add(b.inputOffset);
    }
  }
}

console.log(`files: ${files}\n`);
console.log('=== owners of the link fields, by category ===');
const rows = [...owners.entries()].sort((a, b) => b[1].n - a[1].n);
for (const [k, s] of rows) {
  const used = s.withOut + s.withIn;
  const targets = [...s.targets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t, c]) => `${t}:${c}`).join(' ');
  const d = s.dists.slice().sort((a, b) => a - b);
  const p50 = d.length ? d[Math.floor(d.length / 2)]!.toFixed(2) : '-';
  const near = d.length ? ((d.filter((x) => x <= 3.05).length / d.length) * 100).toFixed(0) + '%' : '-';
  console.log(
    `  ${k.padEnd(12)} n=${String(s.n).padStart(6)}  out=${String(s.withOut).padStart(5)} in=${String(s.withIn).padStart(5)}` +
      `  used%=${((used / s.n) * 100).toFixed(1).padStart(5)}  p50dist=${p50.padStart(6)}  <=3.05:${near.padStart(4)}  ->${targets}`,
  );
}

console.log('\n=== raw slot values (outputToSlot / inputFromSlot / outputFromSlot / inputToSlot) ===');
const sh = [...slotHist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
for (const [v, c] of sh) console.log(`  ${String(v).padStart(6)}  ${String(c).padStart(7)}`);
if (slotHist.size > 12) console.log(`  ... ${slotHist.size - 12} more distinct values`);

console.log('\n=== outputOffset / inputOffset distinct values ===');
console.log(`  ${[...offsetVals].sort((a, b) => a - b).slice(0, 12).join(', ')}${offsetVals.size > 12 ? ` ... (${offsetVals.size} total)` : ''}`);

console.log('\n=== is a sorter EVER a target of a link? ===');
let sorterTargets = 0;
let allTargets = 0;
for (const s of owners.values()) {
  for (const [k, c] of s.targets) {
    allTargets += c;
    if (k === 'sorter') sorterTargets += c;
  }
}
console.log(`  ${sorterTargets} / ${allTargets}`);
