/**
 * Does the v1 tail recipe decode hold on blueprints that are NOT from 仙术_Illegal?
 *
 * Every measurement behind the recipe decode — "every crafting machine yields a valid recipe",
 * "every non-crafting building yields 0" — came from a single corpus of 28 files that are all
 * from one repository folder, `仙术_Illegal`. Those are cheat/stacked builds. If the rule only
 * holds there it is a coincidence of that corpus, not a property of the format.
 *
 * `docs/research/_raw/realbp2` holds ordinary published factory blueprints from a different
 * folder of the same repository, so this re-runs the same three claims against independent data.
 *
 *   node --experimental-strip-types tools/validate-v1-recipe-external.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeBlueprint } from '../src/engine/bp/codec.ts';
import { loadDataset } from '../src/engine/loader.ts';
import { convertBlueprint } from '../src/engine/factory.ts';

const ROOT = resolve(import.meta.dirname, '..');
const data = loadDataset(
  JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/dsp-vanilla.json'), 'utf8')),
  JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/building-slots.json'), 'utf8')),
);
const byId = new Map(data.buildings.map((b) => [b.id, b]));
const CRAFT = new Set(['production', 'smelter', 'research', 'chemical']);
const SORTER = new Set([2011, 2012, 2013, 2014]);

const DIR = resolve(ROOT, 'docs/research/_raw/realbp2');
const files = readdirSync(DIR).filter((x) => x.endsWith('.txt'));
if (files.length === 0) {
  console.error('no external blueprints staged');
  process.exit(2);
}

let filesOk = 0;
let buildings = 0;
let craft = 0;
let craftWithRecipe = 0;
let nonCraftWithRecipe = 0;
let unknownRecipe = 0;
let powerKW = 0;
let lines = 0;
let recipesFound = new Set<number>();
/** sorter tail[1] checks on independent data */
let sorterLinks = 0;
let sorterLinksResolved = 0;

console.log('=== external corpus: ordinary blueprints, not 仙术_Illegal ===\n');
console.log('file                                     layout      bldgs  craft  w/recipe  lines  kW');

for (const f of files) {
  let bp;
  try {
    bp = await decodeBlueprint(readFileSync(resolve(DIR, f), 'utf8').trim());
  } catch (err) {
    console.log(`  ${f.padEnd(38)} DECODE FAILED: ${(err as Error).message.slice(0, 40)}`);
    continue;
  }
  filesOk++;

  const byIndex = new Map(bp.body.buildings.map((b) => [b.index, b]));
  let c = 0;
  let cw = 0;
  for (const b of bp.body.buildings) {
    buildings++;
    const def = byId.get(b.itemId);
    if (SORTER.has(b.itemId) && b.tail && b.tail.length >= 2 && b.tail[1]! >= 0) {
      sorterLinks++;
      if (byIndex.has(b.tail[1]!)) sorterLinksResolved++;
    }
    if (!def) continue;
    if (CRAFT.has(def.category)) {
      craft++;
      c++;
      if (b.recipeId > 0) {
        craftWithRecipe++;
        cw++;
        recipesFound.add(b.recipeId);
        if (!data.recipeByIdOrUndefined(b.recipeId)) unknownRecipe++;
      }
    } else if (b.recipeId > 0) {
      nonCraftWithRecipe++;
    }
  }

  const model = convertBlueprint(data, bp);
  lines += model.lines.length;
  powerKW += model.totals.craftingPowerKW;
  console.log(
    `  ${f.padEnd(38)} ${String(bp.body.layout).padEnd(11)} ${String(bp.body.buildings.length).padStart(5)}  ${String(c).padStart(5)}  ${String(cw).padStart(8)}  ${String(model.lines.length).padStart(5)}  ${String(model.totals.craftingPowerKW).padStart(7)}`,
  );
}

console.log('\n=== the three claims, re-tested on independent data ===');
console.log(`  files decoded                     : ${filesOk} / ${files.length}`);
console.log(`  buildings                         : ${buildings}`);
console.log(`  crafting machines                 : ${craft}`);
console.log(`  crafting machines with a recipe   : ${craftWithRecipe}  (${craft ? ((craftWithRecipe / craft) * 100).toFixed(1) : '0'}%)`);
console.log(`  non-crafting with a "recipe"      : ${nonCraftWithRecipe}   <-- must be 0`);
console.log(`  recipe ids the dataset cannot resolve: ${unknownRecipe}   <-- must be 0`);
console.log(`  distinct recipes recovered        : ${recipesFound.size}`);
console.log(`  production lines built            : ${lines}`);
console.log(`  crafting power                    : ${powerKW} kW`);
console.log('');
console.log(`  sorter tail[1] links              : ${sorterLinks}`);
console.log(`  ... resolving to a real building  : ${sorterLinksResolved}  (${sorterLinks ? ((sorterLinksResolved / sorterLinks) * 100).toFixed(1) : '0'}%)`);

const ok =
  craft > 0 &&
  craftWithRecipe === craft &&
  nonCraftWithRecipe === 0 &&
  unknownRecipe === 0 &&
  (sorterLinks === 0 || sorterLinksResolved === sorterLinks);

console.log('');
console.log(ok ? 'VERDICT: the decode holds on independent blueprints.' : 'VERDICT: the decode does NOT fully hold — see the rows above.');
process.exit(ok ? 0 : 1);
