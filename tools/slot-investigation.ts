/**
 * Inspects what the blueprint records about sorter-to-building slot connections.
 *
 * A sorter record carries two object references plus slot indices. This prints the
 * slot bytes and endpoint references for the ground-truth blueprint, then checks the
 * game's prefab data for the per-building slot layout those indices refer to.
 *
 *   node --experimental-strip-types tools/slot-investigation.ts
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

console.log('=== slot bytes in the reference blueprint (37 belts) ===');
console.log('offset  field             distinct values seen');
const names = ['outputToSlot', 'inputFromSlot', 'outputFromSlot', 'inputToSlot', 'outputOffset', 'inputOffset'];
for (let k = 0; k < 6; k++) {
  const values = new Set(markers.map((b) => raw[b + 41 + k]!));
  console.log(`+${41 + k}     ${names[k]!.padEnd(17)} [${[...values].join(', ')}]${values.size === 1 ? '   (constant)' : ''}`);
}

console.log('\n=== a belt record, byte by byte around the slot block ===');
const b0 = markers[1]!;
for (let off = 33; off <= 56; off++) {
  const i8 = dv.getInt8(b0 + off);
  const label = off === 33 ? 'outputObjectIndex' : off === 37 ? 'inputObjectIndex' : off === 41 ? 'slots start' : off === 47 ? 'recipeId' : off === 49 ? 'filterId' : off === 51 ? 'parameterCount' : off === 53 ? 'trailer' : '';
  console.log(`  +${off}  byte=${String(raw[b0 + off]).padStart(3)}  i8=${String(i8).padStart(4)}  ${label}`);
}

// --- what the game's prefab data says about slots ---------------------------
console.log('\n=== prefab SlotConfig for a belt and a sorter ===');
try {
  const prefabs = JSON.parse(readFileSync(resolve(ROOT, 'docs/research/_raw/prefabs.json'), 'utf8')) as {
    prefabs: Record<string, Record<string, unknown>>;
  };
  const keys = Object.keys(prefabs.prefabs);
  for (const want of [/^entities\/prefabs\/belt-/, /^entities\/prefabs\/sorter-/, /^entities\/prefabs\/assembler-mk-1$/]) {
    const key = keys.find((k) => want.test(k));
    if (!key) {
      console.log(`  ${want}: not present in the cached prefabs`);
      continue;
    }
    const config = prefabs.prefabs[key]?.SlotConfig as Record<string, unknown> | undefined;
    const slotPoses = (config?.slotPoses as unknown[]) ?? [];
    const insertPoses = (config?.insertPoses as unknown[]) ?? [];
    console.log(`  ${key}`);
    console.log(`    slotPoses: ${slotPoses.length} entries`);
    console.log(`    insertPoses: ${insertPoses.length} entries`);
    if (slotPoses.length > 0) console.log(`    first slotPose: ${JSON.stringify(slotPoses[0])}`);
    if (insertPoses.length > 0) console.log(`    first insertPose: ${JSON.stringify(insertPoses[0])}`);
  }
} catch (err) {
  console.log(`  prefab read failed: ${(err as Error).message}`);
}
