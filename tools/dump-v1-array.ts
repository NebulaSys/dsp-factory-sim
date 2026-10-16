/**
 * Dumps the body-version-1 record head and its variable i32 array, grouped by element count.
 *
 * 1635 of 1658 records from the variable-length files satisfy `length = 41 + 4n` exactly, so
 * the record reads as a 41-byte head plus an array of i32 elements. The head is then
 * index(4) areaIndex(1) two Vector3(24) yaw(4) yaw2(4) itemId(2) modelIndex(2) = 41.
 *
 * The element count is not stored as a plain integer anywhere in the head, so the array
 * contents themselves are the remaining clue: if some element encodes the count or the
 * array is self-describing, that shows up here.
 *
 *   node --experimental-strip-types tools/dump-v1-array.ts
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { base64ToBytes } from '../src/engine/bp/codec.ts';
import { gunzipBytes } from '../src/engine/bp/gzip.ts';

const ROOT = resolve(import.meta.dirname, '..');
const dir = resolve(ROOT, 'docs/research/_raw/realbp');

const HEAD = 41;
const MAX_RECORD = 200;

async function payloadOf(file: string): Promise<Uint8Array> {
  const text = readFileSync(resolve(dir, file), 'utf8');
  const body = text.trim().slice('BLUEPRINT:'.length);
  const closeQuote = body.lastIndexOf('"');
  const prefix = body.slice(0, closeQuote);
  const token = prefix.slice(prefix.lastIndexOf(',') + 1);
  const quote = token.indexOf('"');
  return gunzipBytes(base64ToBytes(token.slice(quote + 1)));
}

function hasBuildingId(dv: DataView, at: number, limit: number): boolean {
  for (let o = 4; o + 2 <= 56 && at + o + 2 <= limit; o++) {
    const v = dv.getInt16(at + o, true);
    if (v >= 1100 && v <= 2400) return true;
  }
  return false;
}

interface Rec {
  file: string;
  bytes: Uint8Array;
}
const byN = new Map<number, Rec[]>();

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
  if (area % count === 0 && area / count === 61) continue;

  const bounds: number[] = [];
  for (let want = 0; want < count; want++) {
    let found = -1;
    const from = start + (bounds.length ? bounds[bounds.length - 1]! : 0);
    for (let at = from; at + 4 <= raw.length; at++) {
      if (dv.getInt32(at, true) !== want) continue;
      const len = at - start - (bounds.length ? bounds[bounds.length - 1]! : 0);
      if (bounds.length > 0 && len > MAX_RECORD) break;
      if (!hasBuildingId(dv, at, Math.min(raw.length, at + MAX_RECORD))) continue;
      found = at - start;
      break;
    }
    if (found < 0) break;
    bounds.push(found);
  }
  if (bounds.length !== count) continue;

  for (let i = 0; i < bounds.length; i++) {
    const from = start + bounds[i]!;
    const to = i + 1 < bounds.length ? start + bounds[i + 1]! : raw.length;
    const bytes = raw.subarray(from, to);
    if (bytes.length < HEAD || (bytes.length - HEAD) % 4 !== 0) continue;
    const n = (bytes.length - HEAD) / 4;
    let list = byN.get(n);
    if (!list) {
      list = [];
      byN.set(n, list);
    }
    if (list.length < 4) list.push({ file, bytes });
  }
}

console.log(`element counts observed: ${[...byN.keys()].sort((a, b) => a - b).join(', ')}`);

for (const n of [...byN.keys()].sort((a, b) => a - b)) {
  const samples = byN.get(n)!;
  console.log(`\n${'='.repeat(76)}`);
  console.log(`n=${n}  (record length ${HEAD + 4 * n})   ${samples.length} sample(s)`);
  for (const s of samples) {
    const b = s.bytes;
    const dv2 = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const f = (o: number): number => dv2.getFloat32(o, true);
    const id = dv2.getInt16(37, true);
    const model = dv2.getInt16(39, true);
    const arr: number[] = [];
    for (let e = 0; e < n; e++) arr.push(dv2.getInt32(HEAD + 4 * e, true));
    console.log(
      `  id=${String(id).padStart(5)} model=${String(model).padStart(4)} yaw=${f(29).toPrecision(6)} yaw2=${f(33).toPrecision(6)}` +
        `  len=${b.length}  array=[${arr.join(', ')}]`,
    );
  }
}
