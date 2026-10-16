/**
 * Finds what determines the body-version-1 record length.
 *
 * The fixed-stride family is solved; the remaining blueprints have variable-length records
 * whose boundaries are findable because `index` sits at record offset +0 and equals the
 * record's ordinal. In the 4-building fire-plant file the lengths are 61, 45, 81 and 69
 * (summing to the 256-byte record area), so something inside each record decides its size.
 *
 * Method: for every byte offset, group records by the value at that offset. If a value
 * always corresponds to the same length, that offset carries the length selector — which
 * needs no guess about the exact arithmetic.
 *
 *   node --experimental-strip-types tools/solve-v1-length.ts
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

interface Record {
  file: string;
  bytes: Uint8Array;
  length: number;
}
const records: Record[] = [];
const fileSummary: string[] = [];

/**
 * Does the candidate look like the start of a v1 record?
 *
 * The head is 41 bytes — index(4) areaIndex(1) two Vector3(24) yaw(4) yaw2(4) itemId(2)
 * modelIndex(2) — so the prototype id sits at a *fixed* offset, +37. Requiring that exact
 * 2-byte read to be a building id is far tighter than searching the whole record, and it
 * is what rejects a spurious `index` match: in the first attempt those showed up as
 * prototype ids like 29374 and 20561 at +37.
 */
const BUILDING_ID_MIN = 1100;
const BUILDING_ID_MAX = 2400;

function looksLikeRecord(dv: DataView, at: number, limit: number): boolean {
  if (at + 39 > limit) return false;
  const id = dv.getInt16(at + 37, true);
  return id >= BUILDING_ID_MIN && id <= BUILDING_ID_MAX;
}

for (const file of readdirSync(dir).filter((f) => f.endsWith('.txt')).sort()) {
  let raw: Uint8Array;
  try {
    raw = await payloadOf(file);
  } catch {
    continue;
  }
  if (raw[0] !== 1) continue;
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const areasEnd = 29 + ((raw[28] ?? 0) as number) * 14;
  const count = dv.getUint32(areasEnd, true);
  if (count < 2 || count > 200000) continue;
  const start = areasEnd + 4;
  const area = raw.length - start;
  // Skip the family already decoded at a fixed 61-byte stride.
  if (area % count === 0 && area / count === 61) continue;

  // Boundaries: forward scan for the ordinal at record offset 0, but only accept a
  // candidate that also looks like a real record. A bare `index == ordinal` match is not
  // enough — small integers appear everywhere in the data, so the first match after the
  // previous boundary is often spurious, which is what produced 10-byte records and one
  // 7577-byte record in the first attempt.
  //
  // Two independent requirements are added, both of which any real record satisfies:
  //   * the record contains a building prototype id (the game's buildings live in
  //     roughly 1100..2400, and every record IS a building), and
  //   * the record is not absurdly long, since the fixed family is 61 bytes.
  const MAX_RECORD = 200;
  const bounds: number[] = [];
  for (let want = 0; want < count; want++) {
    let found = -1;
    const from = start + (bounds.length ? bounds[bounds.length - 1]! : 0);
    for (let at = from; at + 4 <= raw.length; at++) {
      if (dv.getInt32(at, true) !== want) continue;
      const len = at - start - (bounds.length ? bounds[bounds.length - 1]! : 0);
      if (bounds.length > 0 && len > MAX_RECORD) break;
      if (!looksLikeRecord(dv, at, Math.min(raw.length, at + MAX_RECORD))) continue;
      found = at - start;
      break;
    }
    if (found < 0) break;
    bounds.push(found);
  }
  if (bounds.length < 2) continue;

  const lens = bounds.map((b, i) => (i + 1 < bounds.length ? bounds[i + 1]! - b : raw.length - start - b));
  const complete = bounds.length === count && lens.reduce((a, b) => a + b, 0) === area;
  fileSummary.push(
    `${file.slice(0, 34).padEnd(36)} count=${String(count).padStart(5)} walked=${String(bounds.length).padStart(5)} ` +
      `${complete ? 'COMPLETE' : 'partial'}  lengths seen: ${[...new Set(lens)].sort((a, b) => a - b).join(', ')}`,
  );

  for (let i = 0; i < bounds.length; i++) {
    const from = start + bounds[i]!;
    const to = i + 1 < bounds.length ? start + bounds[i + 1]! : raw.length;
    records.push({ file, bytes: raw.subarray(from, to), length: to - from });
  }
}

console.log('v1 files with variable-length records:');
for (const s of fileSummary) console.log(`  ${s}`);
console.log(`\ntotal records collected: ${records.length}`);

const minLen = Math.min(...records.map((r) => r.length));
const distinctLengths = [...new Set(records.map((r) => r.length))].sort((a, b) => a - b);
console.log(`length range: ${minLen} .. ${Math.max(...records.map((r) => r.length))}`);
console.log(`distinct lengths: ${distinctLengths.slice(0, 24).join(', ')}${distinctLengths.length > 24 ? ` …(${distinctLengths.length})` : ''}`);

