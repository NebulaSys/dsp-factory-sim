/**
 * Reports how many belts get a measured travel direction from the connection graph versus
 * falling back to the (contradicted) yaw field.
 *
 * This quantifies the gain from `beltTravelDirection`: the yaw-based reading is known to
 * be wrong in unit and axis, so every belt the graph can orient is one fewer arrow drawn
 * from an assumption.
 *
 *   node --experimental-strip-types tools/belt-direction-coverage.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { base64ToBytes, decodeBody } from '../src/engine/bp/codec.ts';
import { gunzipBytes } from '../src/engine/bp/gzip.ts';
import { convertBlueprint } from '../src/engine/factory.ts';
import { loadDataset } from '../src/engine/loader.ts';
import { beltDirection, beltTravelDirection } from '../src/ui/glyphs.ts';

const ROOT = resolve(import.meta.dirname, '..');

async function payloadOf(rel: string): Promise<Uint8Array> {
  const text = readFileSync(resolve(ROOT, 'docs/research/_raw/realbp', rel), 'utf8').trim();
  const body = text.slice('BLUEPRINT:'.length);
  const closeQuote = body.lastIndexOf('"');
  const prefix = body.slice(0, closeQuote);
  const token = prefix.slice(prefix.lastIndexOf(',') + 1);
  const quote = token.indexOf('"');
  return gunzipBytes(base64ToBytes(token.slice(quote + 1)));
}

const data = loadDataset(JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/dsp-vanilla.json'), 'utf8')));

const FILES = [
  '仙术_Illegal_仙_无带堆叠锅13824.txt.txt',
  'docs/research/_raw/reffix/blueprint.0.10.34.28326.txt',
].map((f) => (f.includes('/') ? f.replace('docs/research/_raw/', '') : f));

for (const rel of FILES) {
  let raw: Uint8Array;
  try {
    raw = await payloadOf(rel);
  } catch {
    console.log(`${rel}: not readable`);
    continue;
  }
  const parsed = decodeBody(raw);
  const model = convertBlueprint(data, {
    format: 'text',
    meta: { timestampTicks: 0, gameVersion: '0.10.35.29104', shortDesc: '', longDesc: '', icon: { layout: 0, images: [0, 0, 0, 0, 0] } },
    body: parsed,
  });

  const measured = beltTravelDirection(model);
  const belts = model.nodes.filter((n) => n.kind === 'belt');
  let fallbackKnown = 0;
  let fallbackUnknown = 0;
  for (const b of belts) {
    if (measured.has(b.index)) continue;
    if (beltDirection(b).known) fallbackKnown++;
    else fallbackUnknown++;
  }

  console.log(`\n${rel}`);
  console.log(`  buildings          ${model.nodes.length}`);
  console.log(`  belt nodes         ${belts.length}`);
  console.log(`  measured from graph ${measured.size}${belts.length ? ` (${Math.round((measured.size / belts.length) * 100)}%)` : ''}`);
  console.log(`  yaw fallback, known ${fallbackKnown}`);
  console.log(`  yaw fallback, unknown ${fallbackUnknown}`);
}
