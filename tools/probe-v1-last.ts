/**
 * Reads the last undecodable v1 blueprint by hand.
 *
 * `火电_01层` has only 8 buildings in a 492-byte record area, so the whole thing can be
 * dumped and read directly. The walk produces lengths of 52 and 70, which are not `41 + 4n`,
 * so the boundaries it picks are wrong — this shows where the ordinals actually are.
 *
 *   node --experimental-strip-types tools/probe-v1-last.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { base64ToBytes, decodeBody } from '../src/engine/bp/codec.ts';
import { gunzipBytes } from '../src/engine/bp/gzip.ts';

const ROOT = resolve(import.meta.dirname, '..');
const FILE = '仙术_Illegal_发电_Power_耳朵同_有带堆叠蓝图发电_1.-火电_火电_01层.txt.txt';

const text = readFileSync(resolve(ROOT, 'docs/research/_raw/realbp', FILE), 'utf8');
const body = text.trim().slice('BLUEPRINT:'.length);
const closeQuote = body.lastIndexOf('"');
const prefix = body.slice(0, closeQuote);
const token = prefix.slice(prefix.lastIndexOf(',') + 1);
const quote = token.indexOf('"');
const raw = await gunzipBytes(base64ToBytes(token.slice(quote + 1)));

const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
const areaCount = (raw[28] ?? 0) as number;
const areasEnd = 29 + areaCount * 14;
const start = areasEnd + 4;
const count = dv.getUint32(areasEnd, true);
const area = raw.length - start;

console.log(`${FILE}`);
console.log(`areaCount=${areaCount} areasEnd=${areasEnd} count=${count} area=${area} total=${raw.length}`);
try {
  console.log(`decodeBody -> ${decodeBody(raw).buildings.length} buildings`);
} catch (e) {
  console.log(`decodeBody threw: ${(e as Error).message.slice(0, 120)}`);
}

console.log(`\nheader u32x7: ${Array.from({ length: 7 }, (_, i) => dv.getUint32(i * 4, true)).join(', ')}`);

console.log(`\nwhole record area, 8 bytes per row, with the ordinal hits marked:`);

// Every offset holding each ordinal, restricted to plausible record starts.
const ordinalHits = new Map<number, number[]>();
for (let want = 0; want < count; want++) {
  const hits: number[] = [];
  for (let at = start; at + 4 <= raw.length; at++) {
    if (dv.getInt32(at, true) === want) hits.push(at - start);
  }
  ordinalHits.set(want, hits);
}

for (let at = start; at < raw.length; at += 8) {
  const slice = raw.subarray(at, Math.min(at + 8, raw.length));
  const hex = [...slice].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  const off = at - start;
  const marks = [...ordinalHits.entries()]
    .filter(([, hits]) => hits.includes(off))
    .map(([o]) => `ordinal ${o}`)
    .join(', ');
  console.log(`  +${String(off).padStart(4)}  ${hex.padEnd(24)} ${marks ? `  <-- ${marks}` : ''}`);
}

console.log('\nordinal hit offsets:');
for (const [want, hits] of [...ordinalHits.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  ${want}: ${hits.join(', ')}`);
}

// For each candidate boundary, report the gap and whether it is on the lattice.
console.log('\ngaps between consecutive ordinal-0..7 hits, taking the first plausible boundary each time:');
let prev = 0;
for (let want = 1; want < count; want++) {
  const hits = ordinalHits.get(want)!;
  const cand = hits.filter((h) => h > prev);
  const first = cand[0];
  if (first == null) {
    console.log(`  ordinal ${want}: no hit after +${prev}`);
    break;
  }
  const gap = first - prev;
  const onLattice = (gap - 41) % 4 === 0 && gap >= 41;
  console.log(`  ordinal ${want}: +${first}  gap ${gap}  ${onLattice ? `on lattice (n=${(gap - 41) / 4})` : 'OFF LATTICE'}   other hits: ${cand.slice(1, 4).join(', ')}`);
  if (onLattice) prev = first;
}
