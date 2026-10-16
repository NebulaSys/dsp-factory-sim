/**
 * What is in the v1 record tail array?
 *
 * v1 has no `recipeId` / `filterId` / `parameters` fields — its head is
 * `index, areaIndex, anchor, anchor2, yaw, yaw2, itemId, modelIndex` and then an i32 array. So a
 * machine's recipe has nowhere else to live, and until that array is understood the rate tables
 * stay empty for 27 of the 28 corpus blueprints.
 *
 * This dumps the tails grouped by prototype and asks the one question that can settle it: does
 * any element hold a value that is a *valid recipe id* in the dataset?
 *
 *   node --experimental-strip-types tools/probe-v1-tail-meaning.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeBlueprint } from '../src/engine/bp/codec.ts';
import { loadDataset } from '../src/engine/loader.ts';

const ROOT = resolve(import.meta.dirname, '..');
const data = loadDataset(JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/dsp-vanilla.json'), 'utf8')));
const byItem = new Map(data.buildings.map((b) => [b.id, b]));

const DIR = resolve(ROOT, 'docs/research/_raw/realbp');
const files = readdirSync(DIR).filter((x) => x.endsWith('.txt'));

/** Tail shape per prototype: the set of observed (length, element values). */
interface Shape {
  key: string;
  lengths: Map<number, number>;
  /** position -> value -> count */
  columns: Map<number, Map<number, number>>;
  samples: number;
}
const shapes = new Map<number, Shape>();

let buildings = 0;
let withTail = 0;

for (const f of files) {
  let bp;
  try {
    bp = await decodeBlueprint(readFileSync(resolve(DIR, f), 'utf8').trim());
  } catch {
    continue;
  }
  for (const b of bp.body.buildings) {
    buildings++;
    if (!b.tail) continue;
    withTail++;
    const def = byItem.get(b.itemId);
    const key = def ? def.key : `id${b.itemId}`;
    let s = shapes.get(b.itemId);
    if (!s) {
      s = { key, lengths: new Map(), columns: new Map(), samples: 0 };
      shapes.set(b.itemId, s);
    }
    s.samples++;
    s.lengths.set(b.tail.length, (s.lengths.get(b.tail.length) ?? 0) + 1);
    b.tail.forEach((v, i) => {
      if (!s.columns.has(i)) s.columns.set(i, new Map());
      s.columns.get(i)!.set(v, (s.columns.get(i)!.get(v) ?? 0) + 1);
    });
  }
}

console.log(`blueprints scanned: ${files.length}`);
console.log(`buildings: ${buildings}   carrying a tail: ${withTail}`);
console.log('');

// Which prototypes exist and what tail length do they use?
console.log('=== tail length per prototype ===');
const rows = [...shapes.entries()].sort((a, b) => b[1].samples - a[1].samples);
for (const [id, s] of rows.slice(0, 26)) {
  const lens = [...s.lengths.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n}×${c}`).join(' ');
  const cat = byItem.get(id)?.category ?? '?';
  console.log(`  ${String(id).padStart(5)} ${s.key.padEnd(28)} ${cat.padEnd(10)} n=${lens}`);
}
console.log('');

// The decisive question: does any column hold a valid recipe id?
const recipeIds = new Set(data.recipes.map((r) => r.id).filter((x): x is number => typeof x === 'number'));
const itemIds = new Set(data.items.map((i) => i.id).filter((x): x is number => typeof x === 'number'));
console.log(`dataset: ${recipeIds.size} recipes with an id, ${itemIds.size} items with an id`);
console.log('');

console.log('=== does a column look like recipe ids? ===');
console.log('  prototype              col   distinct   in-dataset-as-recipe   in-dataset-as-item   top values');
let anyRecipeColumn = false;
for (const [id, s] of rows.slice(0, 14)) {
  for (const [col, values] of [...s.columns.entries()].sort((a, b) => a[0] - b[0])) {
    const distinct = values.size;
    if (distinct > 40) continue; // a recipe column should be few-valued per prototype
    const total = [...values.values()].reduce((a, b) => a + b, 0);
    const asRecipe = [...values.keys()].filter((v) => recipeIds.has(v)).length;
    const asItem = [...values.keys()].filter((v) => itemIds.has(v)).length;
    const top = [...values.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([v, c]) => `${v}×${c}`).join(' ');
    const flag = asRecipe > 0 && asRecipe === distinct ? '  <== ALL values are recipe ids' : '';
    if (asRecipe > 0) anyRecipeColumn = true;
    console.log(
      `  ${s.key.padEnd(22)} [${String(col).padStart(2)}]  ${String(distinct).padStart(8)}   ${String(asRecipe).padStart(6)}/${String(distinct).padEnd(6)}        ${String(asItem).padStart(6)}/${String(distinct).padEnd(6)}      ${top}${flag}`,
    );
  }
}
console.log('');
console.log(anyRecipeColumn ? 'At least one column contains dataset recipe ids.' : 'NO column contains a dataset recipe id.');
console.log('');
console.log('=== raw tails for a crafting machine, first 10 ===');
const smelterId = data.buildings.find((b) => b.key === 'PlaneSmelter')?.id;
for (const f of files) {
  let bp;
  try {
    bp = await decodeBlueprint(readFileSync(resolve(DIR, f), 'utf8').trim());
  } catch {
    continue;
  }
  const hits = bp.body.buildings.filter((b) => b.itemId === smelterId && b.tail).slice(0, 10);
  if (hits.length === 0) continue;
  console.log(`  file ${f.slice(0, 40)}  layout=${bp.body.layout}`);
  for (const b of hits) console.log(`    #${String(b.index).padStart(5)}  [${b.tail!.join(', ')}]`);
  break;
}
