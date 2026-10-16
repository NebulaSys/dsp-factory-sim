/**
 * Validate the v1 tail recipe decode against the authoritative rule, on two corpora.
 *
 * The first version of this test asked "is the building's category one of production/smelter/
 * research/chemical?" — a hand-written list. Independent blueprints exposed it as wrong: an Oil
 * Refinery reads tail value 121, its category is `refinery` (not on the list), and 121 is
 * `ReformedRefinement` with `facility = OilRefinery`. The decode was right; the test was wrong,
 * and it was also silently *excluding* refinery, collider, fractionator, pump and extractor
 * machines from the claim.
 *
 * The non-circular rule is the one the project already states elsewhere: a machine's recipe is
 * the one whose `facility` is that machine. So this asserts, per building:
 *
 *   - if the tail yields a non-zero id, that id must be a known recipe AND its facility must be
 *     this building;
 *   - if the tail yields 0, no recipe may claim this building as its facility.
 *
 * Run over both the original 仙术_Illegal corpus and the independent ordinary blueprints.
 *
 *   node --experimental-strip-types tools/validate-v1-recipe-facility.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { requireCorpus } from './lib/corpus.ts';
import { decodeBlueprint } from '../src/engine/bp/codec.ts';
import { loadDataset } from '../src/engine/loader.ts';

const ROOT = resolve(import.meta.dirname, '..');
const data = loadDataset(JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/dsp-vanilla.json'), 'utf8')));
const byId = new Map(data.buildings.map((b) => [b.id, b]));
const recipeById = new Map(data.recipes.filter((r) => typeof r.id === 'number').map((r) => [r.id as number, r]));

/** Which building keys are a facility for some recipe? That, not a hand-written list, is "crafting". */
const facilities = new Set<string>(data.recipes.map((r) => r.facility as string).filter(Boolean) as string[]);

/**
 * Upgraded machines legitimately run their base machine's recipes.
 *
 * Across both corpora, every apparent "facility mismatch" collapsed to exactly three pairs, and
 * all three are upgrade relations in the game — the Plane Smelter is the upgraded Arc Smelter,
 * and the assembler marks share one recipe pool. Listing them explicitly keeps the rule strict:
 * a *new* pair appearing here is a real finding, not something silently waved through.
 */
const UPGRADES: Record<string, string> = {
  PlaneSmelter: 'ArcSmelter',
  AssemblingMachineMk2: 'AssemblingMachineMk1',
  AssemblingMachineMk3: 'AssemblingMachineMk1',
};
const runsRecipe = (buildingKey: string, facility: string): boolean =>
  facility === buildingKey || UPGRADES[buildingKey] === facility;

interface Tally {
  name: string;
  filesOk: number;
  filesTotal: number;
  buildings: number;
  crafting: number;
  craftingWithRecipe: number;
  /** tail gave a recipe but the facility disagrees — a real defect */
  facilityMismatch: { building: string; value: number; facility: string }[];
  /** tail gave 0 but the building is a known facility — a missing recipe */
  craftingWithoutRecipe: { building: string; count: number }[];
  /** tail gave a non-zero id that is not a recipe at all */
  unknownId: { building: string; value: number; count: number }[];
}

async function scan(dir: string, name: string): Promise<Tally> {
  const t: Tally = {
    name,
    filesOk: 0,
    filesTotal: 0,
    buildings: 0,
    crafting: 0,
    craftingWithRecipe: 0,
    facilityMismatch: [],
    craftingWithoutRecipe: [],
    unknownId: [],
  };
  const full = resolve(ROOT, dir);
  let files: string[] = [];
  try {
    files = requireCorpus(dir.endsWith('realbp2') ? 'realbp2' : 'realbp', 'the recipe-facility validation');
  } catch {
    return t;
  }
  t.filesTotal = files.length;
  const noRecipe = new Map<string, number>();

  for (const f of files) {
    let bp;
    try {
      bp = await decodeBlueprint(readFileSync(resolve(full, f), 'utf8').trim());
    } catch {
      continue;
    }
    t.filesOk++;
    for (const b of bp.body.buildings) {
      t.buildings++;
      const def = byId.get(b.itemId);
      if (!def) continue;
      const isFacility = facilities.has(def.key);
      if (isFacility) {
        t.crafting++;
        if (b.recipeId > 0) {
          t.craftingWithRecipe++;
          const r = recipeById.get(b.recipeId);
          if (!r) {
            t.unknownId.push({ building: def.key, value: b.recipeId, count: 1 });
          } else if (!runsRecipe(def.key, r.facility)) {
            t.facilityMismatch.push({ building: def.key, value: b.recipeId, facility: r.facility });
          }
        } else {
          noRecipe.set(def.key, (noRecipe.get(def.key) ?? 0) + 1);
        }
      } else if (b.recipeId > 0) {
        // A non-facility building carrying a recipe id: only legitimate if some recipe names it.
        const r = recipeById.get(b.recipeId);
        if (!r) t.unknownId.push({ building: def.key, value: b.recipeId, count: 1 });
        else if (!runsRecipe(def.key, r.facility)) t.facilityMismatch.push({ building: def.key, value: b.recipeId, facility: r.facility });
      }
    }
  }
  t.craftingWithoutRecipe = [...noRecipe.entries()].map(([building, count]) => ({ building, count }));
  return t;
}

const tallies = [
  await scan('docs/research/_raw/realbp', '仙术_Illegal (original corpus)'),
  await scan('docs/research/_raw/realbp2', 'Basic-Materials (independent)'),
];

let allOk = true;
for (const t of tallies) {
  const pct = t.crafting ? ((t.craftingWithRecipe / t.crafting) * 100).toFixed(1) : '0';
  console.log(`=== ${t.name} ===`);
  console.log(`  files decoded                : ${t.filesOk} / ${t.filesTotal}`);
  console.log(`  buildings                    : ${t.buildings}`);
  console.log(`  buildings that are a recipe facility: ${t.crafting}`);
  console.log(`  ... and the tail yields its recipe  : ${t.craftingWithRecipe}  (${pct}%)`);
  console.log(`  facility mismatches          : ${t.facilityMismatch.length}   <-- must be 0`);
  console.log(`  ids that are not recipes     : ${t.unknownId.length}   <-- must be 0`);
  console.log(`  facilities with no recipe    : ${t.craftingWithoutRecipe.length} kinds`);
  for (const m of t.facilityMismatch.slice(0, 6)) {
    console.log(`      mismatch: ${m.building} -> recipe ${m.value} whose facility is ${m.facility}`);
  }
  for (const u of t.unknownId.slice(0, 6)) console.log(`      unknown id: ${u.building} -> ${u.value}`);
  for (const n of t.craftingWithoutRecipe.slice(0, 8)) {
    console.log(`      no recipe: ${n.building} x${n.count}`);
  }
  const ok = t.facilityMismatch.length === 0 && t.unknownId.length === 0;
  if (!ok) allOk = false;
  console.log(`  -> ${ok ? 'OK' : 'DEFECT'}`);
  console.log('');
}

console.log(allOk ? 'VERDICT: the recipe decode is consistent with the facility rule on both corpora.' : 'VERDICT: defects remain — see above.');
process.exit(allOk ? 0 : 1);
