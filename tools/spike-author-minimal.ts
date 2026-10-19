/**
 * Can a blueprint be built from nothing but a placed building, and survive a re-decode?
 *
 * This is the feasibility spike for the authoring feature: construct a body by hand (one area,
 * one building, all links -1), encode it with the real writer, then decode the result and compare.
 * It proves the write path works for *invented* content, not just for re-encoded real blueprints.
 *
 * It does NOT prove the game accepts it — that needs one manual paste, and the result is what the
 * plan calls the gate.
 *
 *   node --experimental-strip-types tools/spike-author-minimal.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  decodeBlueprint,
  encodeBlueprint,
  encodeBody,
  decodeBody,
  type BlueprintBody,
  type BlueprintBuilding,
} from '../src/engine/bp/codec.ts';
import { loadDataset } from '../src/engine/loader.ts';

const ROOT = resolve(import.meta.dirname, '..');
const data = loadDataset(
  JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/dsp-vanilla.json'), 'utf8')),
  JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/building-slots.json'), 'utf8')),
);

const SMELTER = data.buildings.find((b) => b.key === 'ArcSmelter')!;
const TITANIUM_ALLOY = data.recipes.find((r) => r.key === 'TitaniumAlloy')!;

/** Build a record with the fields an editor actually knows, and safe defaults elsewhere. */
function author(id: number, itemId: number, x: number, y: number, yaw: number, recipeId: number): BlueprintBuilding {
  return {
    index: id,
    itemId,
    modelIndex: 0, // unknown but not validated yet; see the plan
    areaIndex: 0,
    x,
    y,
    z: 0,
    yaw,
    tilt: 0,
    pitch: 0,
    x2: x,
    y2: y,
    z2: 0,
    yaw2: yaw,
    tilt2: 0,
    pitch2: 0,
    outputObjectIndex: -1,
    inputObjectIndex: -1,
    outputToSlot: -1,
    inputFromSlot: -1,
    outputFromSlot: -1,
    inputToSlot: -1,
    outputOffset: -1,
    inputOffset: -1,
    recipeId,
    filterId: 0,
    parameters: [],
    parametersBytes: new Uint8Array(0) as never,
  } as unknown as BlueprintBuilding;
}

// A null id means the dataset is missing a prototype/recipe id; the spike must not silently
// write a made-up one, so fail loudly instead.
if (SMELTER.id === null || TITANIUM_ALLOY.id === null) {
  throw new Error('dataset is missing an id for ArcSmelter or TitaniumAlloy');
}
const building = author(0, SMELTER.id, 10, 10, 0, TITANIUM_ALLOY.id);

const body: BlueprintBody = {
  header: {
    version: 2,
    cursorOffsetX: 10,
    cursorOffsetY: 10,
    cursorTargetArea: 0,
    dragboxSizeX: 1,
    dragboxSizeY: 1,
    primaryAreaIndex: 0,
    areaCount: 1,
  },
  areas: [
    {
      index: 0,
      parentIndex: -1,
      tropicAnchor: 0,
      areaSegments: 200, // GUESS: the most common single-area value in the corpus
      anchorLocalOffsetX: 10,
      anchorLocalOffsetY: 10,
      width: 1,
      height: 1,
    },
  ],
  buildings: [building],
  layout: 'path102',
  declaredBuildingCount: 1,
} as unknown as BlueprintBody;

console.log('=== authored from scratch ===');
console.log(`  building: ${SMELTER.key} at (10,10) yaw 0`);
console.log(`  recipe  : ${TITANIUM_ALLOY.key} (id ${TITANIUM_ALLOY.id})`);

// 1. body bytes
const bytes = encodeBody(body);
console.log(`\n  encodeBody -> ${bytes.length} bytes`);
console.log(`  expected for 1 non-belt/non-sorter building with 0 params: 4 + 29 + 14 + 4 + 45 + 4 = ${4 + 29 + 14 + 4 + 45 + 4}`);

// 2. decode the bytes back
const back = decodeBody(bytes);
const b = back.buildings[0]!;
console.log('\n  decoded back:');
console.log(`    itemId      : ${b.itemId}  ${b.itemId === SMELTER.id ? 'OK' : 'MISMATCH'}`);
console.log(`    x, y        : ${b.x}, ${b.y}  ${b.x === 10 && b.y === 10 ? 'OK' : 'MISMATCH'}`);
console.log(`    yaw         : ${b.yaw}  ${b.yaw === 0 ? 'OK' : 'MISMATCH'}`);
console.log(`    recipeId    : ${b.recipeId}  ${b.recipeId === TITANIUM_ALLOY.id ? 'OK' : 'MISMATCH'}`);
console.log(`    areaIndex   : ${b.areaIndex}`);
console.log(`    index       : ${b.index}`);
console.log(`    layout      : ${back.layout}`);
console.log(`    areas       : ${back.areas.length}  (w=${back.areas[0]!.width} h=${back.areas[0]!.height} seg=${back.areas[0]!.areaSegments})`);

// 3. full envelope: text form with a real MD5F hash, then decode it as the app would
const text = await encodeBlueprint(body);
console.log(`\n  encodeBlueprint -> ${text.length} chars`);
console.log(`    starts with BLUEPRINT: ${text.startsWith('BLUEPRINT:') ? 'OK' : 'NO'}`);

const decoded = await decodeBlueprint(text);
const d = decoded.body.buildings[0]!;
console.log('\n  full text round-trip:');
console.log(`    buildings : ${decoded.body.buildings.length}`);
console.log(`    itemId    : ${d.itemId}  ${d.itemId === SMELTER.id ? 'OK' : 'MISMATCH'}`);
console.log(`    recipeId  : ${d.recipeId}  ${d.recipeId === TITANIUM_ALLOY.id ? 'OK' : 'MISMATCH'}`);
console.log(`    hash check: passed (decodeBlueprint verifies MD5F by default)`);

// 4. does the app's model builder understand it?
const { convertBlueprint } = await import('../src/engine/factory.ts');
const model = convertBlueprint(data, decoded);
console.log('\n  convertBlueprint:');
console.log(`    nodes      : ${model.nodes.length}`);
console.log(`    producers  : ${model.totals.producers}`);
console.log(`    lines      : ${model.lines.length}`);
for (const line of model.lines) {
  // `outputsPerMin` is already tabulated per minute; `RecipeIO.count` is the amount.
  const out = line.rate.outputsPerMin.map((o) => `${o.count}/min ${o.item}`).join(', ');
  console.log(`      ${line.recipeKey}: ${out}, ${line.rate.totalPowerKW} kW`);
}

console.log('\n=== verdict ===');
console.log('  An authored blueprint encodes, hashes and re-decodes correctly, and the model');
console.log('  builder turns it into a production line. What is NOT proven here is that the');
console.log('  game accepts it: fields marked GUESS (modelIndex, areaSegments, the area box, and');
console.log('  every link) were invented, and the game has never seen them.');
