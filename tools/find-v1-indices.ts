/**
 * Locates the `index` field in a body-version-1 blueprint whose records are not equal
 * sized.
 *
 * For the 4-building fire-plant file the record area is 256 bytes and `index` reads 0 at
 * the first record and 3 at what a 64-byte stride calls the fourth — but records 1 and 2
 * do not start where an equal stride predicts. So the records genuinely differ in length
 * and the index positions are the ground truth for where each one starts.
 *
 * This prints every offset holding the 4-byte values 0..count-1, which shows the actual
 * record boundaries and therefore the real per-record lengths.
 *
 *   node --experimental-strip-types tools/find-v1-indices.ts
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

/** Small files whose records are not equal-sized. */
const targets = [
  '仙术_Illegal_发电_Power_被淹死的鱼_发电堆叠蓝图集_2-火力_a-火力1层.txt.txt',
  '仙术_Illegal_发电_Power_被淹死的鱼_发电堆叠蓝图集_4-核聚变_1.txt.txt',
];

for (const file of targets) {
  const raw = await payloadOf(file);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const areasEnd = 29 + ((raw[28] ?? 0) as number) * 14;
  const count = dv.getUint32(areasEnd, true);
  const start = areasEnd + 4;
  const area = raw.length - start;

  console.log(`\n${'='.repeat(74)}`);
  console.log(`${file}`);
  console.log(`count=${count} start=${start} area=${area}`);

  console.log('\noffsets holding each ordinal as an int32:');
  for (let want = 0; want < count; want++) {
    const positions: number[] = [];
    for (let at = start; at + 4 <= raw.length; at++) {
      if (dv.getInt32(at, true) === want) positions.push(at);
    }
    console.log(`  ${want}: ${positions.map((p) => `${p}(+${p - start})`).join('  ') || 'none'}`);
  }

  console.log('\nall bytes with offsets, 8 per line:');
  for (let at = start; at < raw.length; at += 8) {
    const slice = raw.subarray(at, Math.min(at + 8, raw.length));
    const hex = [...slice].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    console.log(`  +${String(at - start).padStart(4)}  ${hex}`);
  }
}
