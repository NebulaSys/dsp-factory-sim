/**
 * Locates the object-reference field inside the body-version-1 record.
 *
 * The walk is now correct: the wind file decodes to 11 records with index == ordinal,
 * itemId 2203 (Wind Turbine) at a perfect 8-unit height ladder, and itemId 1131
 * between the turbines. The only implausible value is the second reference, which reads
 * 16777216 (0x01000000) at +49 — a byte-misaligned read of a field that is -1 elsewhere.
 *
 * This scans every 4-byte offset for the one whose value is -1 across whole files,
 * which is what a missing object reference reads as.
 *
 *   node --experimental-strip-types tools/find-v1-refs.ts
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { base64ToBytes } from '../src/engine/bp/codec.ts';
import { gunzipBytes } from '../src/engine/bp/gzip.ts';

const ROOT = resolve(import.meta.dirname, '..');
const dir = resolve(ROOT, 'docs/research/_raw/realbp');

async function payloadOf(file: string): Promise<Uint8Array> {
  const text = readFileSync(resolve(dir, file), 'utf8');
  const body = text.trim().slice('BLUEPRINT:'.length);
  const closeQuote = body.lastIndexOf('"');
  const prefix = body.slice(0, closeQuote);
  const token = prefix.slice(prefix.lastIndexOf(',') + 1);
  const quote = token.indexOf('"');
  return gunzipBytes(base64ToBytes(token.slice(quote + 1)));
}

const file = '仙术_Illegal_发电_Power_被淹死的鱼_发电堆叠蓝图集_1-风能_风能6层.txt.txt';
const raw = await payloadOf(file);
const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
const areasEnd = 29 + ((raw[28] ?? 0) as number) * 14;
const count = dv.getUint32(areasEnd, true);
const STRIDE = 61;

console.log(`${file}  count=${count} stride=${STRIDE}`);
console.log('\nvalue of every 4-byte field across the records (offset: distinct values):');
for (let off = 29; off + 4 <= STRIDE; off++) {
  const seen = new Set<number>();
  for (let i = 0; i < count; i++) seen.add(dv.getInt32(areasEnd + 4 + i * STRIDE + off, true));
  const vals = [...seen].sort((a, b) => a - b).slice(0, 6);
  console.log(`  +${off}: ${vals.join(', ')}${seen.size > 6 ? ` … (${seen.size})` : ''}`);
}

console.log('\nraw bytes of record #2 (the itemId-1131 record) with offsets:');
const at = areasEnd + 4 + 2 * STRIDE;
for (let o = 0; o < STRIDE; o += 1) {
  const b = raw[at + o]!;
  console.log(`  +${String(o).padStart(2)} = ${b.toString(16).padStart(2, '0')}${o % 8 === 7 ? '   <--' : ''}`);
}

// Which offsets hold -1 for every record of the turbine-only subset (records 0,1,3,5,..)?
console.log('\noffsets holding -1 for the odd (turbine) records only:');
for (let off = 29; off + 4 <= STRIDE; off++) {
  const odds = [0, 1, 3, 5, 7, 9].filter((i) => i < count);
  const allMinus1 = odds.every((i) => dv.getInt32(areasEnd + 4 + i * STRIDE + off, true) === -1);
  const evens = [2, 4, 6, 8, 10].filter((i) => i < count);
  const evensNotMinus1 = evens.every((i) => dv.getInt32(areasEnd + 4 + i * STRIDE + off, true) !== -1);
  if (allMinus1 && evensNotMinus1) console.log(`  +${off}: -1 on turbines, other on the 1131 records`);
}
