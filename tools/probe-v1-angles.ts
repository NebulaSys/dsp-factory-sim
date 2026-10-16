/**
 * Checks whether the floats at +29 and +33 in the 61-byte body-version-1 record are the
 * two orientation angles.
 *
 * The 4-building fire-plant file's first record holds `00 00 b4 42` at both offsets,
 * which is 90.0f. The decoder currently reads those eight bytes and throws them away
 * (naming them `poseExtra0`/`poseExtra1`), so if they are really `yaw`/`yaw2` the
 * simulator is discarding orientation data it already has in hand.
 *
 * This reports the observed value distribution across every fixed-stride v1 blueprint.
 * A genuine angle field should be finite, bounded, and dominated by right angles.
 *
 *   node --experimental-strip-types tools/probe-v1-angles.ts
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

const all: { file: string; count: number; a: number[]; b: number[] }[] = [];

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
  if (count === 0 || count > 200000) continue;
  const start = areasEnd + 4;
  const area = raw.length - start;
  // Only the family already known to use a fixed 61-byte stride.
  if (area % count !== 0 || area / count !== 61) continue;

  const a: number[] = [];
  const b: number[] = [];
  for (let i = 0; i < count; i++) {
    a.push(dv.getFloat32(start + i * 61 + 29, true));
    b.push(dv.getFloat32(start + i * 61 + 33, true));
  }
  all.push({ file, count, a, b });
}

/** Summarise one column: how many finite, and the most common values. */
function summarise(values: number[], count: number): string {
  let finite = 0;
  let inRange = 0;
  const hist = new Map<string, number>();
  for (const v of values) {
    if (Number.isFinite(v)) {
      finite++;
      if (Math.abs(v) <= 1e6) inRange++;
      const key = Number.isInteger(v) ? String(v) : v.toPrecision(6);
      hist.set(key, (hist.get(key) ?? 0) + 1);
    }
  }
  const top = [...hist.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, 4)
    .map(([v, n]) => `${v}x${n}`)
    .join(' ');
  return `finite ${finite}/${count}  |v|<=1e6 ${inRange} | top: ${top}`;
}

let totalRecs = 0;
let totalDegenerate = 0;
for (const r of all) {
  totalRecs += r.count;
  console.log(`\n${r.file.slice(0, 50)}  count=${r.count}`);
  console.log(`  +29: ${summarise(r.a, r.count)}`);
  console.log(`  +33: ${summarise(r.b, r.count)}`);
  const degenerate = r.a.filter((v) => v === 0).length;
  totalDegenerate += degenerate;
}

console.log(`\nfixed-61 files: ${all.length}   records: ${totalRecs}`);
console.log(`records whose +29 is exactly 0: ${totalDegenerate}`);
const angles: number[] = all.flatMap((r) => r.a).filter((v) => v !== 0 && Number.isFinite(v));
console.log(`non-zero +29 values: ${angles.length}`);
if (angles.length > 0) {
  console.log(`  range: ${Math.min(...angles)} .. ${Math.max(...angles)}`);
  const deg = new Set(angles.map((v) => ((v * 180) / Math.PI).toFixed(2)));
  console.log(`  distinct degrees: ${[...deg].slice(0, 12).join(', ')}`);
}
