/**
 * Correlates a belt's slot field with its position, to see whether the slot index
 * carries the belt's connection direction.
 *
 * 32 of the 37 reference belts report slot value 1 and five report 2. The five are
 * the belts that turn a corner (three store 180-degree yaw, one 90-degree), so the
 * field plausibly encodes which of the belt's own ends an item enters or leaves by.
 *
 *   node --experimental-strip-types tools/belt-slot-meaning.ts
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

const rows = markers.map((b, i) => ({
  i,
  x: dv.getFloat32(b + 13, true),
  y: dv.getFloat32(b + 17, true),
  yawDeg: (dv.getFloat32(b + 25, true) * 180) / Math.PI,
  out: dv.getInt32(b + 33, true),
  slot41: dv.getInt8(b + 41),
  slot42: dv.getInt8(b + 42),
  slot43: dv.getInt8(b + 43),
  slot44: dv.getInt8(b + 44),
}));

const distinct41 = [...new Set(rows.map((r) => r.slot41))].sort();
console.log(`slot@41 distinct values: [${distinct41.join(', ')}]`);
for (const value of distinct41) {
  const group = rows.filter((r) => r.slot41 === value);
  console.log(`\nslot@41 = ${value}  (${group.length} belts)`);
  for (const r of group.slice(0, 8)) {
    const degree = Math.round(r.yawDeg);
    console.log(`  #${String(r.i).padStart(2)} at (${r.x.toFixed(0)},${r.y.toFixed(0)}) yaw=${degree}deg out=${r.out}`);
  }
  if (group.length > 8) console.log(`  … ${group.length - 8} more`);
}

console.log('\nkey cross-check: do the corner belts use a different slot value?');
const corners = rows.filter((r) => {
  const deg = Math.round(r.yawDeg) % 360;
  return deg !== 0;
});
console.log(`  belts with a non-zero yaw (corners): ${corners.length}`);
for (const r of corners) {
  console.log(`    #${r.i} (${r.x.toFixed(0)},${r.y.toFixed(0)}) yaw=${Math.round(r.yawDeg)}deg slot@41=${r.slot41}`);
}
const straight = rows.filter((r) => Math.round(r.yawDeg) % 360 === 0);
const straightSlots = [...new Set(straight.map((r) => r.slot41))];
console.log(`  straight belts use slot@41 values: [${straightSlots.join(', ')}] (${straight.length} belts)`);
