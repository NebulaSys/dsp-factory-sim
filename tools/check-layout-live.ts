/**
 * Runs the codec straight from source with no bundler in the way.
 *
 *   node --experimental-strip-types tools/check-layout-live.ts
 *
 * This exists because the Vitest run kept executing the previous 8-byte belt
 * branch while the file on disk had the corrected 4-byte one, so a bundler-side
 * cache was masking the fix. Running the module directly tells the two apart.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { base64ToBytes, decodeBody, buildingRecordSize } from '../src/engine/bp/codec.ts';
import { gunzipBytes } from '../src/engine/bp/gzip.ts';

const ROOT = resolve(import.meta.dirname, '..');
const text = readFileSync(resolve(ROOT, 'docs/research/_raw/reffix/blueprint.0.10.34.28326.txt'), 'utf8').trim();
const body = text.slice('BLUEPRINT:'.length);
const closeQuote = body.lastIndexOf('"');
const prefix = body.slice(0, closeQuote);
const tailToken = prefix.slice(prefix.lastIndexOf(',') + 1);
const raw = await gunzipBytes(base64ToBytes(tailToken.slice(tailToken.indexOf('"') + 1)));
const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);

const recStart = 29 + ((raw[28] ?? 0) as number) * 14 + 4;
console.log(`body=${raw.length}B recStart=${recStart}`);
console.log(`belt record size reported by the module: ${buildingRecordSize(2001, 0)} (must be 57)`);

// Where does a belt record's out/in sit according to the module's own reader?
// out should be 2 for record 0; if the module still has the 8-byte block it reads -1.
try {
  const decoded = decodeBody(raw);
  console.log(`decoded OK: ${decoded.buildings.length} buildings`);
  for (const b of decoded.buildings.slice(0, 6)) {
    console.log(`  #${b.index} item=${b.itemId} (${b.x.toFixed(0)},${b.y.toFixed(0)}) out=${b.outputObjectIndex} in=${b.inputObjectIndex}`);
  }
} catch (err) {
  console.log('decode FAILED:', (err as Error).message.slice(0, 200));
}

// Independent expectation straight from the bytes.
console.log('\nraw expectations from bytes:');
for (const i of [0, 1, 2, 5]) {
  const base = recStart + i * 57;
  console.log(
    `  #${i} index=${dv.getInt32(base + 4, true)} item=${dv.getInt16(base + 8, true)} out=${dv.getInt32(base + 33, true)} in=${dv.getInt32(base + 37, true)}`,
  );
}
