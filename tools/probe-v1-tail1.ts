/**
 * What is `tail[1]`?
 *
 * The recipe sits at byte 14 (`tail[3]` high half). `tail[1]` is also non-zero on some buildings
 * and takes values like 3731 / 2626 / 2699 / 733 / 58. Those looked like they might be per-file
 * constants, which would make them a blueprint- or area-level value rather than a per-building
 * one.
 *
 * This tests the cheapest hypotheses that would explain it, and reports which survive:
 *
 *   H1 per-file constant   — same value for every building in a file
 *   H2 index-related       — equals the file's building count, or count-1, or a building index
 *   H3 area-related        — equals the area count, an areaIndex, or the record count in its area
 *   H4 per-prototype       — constant per prototype across files
 *
 *   node --experimental-strip-types tools/probe-v1-tail1.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeBlueprint } from '../src/engine/bp/codec.ts';
import { loadDataset } from '../src/engine/loader.ts';

const ROOT = resolve(import.meta.dirname, '..');
const data = loadDataset(JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/dsp-vanilla.json'), 'utf8')));
const byItem = new Map(data.buildings.map((b) => [b.id, b]));
const DIR = resolve(ROOT, 'docs/research/_raw/realbp');

interface Row {
  file: string;
  buildings: number;
  areas: number;
  tail1: Map<number, number>;
  perArea: Map<number, Set<number>>;
  /** recipes per tail1 value: a tail1 that tracks the recipe would be constant per recipe */
  recipeFor: Map<number, Set<number>>;
}

const rows: Row[] = [];
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.txt'))) {
  let bp;
  try {
    bp = await decodeBlueprint(readFileSync(resolve(DIR, f), 'utf8').trim());
  } catch {
    continue;
  }
  const r: Row = { file: f, buildings: bp.body.buildings.length, areas: bp.body.areas.length, tail1: new Map(), perArea: new Map(), recipeFor: new Map() };
  for (const b of bp.body.buildings) {
    if (!b.tail || b.tail.length < 2) continue;
    const v = b.tail[1]!;
    r.tail1.set(v, (r.tail1.get(v) ?? 0) + 1);
    if (!r.perArea.has(v)) r.perArea.set(v, new Set());
    r.perArea.get(v)!.add(b.areaIndex);
    if (!r.recipeFor.has(v)) r.recipeFor.set(v, new Set());
    if (b.recipeId > 0) r.recipeFor.get(v)!.add(b.recipeId);
  }
  rows.push(r);
}

console.log('per blueprints with a tail:\n');
console.log('  file                                  buildings  areas  distinct tail[1]   values (count)');
for (const r of rows.slice(0, 28)) {
  const vals = [...r.tail1.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([v, c]) => `${v}×${c}`).join(' ');
  console.log(
    `  ${r.file.slice(0, 36).padEnd(38)} ${String(r.buildings).padStart(7)}  ${String(r.areas).padStart(5)}  ${String(r.tail1.size).padStart(13)}   ${vals}`,
  );
}

console.log('\n=== H1: is tail[1] constant across the whole file? ===');
let h1 = 0;
for (const r of rows) if (r.tail1.size === 1) h1++;
console.log(`  ${h1} / ${rows.length} files have a single distinct tail[1]`);

console.log('\n=== H2: does tail[1] equal the building count or count-1? ===');
for (const r of rows.slice(0, 28)) {
  const vals = [...r.tail1.keys()];
  const hit = vals.some((v) => v === r.buildings || v === r.buildings - 1);
  if (hit) console.log(`  ${r.file.slice(0, 34).padEnd(36)} buildings=${r.buildings}  tail[1] ∈ {${vals.slice(0, 3).join(',')}}   <-- MATCH`);
}
console.log('  (only matches shown)');

console.log('\n=== H3: does tail[1] relate to areas? ===');
for (const r of rows.slice(0, 28)) {
  const vals = [...r.tail1.keys()];
  const hitArea = vals.some((v) => v === r.areas || v === r.areas - 1);
  const hitIdx = vals.some((v) => v >= 0 && v < r.areas);
  const spreads = [...r.perArea.entries()].map(([v, s]) => `${v}:${s.size}area`).join(' ');
  console.log(
    `  ${r.file.slice(0, 30).padEnd(32)} areas=${String(r.areas).padStart(3)}  ==areas:${hitArea ? 'Y' : 'n'}  <areas:${hitIdx ? 'Y' : 'n'}   ${spreads.slice(0, 46)}`,
  );
}

console.log('\n=== H4: is tail[1] determined by the recipe? ===');
for (const r of rows) {
  for (const [v, recipes] of r.recipeFor) {
    if (recipes.size > 0 && r.tail1.get(v)! > 1) {
      console.log(`  ${r.file.slice(0, 30).padEnd(32)} tail[1]=${String(v).padStart(6)}  recipes={${[...recipes].join(',')}}  n=${r.tail1.get(v)}`);
    }
  }
}
