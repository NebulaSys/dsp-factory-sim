/**
 * Finds out why the two otherwise-clean v1 walks stop halfway.
 *
 * Their first 353 / 429 records have lengths of 61, 65 and 69 — all on the `41 + 4n` lattice —
 * so the head layout is right and something specific breaks the scan. This walks to the stop
 * point and then searches the whole remaining buffer for the wanted ordinal, reporting where it
 * first appears and which guard rejects it.
 *
 *   node --experimental-strip-types tools/probe-v1-stop-cause.ts
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { base64ToBytes, decodeBody } from '../src/engine/bp/codec.ts';
import { gunzipBytes } from '../src/engine/bp/gzip.ts';

const ROOT = resolve(import.meta.dirname, '..');
const dir = resolve(ROOT, 'docs/research/_raw/realbp');

const HEAD = 41;
const CANDIDATES = new Map<number, number[]>([
  [1131, [5]], [2201, [5]], [2203, [5]], [2204, [5]], [2205, [5]], [2211, [5]],
  [2011, [6]], [2013, [6]], [2210, [6]],
]);

async function payloadOf(file: string): Promise<Uint8Array> {
  const text = readFileSync(resolve(dir, file), 'utf8');
  const body = text.trim().slice('BLUEPRINT:'.length);
  const closeQuote = body.lastIndexOf('"');
  const prefix = body.slice(0, closeQuote);
  const token = prefix.slice(prefix.lastIndexOf(',') + 1);
  const quote = token.indexOf('"');
  return gunzipBytes(base64ToBytes(token.slice(quote + 1)));
}

for (const file of readdirSync(dir).filter((f) => f.endsWith('.txt')).sort()) {
  let raw: Uint8Array;
  try {
    raw = await payloadOf(file);
  } catch {
    continue;
  }
  if (raw[0] !== 1) continue;
  try {
    if (decodeBody(raw).buildings.length > 0) continue;
  } catch {
    /* failing files only */
  }

  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const areaCount = (raw[28] ?? 0) as number;
  const areaStart = 29 + areaCount * 14 + 4;
  const count = dv.getUint32(areaStart - 4, true);
  const areaEnd = raw.length;

  const valid = (at: number): boolean => {
    if (at + HEAD > areaEnd) return false;
    const id = dv.getInt16(at + 37, true);
    if (id < 1100 || id > 5100) return false;
    return dv.getUint8(at + 4) < Math.max(1, areaCount);
  };

  // Walk to the stop.
  const bounds: number[] = [];
  let wanted = 0;
  for (; wanted < count; wanted++) {
    const prev = bounds.length > 0 ? bounds[bounds.length - 1]! : 0;
    const from = areaStart + prev + (bounds.length > 0 ? HEAD : 0);
    let found = -1;
    if (bounds.length > 0) {
      const itemId = dv.getInt16(areaStart + prev + 37, true);
      const cands = CANDIDATES.get(itemId) ?? (itemId > 2000 && itemId < 2010 ? [5, 7] : []);
      for (const n of cands) {
        const next = areaStart + prev + HEAD + 4 * n;
        if (next > areaEnd) continue;
        if (next === areaEnd && wanted === count - 1) {
          found = next - areaStart;
          break;
        }
        if (next + HEAD <= areaEnd && dv.getInt32(next, true) === wanted + 1) {
          found = next - areaStart;
          break;
        }
      }
    }
    if (found < 0) {
      for (let at = from; at + HEAD <= areaEnd; at++) {
        if (bounds.length > 0 && at - areaStart - prev > 8192) break;
        if (dv.getInt32(at, true) !== wanted) continue;
        if (!valid(at)) continue;
        found = at - areaStart;
        break;
      }
    }
    if (found < 0) break;
    bounds.push(found);
  }

  const prev = bounds.length > 0 ? bounds[bounds.length - 1]! : 0;
  const at = areaStart + prev;
  console.log(`\n${'='.repeat(78)}`);
  console.log(`${file}`);
  console.log(`  stopped wanting record ${wanted} of ${count}; last boundary at +${prev}, area=${areaEnd - areaStart}`);

  // How long was the last good record, and what did it look like?
  if (bounds.length >= 2) {
    const len = bounds[bounds.length - 1]! - bounds[bounds.length - 2]!;
    console.log(`  previous record: #${bounds.length - 2} at +${bounds[bounds.length - 2]}, length ${len} (= 41 + 4n, n=${(len - HEAD) / 4})`);
  }
  console.log(
    `  last good record #${bounds.length - 1} at +${prev}: itemId=${dv.getInt16(at + 37, true)}` +
      ` index=${dv.getInt32(at, true)} areaIndex=${dv.getUint8(at + 4)}`,
  );

  // Where does the wanted ordinal appear in the WHOLE remaining buffer?
  const hits: number[] = [];
  for (let p = at + HEAD; p + 4 <= areaEnd && hits.length < 6; p++) {
    if (dv.getInt32(p, true) === wanted) hits.push(p - areaStart);
  }
  console.log(`  first offsets in the remainder holding ordinal ${wanted}: ${hits.join(', ') || 'NONE AT ALL'}`);

  for (const h of hits.slice(0, 3)) {
    const p = areaStart + h;
    const gap = h - prev;
    const id = dv.getInt16(p + 37, true);
    const areaIdx = dv.getUint8(p + 4);
    console.log(
      `    +${h} (gap ${gap}, lattice ${(gap - HEAD) % 4 === 0 ? 'ok' : 'OFF'}, n=${(gap - HEAD) / 4}):` +
        ` areaIndex=${areaIdx} (needs <${Math.max(1, areaCount)}) itemId=${id} (needs 1100..5100)` +
        ` -> ${areaIdx < Math.max(1, areaCount) && id >= 1100 && id <= 5100 ? 'PASSES' : 'rejected'}`,
    );
  }

  // Show the bytes right after the last boundary, so the tail of that record is visible.
  console.log(`  bytes from +${prev} to +${Math.min(prev + 160, areaEnd - areaStart)}:`);
  for (let p = at; p < Math.min(at + 160, areaEnd); p += 8) {
    const slice = raw.subarray(p, Math.min(p + 8, areaEnd));
    console.log(`    +${String(p - areaStart).padStart(5)}  ${[...slice].map((b) => b.toString(16).padStart(2, '0')).join(' ')}`);
  }
}
