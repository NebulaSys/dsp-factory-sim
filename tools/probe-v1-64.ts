/**
 * Maps the 64-byte body-version-1 record family.
 *
 * The stride-61 family is solved (index at +0, itemId at +37). A second family exists:
 * the 4-building fire-plant blueprint has a 256-byte record area that divides exactly by
 * 64, four records with index 0..3 at +0, and carries `9c 08` (= 2204, Thermal Power
 * Plant) as a constant column.
 *
 * This prints the whole file so the 64-byte layout can be read off directly, and reports
 * the per-record byte profile to separate the fixed fields from the varying ones.
 *
 *   node --experimental-strip-types tools/probe-v1-64.ts
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

/** Files whose record area divides exactly by 64 and whose count is small. */
interface Cand {
  file: string;
  raw: Uint8Array;
  count: number;
  areasEnd: number;
  area: number;
}
const cands: Cand[] = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith('.txt'))) {
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
  const area = raw.length - areasEnd - 4;
  if (area % 64 !== 0 || area / 64 !== count) continue;
  cands.push({ file, raw, count, areasEnd, area });
}
cands.sort((a, b) => a.count - b.count);
console.log(`files with an exact 64-byte stride: ${cands.length}`);
for (const c of cands) console.log(`  count=${c.count} ${c.file.slice(0, 44)}`);

const target = cands[0];
if (!target) {
  console.log('none found');
  process.exit(0);
}

const { raw, count, areasEnd } = target;
const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
const STRIDE = 64;
console.log(`\n${'='.repeat(74)}\n${target.file}\ncount=${count} stride=${STRIDE} areasEnd=${areasEnd}`);

console.log('\nrecords:');
for (let i = 0; i < count; i++) {
  const at = areasEnd + 4 + i * STRIDE;
  const bytes = [...raw.subarray(at, at + STRIDE)];
  console.log(`  #${i}  ${bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')}`);
}

console.log('\nper-byte profile:');
for (let off = 0; off < STRIDE; off++) {
  const seen = new Set<number>();
  for (let i = 0; i < count; i++) seen.add(raw[areasEnd + 4 + i * STRIDE + off]!);
  const vals = [...seen].slice(0, 8).map((v) => v.toString(16).padStart(2, '0')).join(' ');
  console.log(`  +${String(off).padStart(2)}: ${seen.size === 1 ? 'CONST' : `(${String(seen.size).padStart(2)})`} ${vals}`);
}

console.log('\n16-bit columns that are constant or few-valued (candidate itemId/model):');
for (let off = 0; off + 2 <= STRIDE; off++) {
  const hist = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const v = dv.getInt16(areasEnd + 4 + i * STRIDE + off, true);
    hist.set(v, (hist.get(v) ?? 0) + 1);
  }
  if (hist.size <= 2) {
    const vals = [...hist.keys()].map((v) => `${v} (${v.toString(16)})`).join(', ');
    console.log(`  +${String(off).padStart(2)}: ${vals}`);
  }
}
