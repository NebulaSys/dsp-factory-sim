/**
 * Measures the geometry the belt and sorter glyphs have to represent.
 *
 * Read off the decoded corpus rather than guessed, because the glyph design depends on it:
 * how far a sorter actually reaches, how long a belt run is, and how many links cross a
 * vertical layer (which the exploded view stretches into long diagonals).
 *
 *   node --experimental-strip-types tools/measure-glyph-geometry.ts
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { base64ToBytes, decodeBody } from '../src/engine/bp/codec.ts';
import { gunzipBytes } from '../src/engine/bp/gzip.ts';
import { convertBlueprint } from '../src/engine/factory.ts';
import { loadDataset } from '../src/engine/loader.ts';

const ROOT = resolve(import.meta.dirname, '..');
const dir = resolve(ROOT, 'docs/research/_raw/realbp');
const data = loadDataset(JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/dsp-vanilla.json'), 'utf8')));

async function payloadOf(file: string): Promise<Uint8Array> {
  const text = readFileSync(resolve(dir, file), 'utf8');
  const body = text.trim().slice('BLUEPRINT:'.length);
  const closeQuote = body.lastIndexOf('"');
  const prefix = body.slice(0, closeQuote);
  const token = prefix.slice(prefix.lastIndexOf(',') + 1);
  const quote = token.indexOf('"');
  return gunzipBytes(base64ToBytes(token.slice(quote + 1)));
}

const sorterSpans = new Map<number, number>();
const layerGaps = new Map<number, number>();
const beltRunLens: number[] = [];
let sorterTotal = 0;
let beltTotal = 0;
let crossLayerLinks = 0;
let totalLinks = 0;

for (const file of readdirSync(dir).filter((f) => f.endsWith('.txt')).sort()) {
  let raw: Uint8Array;
  try {
    raw = await payloadOf(file);
  } catch {
    continue;
  }
  let parsed;
  try {
    parsed = decodeBody(raw);
  } catch {
    continue;
  }
  if (parsed.buildings.length === 0) continue;

  const model = convertBlueprint(data, {
    format: 'text',
    meta: { timestampTicks: 0, gameVersion: '0.10.35.29104', shortDesc: '', longDesc: '', icon: { layout: 0, images: [0, 0, 0, 0, 0] } },
    body: parsed,
  });
  const byIndex = new Map(model.nodes.map((n) => [n.index, n]));

  for (const node of model.nodes) {
    if (node.kind === 'sorter') {
      sorterTotal++;
      const from = node.picksUpFrom;
      const to = node.dropsOffAt;
      if (from && to) {
        // Endpoint distance in whole cells, which is what the glyph has to span.
        const span = Math.round(Math.hypot(to.x - from.x, to.y - from.y));
        sorterSpans.set(span, (sorterSpans.get(span) ?? 0) + 1);
      }
    }
    if (node.kind === 'belt') {
      beltTotal++;
    }
    for (const target of node.outputsTo) {
      const to = byIndex.get(target);
      if (!to) continue;
      totalLinks++;
      const cellGap = Math.round(Math.hypot(to.x - node.x, to.y - node.y));
      const zGap = Math.round(Math.abs(to.z - node.z));
      layerGaps.set(zGap, (layerGaps.get(zGap) ?? 0) + 1);
      if (zGap > 0 && cellGap === 0) crossLayerLinks++;
    }
  }

  // Belt run length: count belts whose travelDirection points at another belt.
  let run = 0;
  for (const node of model.nodes) {
    if (node.kind !== 'belt') continue;
    const target = node.outputsTo[0];
    const to = target == null ? undefined : byIndex.get(target);
    if (to && to.kind === 'belt') run++;
  }
  beltRunLens.push(run);
}

console.log(`sorters ${sorterTotal}   belts ${beltTotal}   links ${totalLinks}`);
console.log(`\nsorter endpoint span (cells -> count):`);
for (const [s, c] of [...sorterSpans.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  ${String(s).padStart(3)} cells  ${c}`);
}
console.log(`\nlink z-gap (layers -> count):`);
for (const [g, c] of [...layerGaps.entries()].sort((a, b) => a[0] - b[0]).slice(0, 8)) {
  console.log(`  ${String(g).padStart(3)} layers  ${c}`);
}
console.log(`\nlinks that connect the same cell on different layers (become long diagonals in the exploded view): ${crossLayerLinks}`);
console.log(`belts whose link target is another belt: ${beltRunLens.reduce((a, b) => a + b, 0)} of ${beltTotal}`);
