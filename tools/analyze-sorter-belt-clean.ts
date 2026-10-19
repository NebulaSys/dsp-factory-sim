/**
 * Settle the sorter->belt pointer geometry cleanly, then check what it unlocks for the view.
 *
 * The previous tool (analyze-sorter-belt-link.ts) reported 0.9% of targets near an arm end while
 * its own printed samples showed half of them at distance 0.00 — the aggregate mixed sorters with
 * a 1-cell arm and a 3-cell arm, and its counters are not trustworthy. This redoes it with no
 * arm-length filter and reports the distribution per arm length, which is the split that matters.
 *
 * It also answers the question the view cares about: does the pointer identify the belt the sorter
 * is actually standing on (distance ~0), or is it a line/representative reference far away?
 *
 *   node --experimental-strip-types tools/analyze-sorter-belt-clean.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeBlueprint } from '../src/engine/bp/codec.ts';

const ROOT = resolve(import.meta.dirname, '..');
const SORTER = new Set([2011, 2012, 2013, 2014]);
const BELT = new Set([2001, 2002, 2003]);

interface Row {
  arm: number;
  dOwn: number;
  dFar: number;
  which: 'output' | 'input';
}
const rows: Row[] = [];

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
    const byIndex = new Map(bp.body.buildings.map((b) => [b.index, b]));
    for (const b of bp.body.buildings) {
      if (!SORTER.has(b.itemId)) continue;
      const arm = Math.hypot(b.x2 - b.x, b.y2 - b.y);
      for (const [v, which] of [
        [b.outputObjectIndex, 'output'],
        [b.inputObjectIndex, 'input'],
      ] as const) {
        if (v === -1) continue;
        const t = byIndex.get(v);
        if (!t || !BELT.has(t.itemId)) continue;
        rows.push({
          arm,
          dOwn: Math.hypot(t.x - b.x, t.y - b.y),
          dFar: Math.hypot(t.x - b.x2, t.y - b.y2),
          which,
        });
      }
    }
  }
}

const pct = (arr: number[], q: number): number => {
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))] ?? NaN;
};
const share = (arr: number[], pred: (n: number) => boolean): string =>
  `${((arr.filter(pred).length / arr.length) * 100).toFixed(1)}%`;

console.log(`sorter -> belt pointers: ${rows.length}\n`);

// Group by arm length: this is the split the previous aggregate conflated.
const byArm = new Map<number, Row[]>();
for (const r of rows) {
  const k = Math.round(r.arm * 2) / 2;
  if (!byArm.has(k)) byArm.set(k, []);
  byArm.get(k)!.push(r);
}

console.log('=== how far is the pointed-at belt from the sorter\'s nearer anchor? ===');
console.log('  arm   n      min(d)<=0.01  <=0.5   <=1.2   p50      note');
for (const [arm, rs] of [...byArm.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const dmin = rs.map((r) => Math.min(r.dOwn, r.dFar));
  console.log(
    `  ${String(arm).padEnd(4)} ${String(rs.length).padStart(5)}  ${share(dmin, (n) => n <= 0.01).padStart(10)}` +
      `  ${share(dmin, (n) => n <= 0.5).padStart(6)}  ${share(dmin, (n) => n <= 1.2).padStart(6)}` +
      `  ${pct(dmin, 0.5).toFixed(2).padStart(6)}`,
  );
}

const allDmin = rows.map((r) => Math.min(r.dOwn, r.dFar));
console.log(`\n  ALL: n=${allDmin.length}  <=0.01: ${share(allDmin, (n) => n <= 0.01)}  <=1.2: ${share(allDmin, (n) => n <= 1.2)}  p50=${pct(allDmin, 0.5).toFixed(2)}`);

// Does the output/input naming line up with a consistent end of the arm?
console.log('\n=== does output vs input land on a consistent END of the arm? ===');
let ownIsOutput = 0;
let ownIsInput = 0;
let ambiguous = 0;
for (const r of rows) {
  // only rows where exactly one end is "touching" the belt are informative
  const ownTouch = r.dOwn <= 0.6;
  const farTouch = r.dFar <= 0.6;
  if (ownTouch && !farTouch) {
    if (r.which === 'output') ownIsOutput++;
    else ownIsInput++;
  } else if (farTouch && !ownTouch) {
    if (r.which === 'output') ownIsInput++;
    else ownIsOutput++;
  } else ambiguous++;
}
console.log(`  touching the (x,y) anchor  : output=${ownIsOutput}  input=${ownIsInput}`);
console.log(`  not resolvable (0 or 2 ends): ${ambiguous}`);
if (ownIsOutput + ownIsInput > 0) {
  const dom = Math.max(ownIsOutput, ownIsInput);
  const tot = ownIsOutput + ownIsInput;
  console.log(`  => dominant end for one field: ${((dom / tot) * 100).toFixed(1)}% of ${tot} resolvable pointers`);
  console.log('     (a high share means the field name carries a consistent geometric meaning)');
}

// What does this mean for the view? Count how many sorters could get a resolved belt end.
const sorterTotal = new Set<string>();
console.log('\n=== view impact ===');
console.log(`  link-derived belt-end evidence exists for ${rows.length} pointers.`);
void sorterTotal;
