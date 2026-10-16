/**
 * Complete classification of the body-version-1 blueprints by record framing.
 *
 * The previous grid search required 50 consecutive `index == ordinal` matches, which
 * silently excluded every blueprint with fewer than 50 buildings — including the small
 * 4- and 8-building files that are the easiest to read. It also searched strides when
 * the stride is in fact determined: if the records are equal-sized, then
 * `stride = recordArea / count` exactly, so only the index offset is unknown.
 *
 * This version:
 *  1. computes `area / count` and reports whether it is an integer;
 *  2. for an integer stride, finds the offset where `index == ordinal` holds for EVERY
 *     record and the walk lands exactly on the buffer end;
 *  3. for a non-integer stride, records the remainder so the amount of variable-length
 *     content is known.
 *
 *   node --experimental-strip-types tools/classify-v1.ts
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

interface Row {
  file: string;
  count: number;
  area: number;
  stride: number | null;
  remainder: number;
  offset: number | null;
  /** Prototype ids readable at +37 in the fixed-stride case. */
  ids: string;
}
const rows: Row[] = [];

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
  if (areasEnd + 4 > raw.length) continue;
  const count = dv.getUint32(areasEnd, true);
  if (count === 0 || count > 200000) continue;
  const start = areasEnd + 4;
  const area = raw.length - start;
  const exact = area % count === 0;
  const stride = exact ? area / count : null;
  let offset: number | null = null;

  if (stride != null) {
    for (let off = 0; off + 4 <= stride; off++) {
      let ok = true;
      for (let i = 0; i < count; i++) {
        if (dv.getInt32(start + i * stride + off, true) !== i) {
          ok = false;
          break;
        }
      }
      if (ok) {
        offset = off;
        break;
      }
    }
  }

  // Read the prototype column so the fixed-stride rows carry real content.
  let ids = '';
  if (stride != null && offset != null) {
    const hist = new Map<number, number>();
    for (let i = 0; i < count; i++) {
      const v = dv.getInt16(start + i * stride + 37, true);
      if (v > 0 && v < 8000) hist.set(v, (hist.get(v) ?? 0) + 1);
    }
    ids = [...hist.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([v, n]) => `${v}x${n}`)
      .join(' ');
  }

  rows.push({ file, count, area, stride, remainder: area % count, offset, ids });
}

rows.sort((a, b) => a.count - b.count);

console.log('file                                     count     area   area/count  idxOff  protos at +37');
for (const r of rows) {
  const ratio = r.stride != null ? String(r.stride) : (r.area / r.count).toFixed(3);
  console.log(
    `${r.file.slice(0, 38).padEnd(40)} ${String(r.count).padStart(5)} ${String(r.area).padStart(8)} ` +
      `${ratio.padStart(11)}  ${String(r.offset ?? '-').padStart(6)}  ${r.ids}`,
  );
}

const fixed = rows.filter((r) => r.offset != null);
const integer = rows.filter((r) => r.stride != null);
console.log(`\nv1 files: ${rows.length}`);
console.log(`  area/count is an integer      : ${integer.length}`);
console.log(`  ...and index==ordinal resolves: ${fixed.length}`);
console.log(`  variable-length (no single stride): ${rows.length - integer.length}`);
console.log('\ninteger-stride candidates without a resolving index offset:');
for (const r of integer.filter((x) => x.offset == null)) {
  console.log(`  ${r.file.slice(0, 40)}  count=${r.count} stride=${r.stride}`);
}
console.log('\nstride histogram (integer-stride files):');
const hist = new Map<number, number>();
for (const r of integer) hist.set(r.stride!, (hist.get(r.stride!) ?? 0) + 1);
for (const [s, n] of [...hist.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(s).padStart(4)}: ${n} file(s)`);
