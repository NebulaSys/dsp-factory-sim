/**
 * The one link class that IS geometric: belt -> power building.
 *
 * Corrected context: sorter->belt pointers are mostly NOT local (only 1.5% within 0.01 cells,
 * p50 4.53 cells), so they are network/line references, not "the belt I stand on". But belt->power
 * pointers measured p50 0.50 cells with 100% inside 3 cells, which is adjacency. That makes them
 * the only link class the view can draw as real geometry.
 *
 * This checks what they point at, how far, and whether the relation is one-way — i.e. whether the
 * production view can show "this pole feeds these belts".
 *
 *   node --experimental-strip-types tools/analyze-power-edges.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeBlueprint } from '../src/engine/bp/codec.ts';
import { loadDataset } from '../src/engine/loader.ts';

const ROOT = resolve(import.meta.dirname, '..');
const data = loadDataset(JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/dsp-vanilla.json'), 'utf8')));
const BELT = new Set([2001, 2002, 2003]);
const keyOf = new Map(data.buildings.map((b) => [b.id, b.key]));
const catOf = new Map(data.buildings.map((b) => [b.id, b.category]));

const targetHist = new Map<string, number>();
const dists: number[] = [];
const reciprocal = { yes: 0, no: 0 };
const perFile = new Map<string, { belts: number; linked: number; poles: number }>();
let total = 0;

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
    const bs = bp.body.buildings;
    const byIndex = new Map(bs.map((b) => [b.index, b]));
    const st = { belts: 0, linked: 0, poles: 0 };
    for (const b of bs) {
      if (BELT.has(b.itemId)) st.belts++;
      if (catOf.get(b.itemId) === 'power') st.poles++;
      if (!BELT.has(b.itemId)) continue;
      for (const v of [b.outputObjectIndex, b.inputObjectIndex]) {
        if (v === -1) continue;
        const t = byIndex.get(v);
        if (!t) continue;
        total++;
        st.linked++;
        targetHist.set(keyOf.get(t.itemId) ?? `item#${t.itemId}`, (targetHist.get(keyOf.get(t.itemId) ?? `item#${t.itemId}`) ?? 0) + 1);
        dists.push(Math.hypot(t.x - b.x, t.y - b.y));
        // does the pole point back at this belt?
        if (t.outputObjectIndex === b.index || t.inputObjectIndex === b.index) reciprocal.yes++;
        else reciprocal.no++;
      }
    }
    perFile.set(f, st);
  }
}

const pct = (q: number): number => {
  const s = dists.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))] ?? NaN;
};

console.log(`belt -> X pointers: ${total}\n`);
console.log('=== what does a belt point at? ===');
for (const [k, v] of [...targetHist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`  ${String(v).padStart(6)}  ${((v / total) * 100).toFixed(1).padStart(5)}%  ${k}`);
}
console.log('\n=== distance belt -> target ===');
console.log(`  p10=${pct(0.1).toFixed(2)}  p50=${pct(0.5).toFixed(2)}  p90=${pct(0.9).toFixed(2)}  max=${dists[dists.length - 1]?.toFixed(2)}`);
for (const lim of [0.5, 1.5, 3.05]) {
  console.log(`  within ${String(lim).padEnd(5)} cells: ${dists.filter((d) => d <= lim).length} (${((dists.filter((d) => d <= lim).length / dists.length) * 100).toFixed(1)}%)`);
}
console.log('\n=== is the relation reciprocal? ===');
console.log(`  target points back at the belt: ${reciprocal.yes} / ${reciprocal.yes + reciprocal.no}`);

console.log('\n=== which files use it (top 6 by link count) ===');
const rows = [...perFile.entries()].sort((a, b) => b[1].linked - a[1].linked).slice(0, 6);
for (const [f, s] of rows) {
  console.log(`  belts=${String(s.belts).padStart(5)} linked=${String(s.linked).padStart(5)} poles=${String(s.poles).padStart(4)}  ${f.slice(0, 40)}`);
}

console.log('\n=== view impact ===');
console.log('  If most belts in a file carry a pole pointer, the production view can draw the');
console.log('  power network as real geometry. If only a handful do, it cannot.');
