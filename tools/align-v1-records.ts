/**
 * Aligns the unequal-length body-version-1 records to find their common structure.
 *
 * In the 4-building fire-plant file the index field sits at record offsets 0, 61, 106 and
 * 187, so the records are 61, 45, 81 and 69 bytes long. Dumping each one from its own
 * start makes the shared prefix and the variable tail visible.
 *
 *   node --experimental-strip-types tools/align-v1-records.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { base64ToBytes } from '../src/engine/bp/codec.ts';
import { gunzipBytes } from '../src/engine/bp/gzip.ts';

const ROOT = resolve(import.meta.dirname, '..');

async function payloadOf(rel: string): Promise<Uint8Array> {
  const text = readFileSync(resolve(ROOT, 'docs/research/_raw/realbp', rel), 'utf8');
  const body = text.trim().slice('BLUEPRINT:'.length);
  const closeQuote = body.lastIndexOf('"');
  const prefix = body.slice(0, closeQuote);
  const token = prefix.slice(prefix.lastIndexOf(',') + 1);
  const quote = token.indexOf('"');
  return gunzipBytes(base64ToBytes(token.slice(quote + 1)));
}

const FILES = [
  '仙术_Illegal_发电_Power_被淹死的鱼_发电堆叠蓝图集_2-火力_a-火力1层.txt.txt',
  '仙术_Illegal_发电_Power_被淹死的鱼_发电堆叠蓝图集_4-核聚变_1.txt.txt',
];

for (const file of FILES) {
  const raw = await payloadOf(file);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const areasEnd = 29 + ((raw[28] ?? 0) as number) * 14;
  const count = dv.getUint32(areasEnd, true);
  const start = areasEnd + 4;

  // Record boundaries are the offsets where the ordinal appears, scanning forward from
  // the end of the previous record. The first record starts at offset 0, so the scan for
  // ordinal 0 begins there rather than one byte later.
  const bounds: number[] = [];
  for (let want = 0; want < count; want++) {
    let found = -1;
    const from = start + (bounds.length ? bounds[bounds.length - 1]! : 0);
    for (let at = from; at + 4 <= raw.length; at++) {
      if (dv.getInt32(at, true) === want) {
        found = at - start;
        break;
      }
    }
    if (found < 0) break;
    bounds.push(found);
  }

  console.log(`\n${'='.repeat(76)}`);
  console.log(`${file}\ncount=${count} start=${start}`);
  console.log(`record starts (record-relative): ${bounds.join(', ')}`);
  const lens = bounds.map((b, i) => (i + 1 < bounds.length ? bounds[i + 1]! - b : raw.length - start - b));
  console.log(`record lengths: ${lens.join(', ')}  sum=${lens.reduce((a, b) => a + b, 0)} area=${raw.length - start}`);

  // Dump each record from its own start.
  for (let i = 0; i < bounds.length; i++) {
    const from = start + bounds[i]!;
    const to = i + 1 < bounds.length ? start + bounds[i + 1]! : raw.length;
    const bytes = [...raw.subarray(from, to)];
    console.log(`\n  record #${i}  len=${bytes.length}`);
    for (let o = 0; o < bytes.length; o += 8) {
      const chunk = bytes.slice(o, o + 8);
      console.log(`    +${String(o).padStart(3)}  ${chunk.map((b) => b.toString(16).padStart(2, '0')).join(' ')}`);
    }
    // Interpret the first 29 bytes as index, areaIndex, two Vector3.
    const f = (o: number): number => dv.getFloat32(from + o, true);
    console.log(
      `    -> index=${dv.getInt32(from, true)} areaIndex=${dv.getInt8(from + 4)}` +
        ` v1=(${f(5).toPrecision(6)}, ${f(9).toPrecision(6)}, ${f(13).toPrecision(6)})` +
        ` v2=(${f(17).toPrecision(6)}, ${f(21).toPrecision(6)}, ${f(25).toPrecision(6)})`,
    );
  }
}
