/**
 * Places the slot block inside the body-version-1 record by exhaustive offset check.
 *
 * The head is settled (index, areaIndex, two Vector3, prototype id at +37) and a
 * 61-byte stride walks 10 files exactly when the slot block is skipped, so the error
 * is in where the six int8 slot bytes and the trailing count live.
 *
 * This scans candidate offsets for `parameterCount` and reports which one is zero for
 * every record of a large file, which pins the tail down without guessing.
 *
 *   node --experimental-strip-types tools/find-v1-tail.ts
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { base64ToBytes } from '../src/engine/bp/codec.ts';
import { gunzipBytes } from '../src/engine/bp/gzip.ts';

const ROOT = resolve(import.meta.dirname, '..');
const dir = resolve(ROOT, 'docs/research/_raw/realbp');
const files = readdirSync(dir).filter((f) => f.endsWith('.txt')).sort();

async function payloadOf(file: string): Promise<Uint8Array> {
  const text = readFileSync(resolve(dir, file), 'utf8');
  const body = text.trim().slice('BLUEPRINT:'.length);
  const closeQuote = body.lastIndexOf('"');
  const prefix = body.slice(0, closeQuote);
  const token = prefix.slice(prefix.lastIndexOf(',') + 1);
  const quote = token.indexOf('"');
  return gunzipBytes(base64ToBytes(token.slice(quote + 1)));
}

/** The wind file walks exactly at 61 with index == ordinal for all records. */
const file = '仙术_Illegal_发电_Power_被淹死的鱼_发电堆叠蓝图集_1-风能_风能6层.txt.txt';
const raw = await payloadOf(file);
const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
const areasEnd = 29 + ((raw[28] ?? 0) as number) * 14;
const count = dv.getUint32(areasEnd, true);
const STRIDE = 61;
console.log(`${file}\ncount=${count} stride=${STRIDE}`);

console.log('\nfull hex of records 0..2:');
for (let i = 0; i < Math.min(3, count); i++) {
  const at = areasEnd + 4 + i * STRIDE;
  for (let w = 0; w < STRIDE; w += 8) {
    const slice = raw.subarray(at + w, Math.min(at + w + 8, at + STRIDE));
    console.log(`  #${i} +${String(w).padStart(2)}  ${[...slice].map((b) => b.toString(16).padStart(2, '0')).join(' ')}`);
  }
}

console.log('\ncandidate `parameterCount` offsets (u16 == 0 for every record):');
for (let off = 33; off + 2 <= STRIDE; off++) {
  let allZero = true;
  for (let i = 0; i < count && allZero; i++) {
    if (dv.getUint16(areasEnd + 4 + i * STRIDE + off, true) !== 0) allZero = false;
  }
  if (allZero) console.log(`  +${off}: always 0`);
}

console.log('\ncandidate single-byte columns (constant value), offsets 33..60:');
for (let off = 33; off < STRIDE; off++) {
  const seen = new Set<number>();
  for (let i = 0; i < count; i++) seen.add(raw[areasEnd + 4 + i * STRIDE + off]!);
  if (seen.size <= 2) {
    console.log(`  +${off}: [${[...seen].map((v) => v.toString(16).padStart(2, '0')).join(' ')}]`);
  }
}
