/**
 * Prints the decoded fields of the records around the first failure, so the one
 * record whose values go bad can be inspected directly.
 *
 *   node --experimental-strip-types tools/inspect-record.ts [index]
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { base64ToBytes } from '../src/engine/bp/codec.ts';
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
const markers: number[] = [];
for (let o = recStart; o + 4 <= raw.length; o++) if (dv.getInt32(o, true) === -102) markers.push(o);
const SIZE = 57;

const wanted = process.argv[2] ? Number(process.argv[2]) : -1;
const range = wanted >= 0 ? [wanted] : [3, 4, 5, 6, 7, 8];

for (const i of range) {
  const base = markers[i];
  if (base === undefined) continue;
  const f = {
    path: dv.getInt32(base + 0, true),
    index: dv.getInt32(base + 4, true),
    itemId: dv.getInt16(base + 8, true),
    model: dv.getInt16(base + 10, true),
    area: dv.getInt8(base + 12),
    x: dv.getFloat32(base + 13, true),
    y: dv.getFloat32(base + 17, true),
    z: dv.getFloat32(base + 21, true),
    yaw: dv.getFloat32(base + 25, true),
    tilt: dv.getFloat32(base + 29, true),
    out: dv.getInt32(base + 33, true),
    inp: dv.getInt32(base + 37, true),
    slots: [...raw.subarray(base + 41, base + 47)],
    recipe: dv.getInt16(base + 47, true),
    filter: dv.getInt16(base + 49, true),
    params: dv.getUint16(base + 51, true),
    trailer: dv.getInt32(base + 53, true),
  };
  const yawDeg = (f.yaw * 180) / Math.PI;
  console.log(`#${i} @${base} item=${f.itemId} model=${f.model} (${f.x.toFixed(0)},${f.y.toFixed(0)}) yaw=${f.yaw.toFixed(6)} (${yawDeg.toFixed(1)}deg) tilt=${f.tilt}`);
  console.log(`    out=${f.out} in=${f.inp} slots=[${f.slots}] recipe=${f.recipe} filter=${f.filter} params=${f.params} trailer=${f.trailer}`);
}

// Statistics across all records for the yaw field and neighbours.
console.log('\nyaw statistics across all 37 records:');
const yaws = markers.map((b) => dv.getFloat32(b + 25, true));
const yawDegs = yaws.map((v) => (v * 180) / Math.PI);
console.log(`  min=${Math.min(...yawDegs).toFixed(3)} max=${Math.max(...yawDegs).toFixed(3)}`);
const outside = yawDegs.map((d, i) => [i, d] as const).filter(([, d]) => Math.abs(d) > 1);
console.log(`  records with |yaw| > 1 degree: ${outside.length ? outside.map(([i, d]) => `#${i}=${d.toFixed(1)}`).join(', ') : 'none'}`);

console.log('\ntilt statistics (the 4 bytes after yaw):');
const tilts = markers.map((b) => dv.getFloat32(b + 29, true));
const tiltDegs = tilts.map((v) => (v * 180) / Math.PI);
console.log(`  as float32 min=${Math.min(...tiltDegs).toFixed(2)} max=${Math.max(...tiltDegs).toFixed(2)}`);
const tiltInts = markers.map((b) => dv.getInt32(b + 29, true));
console.log(`  as int32 distinct: ${[...new Set(tiltInts)].slice(0, 8).join(', ')}`);
