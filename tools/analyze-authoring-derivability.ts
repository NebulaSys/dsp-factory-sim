/**
 * Can the fields an editor must invent be *derived* from things we already know?
 *
 * Follow-up to analyze-authoring-requirements.ts. An editor knows the item id, position and
 * rotation of everything it places; it does not know modelIndex, areaSegments or tropicAnchor.
 * This asks whether those are functions of data we have, or genuinely unknown rules that would
 * have to be guessed (and therefore verified against the game).
 *
 *   node --experimental-strip-types tools/analyze-authoring-derivability.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeBlueprint } from '../src/engine/bp/codec.ts';
import { loadDataset } from '../src/engine/loader.ts';

const ROOT = resolve(import.meta.dirname, '..');
const data = loadDataset(JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/dsp-vanilla.json'), 'utf8')));
const keyOf = new Map(data.buildings.map((b) => [b.id, b.key]));
const DIRS = ['docs/research/_raw/realbp', 'docs/research/_raw/realbp2'];

interface FileInfo {
  name: string;
  modelIndexByItem: Map<number, Set<number>>;
  areaSegments: number[];
  tropicAnchor: number[];
  areaCount: number;
  buildingCount: number;
}

const files: FileInfo[] = [];
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
    const m = new Map<number, Set<number>>();
    for (const b of bp.body.buildings) {
      if (!m.has(b.itemId)) m.set(b.itemId, new Set());
      m.get(b.itemId)!.add(b.modelIndex);
    }
    files.push({
      name: f,
      modelIndexByItem: m,
      areaSegments: bp.body.areas.map((a) => a.areaSegments),
      tropicAnchor: bp.body.areas.map((a) => a.tropicAnchor),
      areaCount: bp.body.areas.length,
      buildingCount: bp.body.buildings.length,
    });
  }
}

console.log(`files: ${files.length}\n`);

// ---------------------------------------------------------------- modelIndex
// Is modelIndex a function of itemId? Pool every (itemId -> modelIndex) pair across the corpus.
const globalByItem = new Map<number, Set<number>>();
for (const fi of files) {
  for (const [item, set] of fi.modelIndexByItem) {
    if (!globalByItem.has(item)) globalByItem.set(item, new Set());
    for (const v of set) globalByItem.get(item)!.add(v);
  }
}

let itemsSingle = 0;
let itemsMulti = 0;
const multiDetail: string[] = [];
for (const [item, set] of globalByItem) {
  if (set.size === 1) itemsSingle++;
  else {
    itemsMulti++;
    if (multiDetail.length < 12) multiDetail.push(`${keyOf.get(item) ?? item} -> {${[...set].sort((a, b) => a - b).join(',')}}`);
  }
}
console.log('=== is modelIndex a function of itemId? ===');
console.log(`  distinct itemIds: ${globalByItem.size}`);
console.log(`  ... with a SINGLE modelIndex across the whole corpus: ${itemsSingle}`);
console.log(`  ... with MULTIPLE modelIndex values:                  ${itemsMulti}`);
if (multiDetail.length) {
  console.log('  examples of prototypes that vary (so modelIndex is NOT just the prototype):');
  for (const d of multiDetail) console.log('    ' + d);
}

// ---------------------------------------------------------------- areaSegments
console.log('\n=== areaSegments: is it constant within a file, and across files? ===');
const segWithinFileConst = files.filter((f) => new Set(f.areaSegments).size === 1).length;
const segGlobal = new Map<number, number>();
for (const f of files) for (const v of new Set(f.areaSegments)) segGlobal.set(v, (segGlobal.get(v) ?? 0) + 1);
console.log(`  constant within the file: ${segWithinFileConst} / ${files.length}`);
console.log(`  distinct values across the corpus: ${[...segGlobal.keys()].sort((a, b) => a - b).join(', ')}`);
console.log('  does it correlate with the area count?');
for (const f of files.slice(0, 10)) {
  console.log(`    areas=${f.areaCount}  segments=[${f.areaSegments.join(',')}]  bldgs=${f.buildingCount}  ${f.name.slice(0, 34)}`);
}

// ---------------------------------------------------------------- tropicAnchor
console.log('\n=== tropicAnchor: same question ===');
const tropWithinFileConst = files.filter((f) => new Set(f.tropicAnchor).size === 1).length;
console.log(`  constant within the file: ${tropWithinFileConst} / ${files.length}`);
const tropGlobal = new Map<number, number>();
for (const f of files) for (const v of new Set(f.tropicAnchor)) tropGlobal.set(v, (tropGlobal.get(v) ?? 0) + 1);
console.log(`  distinct values: ${[...tropGlobal.keys()].sort((a, b) => a - b).join(', ')}`);
console.log('  per-file (first 10):');
for (const f of files.slice(0, 10)) {
  console.log(`    areas=${f.areaCount}  tropicAnchor=[${f.tropicAnchor.join(',')}]  ${f.name.slice(0, 34)}`);
}

// ---------------------------------------------------------------- single area
const single = files.filter((f) => f.areaCount === 1).length;
console.log('\n=== scope of a single-area MVP ===');
console.log(`  blueprints with exactly ONE area: ${single} / ${files.length} (${((single / files.length) * 100).toFixed(0)}%)`);
console.log('  => an editor that only produces area 0 covers most real blueprints.');
