/**
 * Independent verification of the ID mappings used by the simulator.
 *
 * Fetches the authoritative wiki ID pages and compares them against the
 * dataset that the engine will ship with. Any mismatch means blueprints
 * imported from the game would be decoded onto the wrong item/recipe, so this
 * is a hard gate rather than a warning.
 *
 * Usage: node tools/verify-ids.mjs [datasetFile]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const WIKI = 'https://dsp-wiki.com/api.php';

async function fetchWikitext(title) {
  const url = `${WIKI}?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&formatversion=2`;
  const res = await fetch(url, { headers: { 'user-agent': 'dsp-factory-sim/0.1 (data verification)' } });
  if (!res.ok) throw new Error(`${title}: HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`${title}: ${json.error.info}`);
  return json.parse.wikitext;
}

/** Parse `| <id>|| <name>` rows out of a wikitable. */
function parseIdTable(wikitext) {
  const rows = [];
  for (const rawLine of wikitext.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('|')) continue;
    if (line.startsWith('|-') || line.startsWith('|+') || line.startsWith('|}')) continue;
    const cells = line
      .replace(/^\|/, '')
      .split('||')
      .map((c) => c.trim());
    if (cells.length < 2) continue;
    const id = Number.parseInt(cells[0].replace(/[[\]]/g, '').trim(), 10);
    if (!Number.isFinite(id)) continue;
    const name = cells[1]
      .replace(/\[\[([^|\]]*)\|([^\]]*)\]\]/g, '$2')
      .replace(/\[\[([^\]]*)\]\]/g, '$1')
      .replace(/'''?/g, '')
      .trim();
    rows.push({ id, name });
  }
  return rows;
}

/** Normalise a display name so "Iron ingot" == "Iron Ingot". */
function norm(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

/**
 * The wiki's ID pages, the game's own protoset names and community calculators
 * disagree on display names for the same prototype. Compare on a canonical form
 * with synonym folding so only genuine id mismatches are reported.
 */
const NAME_EQUIVALENCE = [
  [/\bdepot\b/g, 'storage'],
  [/\binterstellar\s+logistics\s+vessel\b/g, 'vessel'],
  [/\blogistics\s+vessel\b/g, 'vessel'],
  [/\blogistics\s+drone\b/g, 'drone'],
  [/\blogistics\s+bot\b/g, 'bot'],
  [/\bpower\s+(station|plant)\b/g, 'powerplant'],
  [/\bspiniform\s+stalagmite\s+crystal\b/g, 'stalagmitecrystal'],
  [/\bself[- ]?evolution\s+lab\b/g, 'selfevolutionlab'],
  [/\bselfevolutionlab\b/g, 'selfevolutionlab'],
  [/\baccumulator\s*\(?full\)?\b/g, 'accumulatorfull'],
];

function semanticName(s) {
  let out = String(s).toLowerCase();
  for (const [pattern, replacement] of NAME_EQUIVALENCE) out = out.replace(pattern, replacement);
  return out.replace(/[^a-z0-9]+/g, '');
}

/** "Iron ingot" -> "IronIngot" style prototype key guess. */
function displayNameToKey(name, aliases = {}) {
  const n = norm(name);
  if (aliases[n]) return aliases[n];
  return name
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

const ALIASES = {
  ironingot: 'IronIngot',
  copperingot: 'CopperIngot',
  magnet: 'Magnet',
  gear: 'Gear',
  magneticcoil: 'MagneticCoil',
  circuitboard: 'CircuitBoard',
  highspeedprocessor: 'Processor',
  electromagneticmatrix: 'ElectromagneticMatrix',
  energymatrix: 'EnergyMatrix',
  structurematrix: 'StructureMatrix',
  informationmatrix: 'InformationMatrix',
  gravitymatrix: 'GravityMatrix',
  universematrix: 'UniverseMatrix',
  proliferatormki: 'ProliferatorMk1',
  proliferatormkii: 'ProliferatorMk2',
  proliferatormkiii: 'ProliferatorMk3',
  assemblingmachinemki: 'AssemblingMachineMk1',
  assemblingmachinemkii: 'AssemblingMachineMk2',
  assemblingmachinemkiii: 'AssemblingMachineMk3',
  arcfurnace: 'ArcSmelter',
  arcsmelter: 'ArcSmelter',
  planesmelter: 'PlaneSmelter',
  matrixlab: 'MatrixLab',
  miningmachine: 'MiningMachine',
  waterpump: 'WaterPump',
  oilextractor: 'OilExtractor',
  oilrefinery: 'OilRefinery',
  chemicalplant: 'ChemicalPlant',
  quantumchemicalplant: 'QuantumChemicalPlant',
  miniatureparticlecollider: 'MiniatureParticleCollider',
  fractionator: 'Fractionator',
  conveyorbyourself: 'ConveyorBeltMk1',
};

async function main() {
  const datasetPath = resolve(process.argv[2] ?? 'src/engine/data/dsp-vanilla.json');
  const outDir = resolve('docs/research');
  mkdirSync(outDir, { recursive: true });

  console.log('fetching authoritative wiki ID tables…');
  const [itemWt, recipeWt] = await Promise.all([fetchWikitext('Modding:Items IDs'), fetchWikitext('Modding:Recipe IDs')]);
  const wikiItems = parseIdTable(itemWt);
  const wikiRecipes = parseIdTable(recipeWt);
  console.log(`  wiki items: ${wikiItems.length}, wiki recipes: ${wikiRecipes.length}`);

  writeFileSync(resolve(outDir, 'wiki-item-ids.json'), JSON.stringify(wikiItems, null, 1));
  writeFileSync(resolve(outDir, 'wiki-recipe-ids.json'), JSON.stringify(wikiRecipes, null, 1));

  let dataset;
  try {
    dataset = JSON.parse(readFileSync(datasetPath, 'utf8'));
  } catch (err) {
    console.error(`cannot read dataset ${datasetPath}: ${err.message}`);
    process.exitCode = 2;
    return;
  }

  const report = { itemIdMismatches: [], recipeIdMismatches: [], missing: [], checked: {} };

  // ---- items ------------------------------------------------------------
  const wikiItemById = new Map(wikiItems.map((r) => [r.id, r]));
  const wikiItemByName = new Map(wikiItems.map((r) => [semanticName(r.name), r]));
  const dsItems = dataset.items ?? [];
  report.checked.items = dsItems.length;
  report.namingVariants = [];
  for (const item of dsItems) {
    if (item.id == null) continue;
    const byId = wikiItemById.get(item.id);
    const byName = wikiItemByName.get(semanticName(item.name));
    if (byId) {
      // The id exists on the wiki; only a differing *meaning* is a mismatch.
      if (semanticName(byId.name) !== semanticName(item.name)) {
        report.itemIdMismatches.push({ id: item.id, dataset: item.name, wiki: byId.name });
      } else if (byId.name !== item.name) {
        report.namingVariants.push({ id: item.id, dataset: item.name, wiki: byId.name });
      }
    } else if (byName && byName.id !== item.id) {
      report.itemIdMismatches.push({ id: item.id, dataset: item.name, wikiName: byName.name, expectedId: byName.id });
    } else if (!byName) {
      report.missing.push({ kind: 'item', id: item.id, name: item.name, reason: 'not present on the wiki ID page' });
    }
  }

  // ---- recipes ----------------------------------------------------------
  const wikiRecipeById = new Map(wikiRecipes.map((r) => [r.id, r]));
  const wikiRecipeByName = new Map(wikiRecipes.map((r) => [semanticName(r.name), r]));
  const dsRecipes = dataset.recipes ?? [];
  report.checked.recipes = dsRecipes.length;
  for (const recipe of dsRecipes) {
    if (recipe.id == null) continue;
    const byId = wikiRecipeById.get(recipe.id);
    const label = recipe.name ?? recipe.key;
    const byName = wikiRecipeByName.get(semanticName(label));
    if (byId && byName && byId.name !== byName.name) {
      report.recipeIdMismatches.push({ id: recipe.id, dataset: label, wikiById: byId.name, wikiByName: byName.name });
    } else if (!byId && byName && byName.id !== recipe.id) {
      report.recipeIdMismatches.push({ id: recipe.id, dataset: label, expectedId: byName.id, wikiName: byName.name });
    } else if (!byId && !byName) {
      report.missing.push({ kind: 'recipe', id: recipe.id, name: label, reason: 'not present on the wiki ID page' });
    }
  }

  // ---- cross check: recipe outputs must be items ------------------------
  const itemKeys = new Set(dsItems.map((i) => i.key));
  const dangling = [];
  for (const recipe of dsRecipes) {
    for (const io of [...(recipe.inputs ?? []), ...(recipe.outputs ?? [])]) {
      if (!itemKeys.has(io.item)) dangling.push({ recipe: recipe.key, item: io.item });
    }
  }
  report.danglingItems = dangling;

  writeFileSync(resolve(outDir, 'id-verification.json'), JSON.stringify(report, null, 1));

  console.log('\n=== ID verification ===');
  console.log(`items checked : ${report.checked.items}`);
  console.log(`recipes checked: ${report.checked.recipes}`);
  console.log(`item id mismatches   : ${report.itemIdMismatches.length}`);
  for (const m of report.itemIdMismatches.slice(0, 20)) console.log(`  ! ${JSON.stringify(m)}`);
  console.log(`recipe id mismatches : ${report.recipeIdMismatches.length}`);
  for (const m of report.recipeIdMismatches.slice(0, 20)) console.log(`  ! ${JSON.stringify(m)}`);
  console.log(`unknown to wiki      : ${report.missing.length}`);
  for (const m of report.missing.slice(0, 20)) console.log(`  ? ${JSON.stringify(m)}`);
  console.log(`dangling item refs   : ${dangling.length}`);
  for (const d of dangling.slice(0, 20)) console.log(`  ? ${JSON.stringify(d)}`);

  const ok = report.itemIdMismatches.length === 0 && report.recipeIdMismatches.length === 0 && dangling.length === 0;
  console.log(ok ? '\nRESULT: PASS' : '\nRESULT: FAIL');
  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
