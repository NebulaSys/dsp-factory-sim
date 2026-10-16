/**
 * Verify that tail byte offset 14 holds the recipe id.
 *
 * The tail is byte-packed, not an array of i32. For `PlaneSmelter` the three 星际熔炉 variants
 * give bytes 14..15 the values 66 / 65 / 61 — TitaniumAlloy / TitaniumIngot / DiamondAdvanced —
 * and those three files are literally named 钛合金 / 钛块 / 高效金刚石. Read as a float that
 * same field looks like 32.0 / 8.0 / 0.03125, which is what made it look like a numeric field.
 *
 * This checks the hypothesis corpus-wide: recipes should appear on crafting machines and be
 * absent (0 or -1) on belts, sorters, power and storage.
 *
 *   node --experimental-strip-types tools/verify-v1-recipe-offset.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeBlueprint, type BlueprintBuilding } from '../src/engine/bp/codec.ts';
import { loadDataset } from '../src/engine/loader.ts';

const ROOT = resolve(import.meta.dirname, '..');
const data = loadDataset(JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/dsp-vanilla.json'), 'utf8')));
const byItem = new Map(data.buildings.map((b) => [b.id, b]));
const recipeById = new Map(data.recipes.filter((r) => typeof r.id === 'number').map((r) => [r.id as number, r]));

/** The i16 at byte 14 of the tail. */
function i16At(tail: number[], byteOffset: number): number {
  const bytes = Buffer.alloc(tail.length * 4);
  tail.forEach((v, i) => bytes.writeInt32LE(v, i * 4));
  if (byteOffset + 2 > bytes.length) return Number.NaN;
  return bytes.readInt16LE(byteOffset);
}

const DIR = resolve(ROOT, 'docs/research/_raw/realbp');
interface Stat {
  key: string;
  category: string;
  n: number;
  withRecipe: number;
  recipes: Map<number, number>;
  zero: number;
  minusOne: number;
  other: Map<number, number>;
}
const stats = new Map<number, Stat>();

for (const f of readdirSync(DIR).filter((x) => x.endsWith('.txt'))) {
  let bp;
  try {
    bp = await decodeBlueprint(readFileSync(resolve(DIR, f), 'utf8').trim());
  } catch {
    continue;
  }
  for (const b of bp.body.buildings as BlueprintBuilding[]) {
    if (!b.tail || b.tail.length < 4) continue;
    const def = byItem.get(b.itemId);
    let s = stats.get(b.itemId);
    if (!s) {
      s = { key: def?.key ?? `id${b.itemId}`, category: def?.category ?? '?', n: 0, withRecipe: 0, recipes: new Map(), zero: 0, minusOne: 0, other: new Map() };
      stats.set(b.itemId, s);
    }
    s.n++;
    const v = i16At(b.tail, 14);
    if (recipeById.has(v)) {
      s.withRecipe++;
      s.recipes.set(v, (s.recipes.get(v) ?? 0) + 1);
    } else if (v === 0) s.zero++;
    else if (v === -1) s.minusOne++;
    else s.other.set(v, (s.other.get(v) ?? 0) + 1);
  }
}

console.log('i16 at tail byte offset 14, per prototype\n');
console.log('prototype                    category     n      validRecipe   ==0      ==-1     other');
const order = [...stats.entries()].sort((a, b) => b[1].n - a[1].n);
for (const [, s] of order) {
  const other = [...s.other.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([v, c]) => `${v}×${c}`).join(' ');
  console.log(
    `${s.key.padEnd(28)} ${s.category.padEnd(12)} ${String(s.n).padStart(6)}  ${String(s.withRecipe).padStart(8)}      ${String(s.zero).padStart(6)}  ${String(s.minusOne).padStart(6)}   ${other}`,
  );
}

console.log('\n=== the recipes actually found, by prototype ===');
for (const [, s] of order) {
  if (s.recipes.size === 0) continue;
  const list = [...s.recipes.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, c]) => `${recipeById.get(id)!.key}(${id})×${c}`)
    .join('  ');
  console.log(`  ${s.key.padEnd(24)} ${list}`);
}

const craftCats = new Set(['production', 'smelter', 'research', 'chemical']);
console.log('\n=== does it behave like a recipe field? ===');
for (const [, s] of order) {
  const craft = craftCats.has(s.category);
  const rate = s.n ? (s.withRecipe / s.n) * 100 : 0;
  const verdict = craft
    ? rate > 50
      ? 'crafting machine: mostly has a recipe  OK'
      : `crafting machine: only ${rate.toFixed(0)}% have a recipe   <-- unexpected`
    : s.withRecipe === 0
      ? 'non-crafting: no recipe  OK'
      : `non-crafting but ${s.withRecipe} have "recipes"  <-- check`;
  console.log(`  ${s.key.padEnd(26)} ${verdict}`);
}
