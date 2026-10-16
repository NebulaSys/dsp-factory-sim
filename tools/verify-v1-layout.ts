/**
 * Validates the body-version-1 record layout with the belt/sorter orientation rule.
 *
 * Confirmed so far:
 *  - the head is index(i32), areaIndex(i8), then two Vector3 blocks (x,y,z and x2,y2,z2)
 *  - the prototype id sits at +37 and reads as real DSP ids (a wind-turbine blueprint
 *    gives 2203 = Wind Turbine, with its three-float height ladder -0.0001, 8, 16, 24)
 *  - a fixed 61-byte plain record already walks 10 of 27 files exactly (30,480 records)
 *    with `index == ordinal` throughout
 *  - where fixed-61 fails, records are longer (a 4-building fire plant needs 64 bytes
 *    average), which is the same belt/sorter orientation rule the v2 layout uses
 *
 * So v1 should be: plain 61, belt 65, sorter 93. This is the decisive test — every file
 * must finish exactly at the buffer end with every `index` equal to its ordinal.
 *
 *   node --experimental-strip-types tools/verify-v1-layout.ts
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

interface Variant {
  name: string;
  size: (itemId: number) => number;
}

const VARIANTS: Variant[] = [
  { name: 'plain 61, belt +4, sorter +32', size: (id) => 61 + (id > 2000 && id < 2010 ? 4 : id > 2010 && id < 2020 ? 32 : 0) },
  { name: 'plain 57, belt +4, sorter +32', size: (id) => 57 + (id > 2000 && id < 2010 ? 4 : id > 2010 && id < 2020 ? 32 : 0) },
  { name: 'plain 61 only', size: () => 61 },
  { name: 'plain 65 only', size: () => 65 },
  { name: 'plain 61, belt +8, sorter +32', size: (id) => 61 + (id > 2000 && id < 2010 ? 8 : id > 2010 && id < 2020 ? 32 : 0) },
];

for (const variant of VARIANTS) {
  let exactFiles = 0;
  let checked = 0;
  let totalRecords = 0;
  const fails: string[] = [];

  for (const file of files) {
    let raw: Uint8Array;
    try {
      raw = await payloadOf(file);
    } catch {
      continue;
    }
    if (raw[0] !== 1) continue;
    checked++;
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const areasEnd = 29 + ((raw[28] ?? 0) as number) * 14;
    const count = dv.getUint32(areasEnd, true);
    if (count === 0 || count > 200000) continue;

    let at = areasEnd + 4;
    let walked = 0;
    let good = true;
    let reason = '';
    while (walked < count) {
      if (at + 39 > raw.length) {
        good = false;
        reason = 'past end';
        break;
      }
      const index = dv.getInt32(at, true);
      if (index !== walked) {
        good = false;
        reason = `index ${index} != ${walked}`;
        break;
      }
      const id = dv.getInt16(at + 37, true);
      if (!(id > 0 && id < 8000)) {
        good = false;
        reason = `itemId ${id} at ${walked}`;
        break;
      }
      at += variant.size(id);
      walked++;
    }
    if (good && walked === count && at === raw.length) {
      exactFiles++;
      totalRecords += walked;
    } else if (fails.length < 4) {
      fails.push(`${file.slice(0, 24)} ${walked}/${count} ${reason}`);
    }
  }
  console.log(`${variant.name.padEnd(34)} exact ${String(exactFiles).padStart(2)}/${checked}  records ${totalRecords}`);
  for (const f of fails) console.log(`      ${f}`);
}
