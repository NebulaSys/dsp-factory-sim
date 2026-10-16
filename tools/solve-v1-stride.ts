/**
 * Measures the body-version-1 index offset and record stride together.
 *
 * The greedy lookahead in the previous probe matched the next ordinal at spurious
 * offsets. This instead requires a *consistent* stride: for a candidate (offset, stride)
 * pair, the value at `start + i*stride + offset` must equal `i` for at least 50
 * consecutive records. That cannot be satisfied by coincidence, and it needs no
 * assumption about which fields sit where.
 *
 *   node --experimental-strip-types tools/solve-v1-stride.ts
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

const MIN_RUN = 50;

interface Hit {
  file: string;
  count: number;
  start: number;
  offset: number;
  stride: number;
  run: number;
  /** Records that fit at this stride before the invariant breaks. */
  total: number;
}
const hits: Hit[] = [];

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
  if (areasEnd + 4 > raw.length) continue;
  const count = dv.getUint32(areasEnd, true);
  if (count < 2 || count > 200000) continue;

  let best: Hit | null = null;
  for (let offset = 0; offset <= 48; offset++) {
    for (let stride = 40; stride <= 110; stride++) {
      // Start where record 0 begins: right after the count word, or offset by the
      // stride's own padding.
      for (const start of [areasEnd + 4, areasEnd + 4 + offset]) {
        if (start + stride + 4 > raw.length) continue;
        let run = 0;
        while (run < count && start + run * stride + offset + 4 <= raw.length) {
          if (dv.getInt32(start + run * stride + offset, true) !== run) break;
          run++;
        }
        if (run < MIN_RUN) continue;
        if (!best || run > best.run) best = { file, count, start, offset, stride, run, total: run };
      }
    }
  }
  if (best) hits.push(best);
}

console.log('file                                     count   start  idxOff  stride  run   area      area/stride');
for (const h of hits) {
  let area = 0;
  try {
    const raw = await payloadOf(h.file);
    const areasEnd = 29 + ((raw[28] ?? 0) as number) * 14;
    area = raw.length - areasEnd - 4;
  } catch {
    /* ignore */
  }
  console.log(
    `${h.file.slice(0, 38).padEnd(40)} ${String(h.count).padStart(6)} ${String(h.start).padStart(6)} ` +
      `${String(h.offset).padStart(7)} ${String(h.stride).padStart(7)} ${String(h.run).padStart(5)}   ` +
      `${String(area).padStart(8)}  ${(area / h.stride).toFixed(3)}`,
  );
}

console.log('\nstride histogram (weighted by files):');
const hist = new Map<number, number>();
for (const h of hits) hist.set(h.stride, (hist.get(h.stride) ?? 0) + 1);
for (const [s, n] of [...hist.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(s).padStart(4)}: ${n} file(s)`);

console.log('\nindex offset histogram (weighted by files):');
const hist2 = new Map<number, number>();
for (const h of hits) hist2.set(h.offset, (hist2.get(h.offset) ?? 0) + 1);
for (const [s, n] of [...hist2.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(s).padStart(4)}: ${n} file(s)`);

console.log(`\nfiles solved: ${hits.length} of ${files.length}`);
