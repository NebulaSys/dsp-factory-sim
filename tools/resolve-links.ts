/**
 * Resolve the `outputObj` / `inputObj` link fields to actual buildings.
 *
 * `BlueprintBuilding.Export` writes the **referenced building's `index` field**, not its position
 * in the blueprint array. Whether those two coincide is an empirical question, and getting it
 * wrong makes every link look like it points at a random building hundreds of cells away — which
 * is exactly what a naive `buildings[ref]` lookup produced.
 *
 * This tries each plausible interpretation and reports which one yields physically possible
 * links (a sorter reaches 1..3 cells), rather than assuming one.
 *
 *   node --experimental-strip-types tools/resolve-links.ts [sample]
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

console.log(`sample: ${name}  buildings: ${buildings.length}`);

// Is `index` simply the array position?
const isIdentity = buildings.every((b, i) => b.index === i);
const indices = buildings.map((b) => b.index);
console.log(`index === array position for every building: ${isIdentity}`);
console.log(`index range: [${Math.min(...indices)}, ${Math.max(...indices)}]  distinct: ${new Set(indices).size}`);
console.log('');

const byIndexField = new Map(buildings.map((b) => [b.index, b]));

interface Interp {
  label: string;
  get: (ref: number) => (typeof buildings)[number] | undefined;
}

const interps: Interp[] = [
  { label: 'buildings[ref]      (array position, 0-based)', get: (r) => buildings[r] },
  { label: 'buildings[ref-1]    (array position, 1-based)', get: (r) => buildings[r - 1] },
  { label: 'byIndexField.get(ref)  (index field)', get: (r) => byIndexField.get(r) },
  { label: 'byIndexField.get(ref-1)', get: (r) => byIndexField.get(r - 1) },
];

const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

const sorters = buildings.filter((b) => sorter(b.itemId));
console.log(`sorters: ${sorters.length}\n`);

console.log('=== distance from each sorter to its outputObj, per interpretation ===');
console.log('interp                                      within1.5  within3  p50     max');
for (const it of interps) {
  const ds: number[] = [];
  let nulls = 0;
  for (const s of sorters) {
    const ref = s.outputObjectIndex;
    if (ref < 0) {
      nulls++;
      continue;
    }
    const t = it.get(ref);
    if (!t) {
      nulls++;
      continue;
    }
    ds.push(dist(s, t));
  }
  ds.sort((a, b) => a - b);
  const p50 = ds[Math.floor(ds.length / 2)] ?? NaN;
  const w = (d: number): number => (ds.filter((x) => x <= d).length / Math.max(1, ds.length)) * 100;
  console.log(
    `${it.label.padEnd(44)} ${w(1.5).toFixed(1).padStart(6)}%  ${w(3).toFixed(1).padStart(6)}%  ` +
      `${p50.toFixed(2).padStart(6)}  ${(ds[ds.length - 1] ?? NaN).toFixed(1).padStart(7)}   (unresolved ${nulls})`,
  );
}
console.log('');

// Under the best interpretation, what does a sorter connect?
const best = interps.find((it) => {
  const ds: number[] = [];
  for (const s of sorters) {
    const t = it.get(s.outputObjectIndex);
    if (t) ds.push(dist(s, t));
  }
  return ds.length > 0 && ds.filter((d) => d <= 1.5).length / ds.length > 0.5;
});

if (!best) {
  console.log('No interpretation makes sorter->outputObj adjacent. Printing raw samples for inspection:\n');
  for (const s of sorters.slice(0, 8)) {
    const ref = s.outputObjectIndex;
    const naive = buildings[ref];
    const byField = byIndexField.get(ref);
    console.log(
      `  sorter #${s.index} at (${s.x.toFixed(1)},${s.y.toFixed(1)},${s.z.toFixed(1)}) ` +
        `out=${ref} in=${s.inputObjectIndex}\n` +
        `      buildings[out]   = ${naive ? `#${naive.index} id=${naive.itemId} ${kind(naive.itemId)} at (${naive.x.toFixed(1)},${naive.y.toFixed(1)},${naive.z.toFixed(1)})` : 'n/a'}\n` +
        `      byIndexField[out]= ${byField ? `#${byField.index} id=${byField.itemId} ${kind(byField.itemId)} at (${byField.x.toFixed(1)},${byField.y.toFixed(1)},${byField.z.toFixed(1)})` : 'n/a'}\n` +
        `      slot out=${s.outputToSlot} in=${s.inputFromSlot}`,
    );
  }
} else {
  console.log(`best interpretation: ${best.label}\n`);
  const pairs = new Map<string, number>();
  for (const s of sorters) {
    const o = best.get(s.outputObjectIndex);
    const i = best.get(s.inputObjectIndex);
    const k = `sorter -> out:${o ? kind(o.itemId) : 'none'} in:${i ? kind(i.itemId) : 'none'}`;
    pairs.set(k, (pairs.get(k) ?? 0) + 1);
  }
  for (const [k, v] of [...pairs.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(44)} ${v}`);

  console.log('');
  console.log('=== for sorters whose output resolves to a machine, what slot? ===');
  let shown = 12;
  for (const s of sorters) {
    const o = best.get(s.outputObjectIndex);
    if (!o || kind(o.itemId) !== 'machine') continue;
    console.log(
      `  sorter #${s.index} (${s.x.toFixed(1)},${s.y.toFixed(1)},${s.z.toFixed(1)}) -> #${o.index} id=${o.itemId} ` +
        `at (${o.x.toFixed(1)},${o.y.toFixed(1)},${o.z.toFixed(1)}) outToSlot=${s.outputToSlot}`,
    );
    if (--shown === 0) break;
  }
}
