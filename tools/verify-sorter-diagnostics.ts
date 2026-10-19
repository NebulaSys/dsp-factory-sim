/**
 * Does the geometric sorter diagnostic actually fire on real blueprints?
 *
 * A diagnostic that never reports anything is worse than none: it looks like a clean bill of health.
 * This runs the engine over the whole corpus and prints, per blueprint, how many sorter arm ends
 * resolve to a machine / belt / sorter / nothing, plus how many machines end up with a service
 * count. It is also the end-to-end check that `convertBlueprint` does the classification.
 *
 *   node --experimental-strip-types tools/verify-sorter-diagnostics.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeBlueprint } from '../src/engine/bp/codec.ts';
import { convertBlueprint } from '../src/engine/factory.ts';
import { loadDataset } from '../src/engine/loader.ts';

const ROOT = resolve(import.meta.dirname, '..');
const data = loadDataset(
  JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/dsp-vanilla.json'), 'utf8')),
  JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/building-slots.json'), 'utf8')),
);

const DIRS = ['docs/research/_raw/realbp', 'docs/research/_raw/realbp2'];
let files = 0;
let sorters = 0;
let dangling = 0;
let uncertain = 0;
let withSorter = 0;
let producers = 0;
const endKinds = new Map<string, number>();
const worst: { file: string; dangling: number; sorters: number }[] = [];

for (const dir of DIRS) {
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
    const model = convertBlueprint(data, bp);
    const t = model.totals;
    files++;
    sorters += t.sorters;
    dangling += t.danglingSorters;
    uncertain += t.danglingSortersUncertain;
    withSorter += t.machinesWithSorter;
    producers += t.producers;
    if (t.danglingSorters > 0) worst.push({ file: f, dangling: t.danglingSorters, sorters: t.sorters });
    for (const n of model.nodes) {
      if (n.kind !== 'sorter') continue;
      if (n.armFromKind) endKinds.set(n.armFromKind, (endKinds.get(n.armFromKind) ?? 0) + 1);
      if (n.armToKind) endKinds.set(n.armToKind, (endKinds.get(n.armToKind) ?? 0) + 1);
    }
  }
}

console.log(`files: ${files}  sorters: ${sorters}  producers: ${producers}\n`);
console.log('=== arm ends by kind (engine output) ===');
const totalEnds = [...endKinds.values()].reduce((a, b) => a + b, 0);
for (const [k, v] of [...endKinds.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(7)}  ${((v / totalEnds) * 100).toFixed(1).padStart(5)}%  ${k}`);
}
console.log('\n=== diagnostics ===');
console.log(`  dangling sorters (reported as broken)     : ${dangling}`);
console.log(`  dangling but stacked (unresolved, not bad): ${uncertain}`);
console.log(`  machines with >=1 sorter                  : ${withSorter} / ${producers}`);
console.log('\n=== blueprints that actually report a dangling sorter (top 8) ===');
for (const w of worst.sort((a, b) => b.dangling - a.dangling).slice(0, 8)) {
  console.log(`  ${String(w.dangling).padStart(5)} of ${String(w.sorters).padStart(5)} sorters   ${w.file.slice(0, 52)}`);
}
if (worst.length === 0) console.log('  NONE — the diagnostic never fires, investigate before shipping it.');
