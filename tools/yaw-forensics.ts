/**
 * Examines the 4 bytes the reader treats as `yaw` for every record, listing both
 * the float32 and the raw bytes, to decide whether that field really holds an angle.
 *
 * The reference blueprint is a belt ring: most belts read yaw ~= 0, but #5, #22..#25
 * read 15470..18127 degrees, which cannot be an angle. Either those bytes are not
 * yaw at all, or the field packs something else alongside it.
 *
 *   node --experimental-strip-types tools/yaw-forensics.ts
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

console.log('idx  pos       yaw(f32)     yaw(deg)     bytes(yaw)   bytes(+29)  x        y');
for (let i = 0; i < markers.length; i++) {
  const b = markers[i]!;
  const yaw = dv.getFloat32(b + 25, true);
  const deg = (yaw * 180) / Math.PI;
  const yawBytes = [...raw.subarray(b + 25, b + 29)].map((v) => v.toString(16).padStart(2, '0')).join(' ');
  const after = [...raw.subarray(b + 29, b + 33)].map((v) => v.toString(16).padStart(2, '0')).join(' ');
  const flag = Math.abs(deg) > 1 ? '  <== outlier' : '';
  console.log(
    `#${String(i).padStart(2)}  (${dv.getFloat32(b + 13, true).toFixed(0)},${dv.getFloat32(b + 17, true).toFixed(0)})`.padEnd(12) +
      `${yaw.toFixed(4).padStart(11)}  ${deg.toFixed(1).padStart(11)}   ${yawBytes}   ${after}${flag}`,
  );
}

// Hypothesis: bits above the angle are a flag. Mask the exponent and look again.
console.log('\nif the two high bytes are a separate field, reading only the low two as f32:');
for (const i of [0, 5, 22, 23, 24, 25]) {
  const b = markers[i]!;
  const low2 = 0; // placeholder to keep types simple
  void low2;
  const bytes = raw.subarray(b + 25, b + 29);
  console.log(`  #${String(i).padStart(2)} raw=${[...bytes].map((v) => v.toString(16).padStart(2, '0')).join(' ')}`);
}

// Hypothesis: the field is a 4-byte little-endian float whose value is a raw turn
// count (rotations), i.e. deg/360.
console.log('\nas rotations (yaw / 2pi):');
for (let i = 0; i < markers.length; i++) {
  const b = markers[i]!;
  const yaw = dv.getFloat32(b + 25, true);
  const turns = yaw / (Math.PI * 2);
  if (Math.abs(turns) > 0.01) console.log(`  #${String(i).padStart(2)} turns=${turns.toFixed(4)}`);
}
