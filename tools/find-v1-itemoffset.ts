/**
 * Looks for the prototype-id column in the body-version-1 blueprints that use a record
 * size other than the fixed 61 bytes.
 *
 * The 61-byte family is settled (index at +0, stride 61, exact area fit on 8 files).
 * The remaining files need a different size, and the previous attempt assumed `itemId`
 * was at +37 — the offset measured in the 61-byte family. If the record is a different
 * length, that offset can move, so this measures it per file: the itemId column is the
 * one whose values are almost all real DSP prototype ids.
 *
 *   node --experimental-strip-types tools/find-v1-itemoffset.ts
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { base64ToBytes } from '../src/engine/bp/codec.ts';
import { gunzipBytes } from '../src/engine/bp/gzip.ts';

const ROOT = resolve(import.meta.dirname, '..');
const dir = resolve(ROOT, 'docs/research/_raw/realbp');
const files = readdirSync(dir).filter((f) => f.endsWith('.txt')).sort();

async function payloadOf(file: string): Promise<Uint8Array> {
  const text = readFileSync(resolve(dir, file), 'utf8');
  const body = text.trim().slice('BLUEPRINT:'.length);
  const closeQuote = body.lastIndexOf('"');
  const prefix = body.slice(0, closeQuote);
  const token = prefix.slice(prefix.lastIndexOf(',') + 1);
  const quote = token.indexOf('"');
  return gunzipBytes(base64ToBytes(token.slice(quote + 1)));
}

interface Unsolved {
  file: string;
  count: number;
  areasEnd: number;
  area: number;
}
const unsolved: Unsolved[] = [];

for (const file of files) {
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
  const area = raw.length - areasEnd - 4;
  // Skip the family already solved: exact 61-byte stride.
  if (area % count === 0 && area / count === 61) continue;
  unsolved.push({ file, count, areasEnd, area });
}

console.log(`unsolved v1 files: ${unsolved.length}`);

for (const u of unsolved.slice(0, 8)) {
  const raw = await payloadOf(u.file);
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const start = u.areasEnd + 4;

  // Score every 2-byte offset as a prototype-id column, reading records at the implied
  // average stride. An id column has few distinct values and they are all plausible.
  const avg = u.area / u.count;
  console.log(`\n${u.file.slice(0, 44)}`);
  console.log(`  count=${u.count} area=${u.area} avg=${avg.toFixed(2)} start=${start}`);

  if (!Number.isInteger(avg)) {
    console.log('  average stride is not an integer; the record size varies within this file');
  }

  const stride = Math.round(avg);
  const scored: { off: number; distinct: number; plausible: number; top: string }[] = [];
  for (let off = 0; off + 2 <= stride; off++) {
    const hist = new Map<number, number>();
    let plausible = 0;
    let n = 0;
    for (let i = 0; i < u.count; i++) {
      const at = start + i * stride + off;
      if (at + 2 > raw.length) break;
      const v = dv.getInt16(at, true);
      hist.set(v, (hist.get(v) ?? 0) + 1);
      if (v > 0 && v < 8000) plausible++;
      n++;
    }
    if (n === 0) continue;
    scored.push({
      off,
      distinct: hist.size,
      plausible: plausible / n,
      top: [...hist.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([v, c]) => `${v}x${c}`)
        .join(' '),
    });
  }
  scored.sort((a, b) => b.plausible - a.plausible || a.distinct - b.distinct);
  for (const s of scored.filter((x) => x.plausible > 0.95).slice(0, 5)) {
    console.log(`    +${String(s.off).padStart(2)}  plausible=${(s.plausible * 100).toFixed(1)}%  distinct=${s.distinct}  ${s.top}`);
  }
}
