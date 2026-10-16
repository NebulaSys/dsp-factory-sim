/**
 * End-to-end check: load a real game blueprint through the whole simulator pipeline.
 *
 * The point of decoding v1 was to make real blueprints usable, so this decodes the
 * largest cached v1 blueprint and runs it through `convertBlueprint` against the shipped
 * dataset, reporting the computed production lines. It is the difference between "the
 * bytes parse" and "the simulator can use the blueprint".
 *
 *   node --experimental-strip-types tools/e2e-real-blueprint.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { base64ToBytes, decodeBody } from '../src/engine/bp/codec.ts';
import { gunzipBytes } from '../src/engine/bp/gzip.ts';
import { convertBlueprint } from '../src/engine/factory.ts';
import { loadDataset } from '../src/engine/loader.ts';

const ROOT = resolve(import.meta.dirname, '..');
import { requireCorpus } from './lib/corpus.ts';
// End-to-end on real blueprints; needs the corpus (see tools/fetch-corpus.mjs).
requireCorpus('realbp', 'the real-blueprint end-to-end run');

const FILES = [
  'docs/research/_raw/realbp/仙术_Illegal_发电_Power_被淹死的鱼_发电堆叠蓝图集_3-太阳能_极地_p-极地太阳能16层.txt.txt',
  'docs/research/_raw/realbp/仙术_Illegal_仙_无带堆叠锅13824.txt.txt',
];

const datasetJson = JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/dsp-vanilla.json'), 'utf8')) as object;
const data = loadDataset(datasetJson);

for (const rel of FILES) {
  const text = readFileSync(resolve(ROOT, rel), 'utf8').trim();
  const body = text.slice('BLUEPRINT:'.length);
  const closeQuote = body.lastIndexOf('"');
  const prefix = body.slice(0, closeQuote);
  const token = prefix.slice(prefix.lastIndexOf(',') + 1);
  const quote = token.indexOf('"');
  const raw = await gunzipBytes(base64ToBytes(token.slice(quote + 1)));

  const parsed = decodeBody(raw);
  console.log(`\n${'='.repeat(72)}`);
  console.log(`file      ${rel.split('/').pop()}`);
  console.log(`body v${raw[0]}  layout=${parsed.layout}  buildings=${parsed.buildings.length}  areas=${parsed.areas.length}`);

  // Prototype histogram, so the content is visible.
  const byProto = new Map<number, number>();
  for (const b of parsed.buildings) byProto.set(b.itemId, (byProto.get(b.itemId) ?? 0) + 1);
  const top = [...byProto.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  console.log('top prototypes:');
  for (const [id, n] of top) {
    const def = data.buildingByIdOrUndefined(id);
    console.log(`  ${String(id).padStart(5)} × ${String(n).padStart(5)}  ${def ? `${def.name} (${def.nameZh})` : 'UNKNOWN'}`);
  }

  const model = convertBlueprint(data, { body: parsed, meta: {
    timestampTicks: 0, gameVersion: '0.10.35.29104', shortDesc: '', longDesc: '', icon: { layout: 0, images: [0, 0, 0, 0, 0] },
  }, format: 'text' });

  console.log(`\nsimulator result:`);
  console.log(`  nodes            ${model.nodes.length}`);
  console.log(`  producers        ${model.totals.producers}`);
  console.log(`  belts            ${model.totals.belts}`);
  console.log(`  sorters          ${model.totals.sorters}`);
  console.log(`  unknown protos   ${model.unknown.length}${model.unknown.length ? ` (${model.unknown.slice(0, 4).map((u) => u.itemId).join(', ')})` : ''}`);
  console.log(`  crafting power   ${model.totals.craftingPowerKW} kW`);
  console.log(`  warnings         ${model.totals.warnings.length}`);
  for (const w of model.totals.warnings.slice(0, 3)) console.log(`      ${w}`);
  if (model.lines.length > 0) {
    console.log('  production lines:');
    for (const line of model.lines.slice(0, 6)) {
      console.log(`      ${line.recipeKey.padEnd(22)} ×${String(line.machines).padStart(4)}  ${line.rate.craftsPerMinPerMachine.toFixed(1)}/min/machine`);
    }
  }
}
