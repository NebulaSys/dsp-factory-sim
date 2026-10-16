/**
 * Diagnoses the body-version-1 blueprints that still fail to decode.
 *
 * Six of the 28 cached blueprints remain undecodable. They fail at the *second* record, so
 * the cause has to be visible in the first one rather than in a trailing block. This prints,
 * for each failure, the header fields and the first bytes of the record area with the
 * candidate head fields annotated at the offsets the decoded family established.
 *
 *   node --experimental-strip-types tools/diagnose-v1-failures.ts
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { base64ToBytes, decodeBody } from '../src/engine/bp/codec.ts';
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

for (const file of readdirSync(dir).filter((f) => f.endsWith('.txt')).sort()) {
  let raw: Uint8Array;
  try {
    raw = await payloadOf(file);
  } catch {
    continue;
  }
  if (raw[0] !== 1) continue;

  let decoded = 0;
  let err = '';
  try {
    decoded = decodeBody(raw).buildings.length;
  } catch (e) {
    err = (e as Error).message.slice(0, 90);
  }
  if (decoded > 0) continue;

  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const areaCount = (raw[28] ?? 0) as number;
  const areasEnd = 29 + areaCount * 14;
  const count = dv.getUint32(areasEnd, true);
  const start = areasEnd + 4;
  const area = raw.length - start;

  console.log(`\n${'='.repeat(78)}`);
  console.log(`${file}`);
  console.log(`  areaCount=${areaCount} areasEnd=${areasEnd} count=${count} area=${area} err="${err}"`);
  console.log(`  header u32x7: ${Array.from({ length: 7 }, (_, i) => dv.getUint32(i * 4, true)).join(', ')}`);
  console.log(`  first 10 areaIndex bytes: ${[...raw.subarray(29, 29 + Math.min(10, areaCount))].join(', ')}`);

  if (count === 0 || count > 200000 || area <= 0) {
    console.log('  (count or area unusable)');
    continue;
  }

  console.log(`\n  first bytes of the record area (record-relative):`);
  for (let at = start; at < Math.min(start + 128, raw.length); at += 8) {
    const slice = raw.subarray(at, Math.min(at + 8, raw.length));
    const hex = [...slice].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    console.log(`    +${String(at - start).padStart(4)}  ${hex}`);
  }

  // Annotate the head fields the decoded family established, at the first record only.
  const id = dv.getInt16(start + 37, true);
  const areaIdx = dv.getUint8(start + 4);
  console.log(
    `\n  record 0 as a v1 head: index=${dv.getInt32(start, true)} areaIndex=${areaIdx}` +
      ` yaw=${dv.getFloat32(start + 29, true).toPrecision(6)} yaw2=${dv.getFloat32(start + 33, true).toPrecision(6)}` +
      ` itemId=${id} model=${dv.getInt16(start + 39, true)}`,
  );
  console.log(`  head checks: itemId in 1100..5100 -> ${id >= 1100 && id <= 5100}; areaIndex < areaCount -> ${areaIdx < Math.max(1, areaCount)}`);

  // Does the ordinal sequence start at all?
  console.log(`\n  offsets holding ordinal 0 as i32 (first 8):`);
  const zeros: number[] = [];
  for (let at = start; at + 4 <= raw.length && zeros.length < 8; at++) {
    if (dv.getInt32(at, true) === 0) zeros.push(at - start);
  }
  console.log(`    ${zeros.join(', ')}`);
  console.log(`  offsets holding ordinal 1 as i32 (first 8):`);
  const ones: number[] = [];
  for (let at = start; at + 4 <= raw.length && ones.length < 8; at++) {
    if (dv.getInt32(at, true) === 1) ones.push(at - start);
  }
  console.log(`    ${ones.join(', ')}`);
}