/**
 * The cleanest files yield only {41, 45, 61, 65, 69, 81, 85, 89}: every one is `41 + 4n`.
 * That reads as a 41-byte fixed head plus an array of i32 elements. The head then has to be
 * index(4) areaIndex(1) two Vector3(24) yaw(4) yaw2(4) itemId(2) modelIndex(2) = 41, and
 * everything the 61-byte family put at +41..+60 is really the first array elements.
 */
const HEAD = 41;
const onLattice = records.filter((r) => r.length >= HEAD && (r.length - HEAD) % 4 === 0);
console.log(`\nrecords on the 41+4n lattice: ${onLattice.length} / ${records.length}`);
const elements = new Map<number, number>();
for (const r of onLattice) {
  const n = (r.length - HEAD) / 4;
  elements.set(n, (elements.get(n) ?? 0) + 1);
}
console.log('i32 element counts (n -> how many records):');
for (const [n, c] of [...elements.entries()].sort((a, b) => a[0] - b[0])) console.log(`  n=${String(n).padStart(3)}  ${c} record(s)`);

// Does any head offset hold the element count? Look for value == n, or value == n + k.
console.log('\nhead offsets whose value tracks the element count n:');
let tracked = 0;
for (let off = 0; off < HEAD; off++) {
  let exact = 0;
  let exactByte = 0;
  for (const r of onLattice) {
    const n = (r.length - HEAD) / 4;
    if (r.bytes[off] === n) exactByte++;
    if (off + 2 <= HEAD) {
      const v = r.bytes[off]! | (r.bytes[off + 1]! << 8);
      if (v === n) exact++;
    }
  }
  if (exactByte / onLattice.length > 0.5 || exact / onLattice.length > 0.5) {
    tracked++;
    console.log(
      `  +${String(off).padStart(2)}: u8 matches n for ${exactByte}/${onLattice.length}` +
        (off + 2 <= HEAD ? `, u16 for ${exact}/${onLattice.length}` : ''),
    );
  }
}
if (tracked === 0) console.log('  none: the element count is not stored in the head as a plain integer');

// Which record length goes with which prototype? itemId sits at +37 in the head.
console.log('\nrecord length by prototype id (top combinations):');
const combos = new Map<string, number>();
for (const r of onLattice) {
  if (r.length < 39) continue;
  const id = r.bytes[37]! | (r.bytes[38]! << 8);
  if (id < 1000 || id > 2500) continue;
  const key = `${id} -> ${r.length}`;
  combos.set(key, (combos.get(key) ?? 0) + 1);
}
for (const [k, c] of [...combos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16)) {
  console.log(`  ${k.padEnd(18)} ${c}`);
}

// Search each offset for a value that deterministically predicts the record length.
console.log('\noffsets whose byte value predicts the record length exactly:');
let found = 0;
for (let off = 0; off < minLen; off++) {
  const byValue = new Map<number, Set<number>>();
  for (const r of records) {
    const v = r.bytes[off]!;
    let set = byValue.get(v);
    if (!set) {
      set = new Set<number>();
      byValue.set(v, set);
    }
    set.add(r.length);
  }
  // Deterministic means: each value maps to exactly one length, and the mapping is
  // non-trivial (it actually distinguishes several lengths).
  const deterministic = [...byValue.values()].every((s) => s.size === 1);
  const distinguished = new Set([...byValue.values()].map((s) => [...s][0]!)).size;
  if (deterministic && distinguished >= 3) {
    found++;
    const pairs = [...byValue.entries()]
      .sort((a, b) => a[0] - b[0])
      .slice(0, 10)
      .map(([v, s]) => `${v}->${[...s][0]}`)
      .join(' ');
    console.log(`  +${String(off).padStart(3)}: ${distinguished} distinct lengths   ${pairs}`);
  }
}
if (found === 0) console.log('  none: no single byte offset determines the record length');

// Two-byte offsets too, in case the selector is a 16-bit count.
console.log('\n16-bit offsets whose value predicts the record length exactly:');
let found2 = 0;
for (let off = 0; off + 2 < minLen; off++) {
  const byValue = new Map<number, Set<number>>();
  for (const r of records) {
    const v = r.bytes[off]! | (r.bytes[off + 1]! << 8);
    let set = byValue.get(v);
    if (!set) {
      set = new Set<number>();
      byValue.set(v, set);
    }
    set.add(r.length);
  }
  const deterministic = [...byValue.values()].every((s) => s.size === 1);
  const distinguished = new Set([...byValue.values()].map((s) => [...s][0]!)).size;
  if (deterministic && distinguished >= 3) {
    found2++;
    const pairs = [...byValue.entries()]
      .sort((a, b) => a[0] - b[0])
      .slice(0, 8)
      .map(([v, s]) => `${v}->${[...s][0]}`)
      .join(' ');
    console.log(`  +${String(off).padStart(3)}: ${distinguished} distinct lengths   ${pairs}`);
  }
}
if (found2 === 0) console.log('  none');
