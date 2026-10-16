/**
 * Reports how many cached real blueprints decode and how many buildings they yield.
 *
 *   node --experimental-strip-types tools/corpus-status.ts
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { requireCorpus } from './lib/corpus.ts';
import { base64ToBytes, decodeBody } from '../src/engine/bp/codec.ts';
import { gunzipBytes } from '../src/engine/bp/gzip.ts';

const ROOT = resolve(import.meta.dirname, '..');
const dir = resolve(ROOT, 'docs/research/_raw/realbp');
const files = requireCorpus('realbp', 'the corpus decode report');

function payloadPath(file: string): string {
  return resolve(dir, file);
}

let decodedFiles = 0;
let totalBuildings = 0;
let headerOnly = 0;
let failed = 0;
const perFile: { file: string; buildings: number; version: number }[] = [];

for (const file of files) {
  try {
    const text = readFileSync(payloadPath(file), 'utf8').trim();
    const body = text.slice('BLUEPRINT:'.length);
    const closeQuote = body.lastIndexOf('"');
    const prefix = body.slice(0, closeQuote);
    const token = prefix.slice(prefix.lastIndexOf(',') + 1);
    const quote = token.indexOf('"');
    const raw = await gunzipBytes(base64ToBytes(token.slice(quote + 1)));
    const parsed = decodeBody(raw);
    if (parsed.buildings.length > 0) {
      decodedFiles++;
      totalBuildings += parsed.buildings.length;
      perFile.push({ file, buildings: parsed.buildings.length, version: raw[0] ?? -1 });
    } else {
      headerOnly++;
    }
  } catch {
    failed++;
  }
}

perFile.sort((a, b) => b.buildings - a.buildings);
console.log('decoded blueprints (largest first):');
for (const p of perFile) {
  console.log(`  v${p.version}  ${String(p.buildings).padStart(6)} buildings  ${p.file.slice(0, 46)}`);
}
console.log(`\ncached real blueprints : ${files.length}`);
console.log(`  decoded with buildings: ${decodedFiles}`);
console.log(`  header/areas only     : ${headerOnly}`);
console.log(`  failed to parse       : ${failed}`);
console.log(`  TOTAL buildings       : ${totalBuildings}`);
