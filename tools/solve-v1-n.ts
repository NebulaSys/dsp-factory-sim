/**
 * Tests whether the v1 variable-length record's element count `n` is determined by the
 * prototype id.
 *
 * The record length is `41 + 4n` and `n` is not stored in the head, so the length cannot be
 * read — record starts are located by invariants instead. If `n` turned out to be a function
 * of `itemId`, the length would become computable and the walk could stop being heuristic,
 * which is the difference between a decoder and a search.
 *
 *   node --experimental-strip-types tools/solve-v1-n.ts
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { base64ToBytes } from '../src/engine/bp/codec.ts';
import { gunzipBytes } from '../src/engine/bp/gzip.ts';

const ROOT = resolve(import.meta.dirname, '..');
const dir = resolve(ROOT, 'docs/research/_raw/realbp');

const HEAD = 41;
const MAX_RECORD = 512;
const ID_MIN = 1100;
const ID_MAX = 5100;

async function payloadOf(file: string): Promise<Uint8Array> {
  const text = readFileSync(resolve(dir, file), 'utf8');
  const body = text.trim().slice('BLUEPRINT:'.length);
  const closeQuote = body.lastIndexOf('"');
  const prefix = body.slice(0, closeQuote);
  const token = prefix.slice(prefix.lastIndexOf(',') + 1);
  const quote = token.indexOf('"');
  return gunzipBytes(base64ToBytes(token.slice(quote + 1)));
}

interface Rec {
  id: number;
  n: number;
  file: string;
  index: number;
}
const recs: Rec[] = [];

for (const file of readdirSync(dir).filter((f) => f.endsWith('.txt')).sort()) {
  let raw: Uint8Array;
  try {
    raw = await payloadOf(file);
  } catch {
    continue;
  }
  if (raw[0] !== 1) continue;
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const areaCount = (raw[28] ?? 0) as number;
  const areasEnd = 29 + areaCount * 14;
  const count = dv.getUint32(areasEnd, true);
  if (count < 2 || count > 200000) continue;
  const start = areasEnd + 4;
  const area = raw.length - start;
  if (area % count === 0 && area / count === 61) continue; // fixed-stride family

  const bounds: number[] = [];
  for (let wanted = 0; wanted < count; wanted++) {
    const prev = bounds.length > 0 ? bounds[bounds.length - 1]! : 0;
    const from = start + prev + (bounds.length > 0 ? HEAD : 0);
    let found = -1;
    for (let at = from; at + HEAD <= raw.length; at++) {
      if (bounds.length > 0 && at - start - prev > MAX_RECORD) break;
      if (dv.getInt32(at, true) !== wanted) continue;
      const id = dv.getInt16(at + 37, true);
      if (id < ID_MIN || id > ID_MAX) continue;
      if (dv.getUint8(at + 4) >= Math.max(1, areaCount)) continue;
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
    const len = to - from;
    if (len < HEAD || (len - HEAD) % 4 !== 0) continue;
    recs.push({ id: dv.getInt16(from + 37, true), n: (len - HEAD) / 4, file, index: i });
  }
}

console.log(`records collected: ${recs.length}`);

/** itemId -> observed n values and how often. */
const byId = new Map<number, Map<number, number>>();
for (const r of recs) {
  let m = byId.get(r.id);
  if (!m) {
    m = new Map();
    byId.set(r.id, m);
  }
  m.set(r.n, (m.get(r.n) ?? 0) + 1);
}

const deterministic: number[] = [];
const ambiguous: [number, Map<number, number>][] = [];
for (const [id, m] of byId) {
  if (m.size === 1) deterministic.push(id);
  else ambiguous.push([id, m]);
}

console.log(`\ndistinct prototype ids: ${byId.size}`);
console.log(`  n determined by itemId     : ${deterministic.length}`);
console.log(`  n varies for the same id   : ${ambiguous.length}`);

console.log('\nprototype ids where n varies (id: n->count):');
for (const [id, m] of ambiguous.sort((a, b) => a[0] - b[0])) {
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  console.log(
    `  ${String(id).padStart(5)}: ${[...m.entries()].sort((a, b) => a[0] - b[0]).map(([n, c]) => `n=${n}x${c}`).join('  ')}   (${total} records)`,
  );
}

console.log('\nn values for the ids that are deterministic:');
const byN = new Map<number, number[]>();
for (const id of deterministic) {
  const n = [...byId.get(id)!.keys()][0]!;
  const list = byN.get(n) ?? [];
  list.push(id);
  byN.set(n, list);
}
for (const [n, ids] of [...byN.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  n=${String(n).padStart(2)} -> ${ids.sort((a, b) => a - b).join(', ')}`);
}

// If only a few ids are ambiguous, say how much of the corpus is still computable.
const ambiguousRecords = recs.filter((r) => byId.get(r.id)!.size > 1).length;
console.log(
  `\nrecords whose length could be computed from itemId alone: ${recs.length - ambiguousRecords} / ${recs.length}` +
    ` (${(((recs.length - ambiguousRecords) / recs.length) * 100).toFixed(1)}%)`,
);
