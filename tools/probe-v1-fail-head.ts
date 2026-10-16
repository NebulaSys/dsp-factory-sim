/**
 * Inspects what actually sits at the second record of the failing v1 blueprints.
 *
 * The failing files all fail at record 1, and their header declares a 25x25 drag box where
 * the decodable files declare 1x1. Reading the bytes at the offset where ordinal 1 first
 * appears shows whether the record head layout differs there.
 *
 *   node --experimental-strip-types tools/probe-v1-fail-head.ts
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
  try {
    decoded = decodeBody(raw).buildings.length;
  } catch {
    /* failure is the point */
  }
  if (decoded > 0) continue;

  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const areaCount = (raw[28] ?? 0) as number;
  const start = 29 + areaCount * 14 + 4;
  const count = dv.getUint32(start - 4, true);

  // First offset where ordinal 1 appears.
  let one = -1;
  for (let at = start; at + 4 <= raw.length; at++) {
    if (dv.getInt32(at, true) === 1) {
      one = at - start;
      break;
    }
  }
  console.log(`\n${'='.repeat(78)}`);
  console.log(`${file}`);
  console.log(`  count=${count}  dragbox=(u32@16)=${dv.getUint32(16, true)},(u32@20)=${dv.getUint32(20, true)}  first ordinal 1 at +${one}`);
  if (one < 0) continue;

  console.log(`  bytes around the first ordinal 1 (record-relative):`);
  const from = Math.max(0, one - 16);
  for (let at = start + from; at < Math.min(start + one + 64, raw.length); at += 8) {
    const slice = raw.subarray(at, Math.min(at + 8, raw.length));
    const hex = [...slice].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    console.log(`    +${String(at - start).padStart(4)}  ${hex}`);
  }

  // What would the v1 head look like at that offset?
  const at = start + one;
  const id = dv.getInt16(at + 37, true);
  console.log(
    `  as a v1 head at +${one}: index=${dv.getInt32(at, true)} areaIndex=${dv.getUint8(at + 4)}` +
      ` yaw=${dv.getFloat32(at + 29, true).toPrecision(4)} itemId=${id} model=${dv.getInt16(at + 39, true)}`,
  );

  // Scan the first 64 bytes after the boundary for any 2-byte value that is a building id.
  const hits: string[] = [];
  for (let o = 0; o + 2 <= 64 && at + o + 2 <= raw.length; o++) {
    const v = dv.getInt16(at + o, true);
    if (v >= 1100 && v <= 5100) hits.push(`+${o}=${v}`);
  }
  console.log(`  building-id-looking int16 within 64 bytes: ${hits.slice(0, 12).join(', ') || 'none'}`);
}
