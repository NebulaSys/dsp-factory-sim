/**
 * Find the recipe inside the v1 tail array.
 *
 * Recipe ids in this game are small (TitaniumAlloy = 66, Diamond = 60), so a recipe column must
 * be a column whose values are all small and that varies between machines of the same prototype.
 * `tail[5]` on a belt was already identified this way as the carried item (Coal 1006, Diamond
 * 1112, TitaniumOre 1004), so the method works.
 *
 *   node --experimental-strip-types tools/find-v1-recipe.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeBlueprint } from '../src/engine/bp/codec.ts';
import { loadDataset } from '../src/engine/loader.ts';

const ROOT = resolve(import.meta.dirname, '..');
const data = loadDataset(JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/dsp-vanilla.json'), 'utf8')));
const byItem = new Map(data.buildings.map((b) => [b.id, b]));
const recipeById = new Map(data.recipes.filter((r) => typeof r.id === 'number').map((r) => [r.id as number, r]));
const itemIds = new Set(data.items.map((i) => i.id).filter((x): x is number => typeof x === 'number'));

const DIR = resolve(ROOT, 'docs/research/_raw/realbp');

/** prototype -> (fileName -> column -> values) so per-file grouping can be seen. */
const perFile = new Map<number, Map<string, number[][]>>();

for (const f of readdirSync(DIR).filter((x) => x.endsWith('.txt'))) {
  let bp;
  try {
    bp = await decodeBlueprint(readFileSync(resolve(DIR, f), 'utf8').trim());
  } catch {
    continue;
  }
  for (const b of bp.body.buildings) {
    if (!b.tail) continue;
    let byProto = perFile.get(b.itemId);
    if (!byProto) perFile.set(b.itemId, (byProto = new Map()));
    if (!byProto.has(f)) byProto.set(f, []);
    byProto.get(f)!.push(b.tail);
  }
}

const CRAFT = new Set(['production', 'smelter', 'research', 'chemical']);

console.log('=== for each crafting prototype: columns whose values are all <= 250 ===');
for (const [id, files] of perFile) {
  const def = byItem.get(id);
  if (!def || !CRAFT.has(def.category)) continue;
  const all = [...files.values()].flat();
  if (all.length === 0) continue;
  const width = all[0]!.length;
  console.log(`\n-- ${def.key} (id ${id}, n=${width}, ${all.length} samples across ${files.size} files)`);
  for (let c = 0; c < width; c++) {
    const values = all.map((t) => t[c] ?? 0);
    const distinct = [...new Set(values)].sort((a, b) => a - b);
    if (distinct.some((v) => v < 0 || v > 250)) continue;
    const asRecipe = distinct.filter((v) => recipeById.has(v)).length;
    const asItem = distinct.filter((v) => itemIds.has(v)).length;
    console.log(
      `   col[${c}]  distinct=${distinct.length}  ${JSON.stringify(distinct.slice(0, 10))}` +
        `   validRecipes=${asRecipe}/${distinct.length}  validItems=${asItem}/${distinct.length}`,
    );
    // Per-file grouping is the signature of a recipe: one design, several exported variants.
    if (distinct.length > 1) {
      for (const [f, rows] of files) {
        const vals = [...new Set(rows.map((t) => t[c] ?? 0))];
        console.log(`        ${f.slice(0, 34).padEnd(36)} n=${String(rows.length).padStart(5)}  col[${c}]=${JSON.stringify(vals.slice(0, 5))}`);
      }
    }
  }
}

console.log('\n=== the three 星际熔炉 variants: which recipes do their names imply? ===');
for (const key of ['TitaniumAlloy', 'TitaniumIngot', 'Diamond', 'DiamondAdvanced']) {
  const r = data.recipes.find((x) => x.key === key);
  console.log(`   ${key.padEnd(18)} id=${String(r?.id).padStart(5)}  in=${r ? JSON.stringify(r.inputs ?? []) : '-'}  out=${r ? JSON.stringify(r.outputs ?? []) : '-'}`);
}
