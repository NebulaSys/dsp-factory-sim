/**
 * Validates the shipped dataset with the real engine loader.
 *
 *   node --experimental-strip-types tools/validate-dataset.ts
 *
 * Checks performed:
 *   1. the JSON loads and passes GameData.validate()
 *   2. every recipe's facility maps to a building with a workSpeed
 *   3. item/recipe prototype ids are unique (blueprint resolution safety)
 *   4. a synthetic blueprint built from real ids survives encode → decode → convert
 *   5. a production plan can be produced for the default 60/min matrix target
 *   6. prints the machine speed table actually in use
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadDataset } from '../src/engine/loader.ts';
import { encodeBlueprint, decodeBlueprint, type BlueprintBody } from '../src/engine/bp/codec.ts';
import { convertBlueprint } from '../src/engine/factory.ts';
import { buildPlan } from '../src/engine/planner.ts';
import { computeProduction } from '../src/engine/production.ts';

const ROOT = resolve(import.meta.dirname, '..');
const DATASET = resolve(ROOT, 'src/engine/data/dsp-vanilla.json');

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const raw = JSON.parse(readFileSync(DATASET, 'utf8'));
console.log(`dataset: ${DATASET}`);
console.log(`gameVersion=${raw.meta?.gameVersion} items=${raw.items?.length} buildings=${raw.buildings?.length} recipes=${raw.recipes?.length}`);

const data = loadDataset(raw);
check('dataset loads and validates', true);

// --- 2. facility coverage -------------------------------------------------
// Two kinds of facility exist:
//   * crafting stations (workSpeed != null) run a recipe on a craft timer
//   * extraction facilities (workSpeed == null) produce at a rate derived from
//     the world (veins, seeps, gas giants), so the "recipe" is a rate model
//   * 'None' recipes are hand-crafted or non-facility processes
const EXTRACTION_FACILITIES = new Set(['MiningMachine', 'WaterPump', 'OilExtractor', 'OrbitalCollector', 'Fractionator']);
const missingFacility: string[] = [];
const missingExtraction: string[] = [];
const facilitiesInUse = new Set<string>();
for (const recipe of data.recipes) {
  facilitiesInUse.add(recipe.facility);
  if (recipe.facility === 'None') continue;
  if (EXTRACTION_FACILITIES.has(recipe.facility)) {
    if (!data.buildings.some((b) => b.recipeFacility === recipe.facility || b.key === recipe.facility)) {
      missingExtraction.push(`${recipe.key} -> ${recipe.facility}`);
    }
    continue;
  }
  const host = data.buildings.find((b) => b.recipeFacility === recipe.facility && b.workSpeed != null);
  if (!host) missingFacility.push(`${recipe.key} -> ${recipe.facility}`);
}
check(
  'every crafting recipe facility has a crafting building',
  missingFacility.length === 0,
  missingFacility.length === 0 ? `${facilitiesInUse.size} facilities in use` : `${missingFacility.length} unresolved, e.g. ${missingFacility.slice(0, 5).join('; ')}`,
);
check(
  'every extraction facility has a building',
  missingExtraction.length === 0,
  missingExtraction.length === 0 ? '' : missingExtraction.slice(0, 5).join('; '),
);

// --- 3. id uniqueness -----------------------------------------------------
const itemIds = new Map<number, string>();
const dupItems: string[] = [];
for (const i of data.items) {
  if (i.id == null) continue;
  const prev = itemIds.get(i.id);
  if (prev && prev !== i.key) dupItems.push(`${i.id}: ${prev} / ${i.key}`);
  itemIds.set(i.id, i.key);
}
check('item prototype ids are unique', dupItems.length === 0, dupItems.slice(0, 5).join('; '));

const recipeIds = new Map<number, string>();
const dupRecipes: string[] = [];
for (const r of data.recipes) {
  if (r.id == null) continue;
  const prev = recipeIds.get(r.id);
  if (prev && prev !== r.key) dupRecipes.push(`${r.id}: ${prev} / ${r.key}`);
  recipeIds.set(r.id, r.key);
}
check('recipe prototype ids are unique', dupRecipes.length === 0, dupRecipes.slice(0, 5).join('; '));

// --- 4. blueprint round trip with real ids --------------------------------
const smelter = data.building('ArcSmelter');
const assembler = data.building('AssemblingMachineMk1');
const ironRecipe = data.recipe('IronIngot');
const gearRecipe = data.recipe('Gear');
if (smelter?.id && assembler?.id && ironRecipe?.id && gearRecipe?.id) {
  const body: BlueprintBody = {
    header: { version: 1, cursorOffsetX: 0, cursorOffsetY: 0, cursorTargetArea: 0, dragboxSizeX: 8, dragboxSizeY: 8, primaryAreaIndex: 0, areaCount: 1 },
    areas: [{ index: 0, parentIndex: -1, tropicAnchor: 0, areaSegments: 5, anchorLocalOffsetX: 0, anchorLocalOffsetY: 0, width: 200, height: 200 }],
    buildings: [
      {
        index: 0, areaIndex: 0, x: 0, y: 0, z: 0, x2: 0, y2: 0, z2: 0, yaw: 0, yaw2: -1,
        itemId: smelter.id, recipeId: ironRecipe.id, modelIndex: 0,
        outputObjectIndex: -1, inputObjectIndex: -1,
        outputToSlot: 0, inputFromSlot: 0, outputFromSlot: 0, inputToSlot: 0,
        outputOffset: 0, inputOffset: 0, filterId: 0, parameters: [],
      },
      {
        index: 1, areaIndex: 0, x: 3, y: 0, z: 0, x2: 0, y2: 0, z2: 0, yaw: 0, yaw2: -1,
        itemId: assembler.id, recipeId: gearRecipe.id, modelIndex: 0,
        outputObjectIndex: -1, inputObjectIndex: -1,
        outputToSlot: 0, inputFromSlot: 0, outputFromSlot: 0, inputToSlot: 0,
        outputOffset: 0, inputOffset: 0, filterId: 0, parameters: [],
      },
    ],
  };
  const text = await encodeBlueprint(body, { meta: { shortDesc: '验证蓝图', gameVersion: data.meta.gameVersion } });
  const decoded = await decodeBlueprint(text);
  check('blueprint encode/decode round trip', decoded.hashWarning === undefined && decoded.body.buildings.length === 2, decoded.hashWarning ?? '');
  const model = convertBlueprint(data, decoded);
  check('blueprint converts to a factory model', model.totals.producers === 2, `producers=${model.totals.producers} unknown=${model.unknown.length}`);
  check('factory rates match the engine', model.lines.find((l) => l.recipeKey === 'IronIngot')!.rate.craftsPerMinPerMachine === 60, '');
  check('no unknown prototype ids in the round trip', model.unknown.length === 0, JSON.stringify(model.unknown));
} else {
  check('blueprint round trip', false, 'missing ArcSmelter/AssemblingMachineMk1/IronIngot/Gear with ids');
}

// --- 5. plan --------------------------------------------------------------
if (data.item('UniverseMatrix')) {
  const plan = buildPlan(data, { target: 'UniverseMatrix', targetPerMin: 60 });
  check('plan for 60 white matrices/min', plan.totalMachines > 0 && plan.rawResources.length > 0, `machines=${plan.totalMachines} raw=${plan.rawResources.length} power=${Math.round(plan.totalPowerKW)}kW`);
} else {
  const plan = buildPlan(data, { target: 'ElectromagneticMatrix', targetPerMin: 60 });
  check('plan for 60 blue matrices/min', plan.totalMachines > 0, `machines=${plan.totalMachines} raw=${plan.rawResources.length}`);
}

// --- 6. machine speed table ----------------------------------------------
console.log('\nmachine speed table in use:');
for (const key of ['ArcSmelter', 'PlaneSmelter', 'AssemblingMachineMk1', 'AssemblingMachineMk2', 'AssemblingMachineMk3', 'RecomposingAssembler', 'ChemicalPlant', 'QuantumChemicalPlant', 'OilRefinery', 'MiniatureParticleCollider', 'MatrixLab']) {
  const b = data.building(key);
  if (!b) {
    console.log(`  ${key.padEnd(26)} MISSING`);
    continue;
  }
  console.log(`  ${key.padEnd(26)} speed=${String(b.workSpeed).padEnd(5)} power=${String(b.powerConsumptionKW).padEnd(6)} kW  id=${b.id ?? '?'}`);
}

console.log('\nrecipes by facility:');
const byFacility = new Map<string, number>();
for (const r of data.recipes) byFacility.set(r.facility, (byFacility.get(r.facility) ?? 0) + 1);
for (const [f, n] of [...byFacility.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${f.padEnd(26)} ${n}`);

console.log(failures === 0 ? '\nRESULT: PASS' : `\nRESULT: FAIL (${failures})`);
if (failures > 0) process.exitCode = 1;
