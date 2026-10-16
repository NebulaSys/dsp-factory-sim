/**
 * Finds the correct offsets of `yaw` and the out/in/tail block by requiring the
 * ground-truth belts to be axis-aligned.
 *
 * The fixture is a closed ring of belts, so every belt's orientation must be a
 * multiple of 90 degrees. That is a strong, independent constraint: the right
 * layout makes all 37 orientations clean multiples of pi/2, and a wrong one
 * scatters them across the full range.
 *
 *   node --experimental-strip-types tools/probe-fields.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { base64ToBytes, decodeBody } from '../src/engine/bp/codec.ts';
import { gunzipBytes } from '../src/engine/bp/gzip.ts';

const ROOT = resolve(import.meta.dirname, '..');

const text = readFileSync(resolve(ROOT, 'docs/research/_raw/reffix/blueprint.0.10.34.28326.txt'), 'utf8').trim();
const body = text.slice('BLUEPRINT:'.length);
const closeQuote = body.lastIndexOf('"');
const prefix = body.slice(0, closeQuote);
const tailToken = prefix.slice(prefix.lastIndexOf(',') + 1);
const raw = await gunzipBytes(base64ToBytes(tailToken.slice(tailToken.indexOf('"') + 1)));
const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);

const areaCount = raw[28] ?? 0;
const areasEnd = 29 + areaCount * 14;
const count = dv.getUint32(areasEnd, true);
const recStart = areasEnd + 4;

// Record size: confirm 57 by checking the last path marker.
console.log(`count=${count} recStart=${recStart} bodyLen=${raw.length}`);
const markers: number[] = [];
for (let o = recStart; o + 4 <= raw.length; o++) if (dv.getInt32(o, true) === -102) markers.push(o);
console.log(`path markers: ${markers.length}, last at ${markers[markers.length - 1]}, gaps: ${[...new Set(markers.slice(1).map((m, i) => m - markers[i]!))].join(',')}`);

const RECORD = 57;

// --- 1. Find `yaw`: the float offset that makes all belts axis-aligned. -------
console.log('\ncandidate yaw offsets (float offset within the record):');
for (let off = 21; off <= 32; off++) {
  let axis = 0;
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    const v = dv.getFloat32(recStart + i * RECORD + off, true);
    values.push(v);
    // A multiple of pi/2 within a degree.
    const deg = (v * 180) / Math.PI;
    const quarters = deg / 90;
    if (Number.isFinite(v) && Math.abs(v) < 7 && Math.abs(quarters - Math.round(quarters)) < 0.02) axis++;
  }
  const distinct = [...new Set(values.map((v) => Math.round(((v * 180) / Math.PI) * 10) / 10))].sort((a, b) => a - b);
  console.log(
    `  +${String(off).padStart(2)}  axis-aligned ${String(axis).padStart(2)}/${count}  distinct(deg)=[${distinct.slice(0, 6).join(', ')}${distinct.length > 6 ? ', …' : ''}]`,
  );
}

// --- 2. Find the out/in pair: -1 or a valid object id, and for sorters a real id.
console.log('\ncandidate out/in offsets (int32 offsets within the record):');
for (let off = 25; off <= 44; off += 1) {
  let ok = 0;
  const outs: number[] = [];
  for (let i = 0; i < count; i++) {
    const base = recStart + i * RECORD;
    const out = dv.getInt32(base + off, true);
    const inp = dv.getInt32(base + off + 4, true);
    const outOk = out === -1 || (out >= 0 && out < 4096);
    const inOk = inp === -1 || (inp >= 0 && inp < 4096);
    if (outOk && inOk) ok++;
    outs.push(out);
  }
  if (ok > count * 0.5) {
    const distinct = [...new Set(outs)].sort((a, b) => a - b);
    console.log(`  +${String(off).padStart(2)}  plausible ${String(ok).padStart(2)}/${count}  distinct out values=[${distinct.slice(0, 8).join(', ')}${distinct.length > 8 ? ', …' : ''}]`);
  }
}

// --- 3. The fixture should contain 2 sorters with real endpoint ids. ---------
// Item id 2011 = SorterMk1. Find which records are sorters and print their tail.
console.log('\nrecords whose itemId is a sorter (2011-2019) and their tails:');
for (let i = 0; i < count; i++) {
  const base = recStart + i * RECORD;
  const itemId = dv.getInt16(base + 8, true);
  if (itemId <= 2010 || itemId >= 2020) continue;
  const tail = [...raw.subarray(base, base + RECORD)].map((v) => v.toString(16).padStart(2, '0'));
  console.log(`  #${i} itemId=${itemId} bytes: ${tail.join(' ')}`);
}
