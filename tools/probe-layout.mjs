/**
 * Determines which (header-length, area-size, count-offset) combination the
 * cached real blueprints use, by walking path-discriminant records from each
 * candidate start and checking whether the walk consumes the buffer.
 *
 *   node tools/probe-layout.mjs
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { base64ToBytes } from '../src/engine/bp/codec.ts';
import { gunzipBytes } from '../src/engine/bp/gzip.ts';

const REAL = resolve(import.meta.dirname, '..', 'docs/research/_raw/realbp');
const FIX = resolve(import.meta.dirname, '..', 'docs/research/_raw/reffix');

function payloadOf(text) {
  const trimmed = text.trim();
  const body = trimmed.slice('BLUEPRINT:'.length);
  const closeQuote = body.lastIndexOf('"');
  const prefix = body.slice(0, closeQuote);
  const lastComma = prefix.lastIndexOf(',');
  const tailToken = prefix.slice(lastComma + 1);
  const q = tailToken.indexOf('"');
  const candidates = [];
  if (q >= 0) candidates.push(tailToken.slice(q + 1));
  const dataStart = prefix.lastIndexOf('"');
  if (dataStart >= 0) {
    const dataField = prefix.slice(dataStart + 1);
    candidates.push(dataField.slice(dataField.lastIndexOf(',') + 1));
  }
  for (const c of candidates) {
    try {
      const head = base64ToBytes(c.slice(0, 8));
      if (head[0] === 0x1f && head[1] === 0x8b) return c;
    } catch {
      /* next */
    }
  }
  throw new Error('no gzip payload');
}

/** Walk path-discriminant records; returns the end offset or throws. */
function walk(body, start, minPath) {
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  let off = start;
  let n = 0;
  while (off + 4 <= body.length) {
    const path = dv.getInt32(off, true);
    if (path > minPath || path < -199) return { ok: false, n, off, reason: `path ${path} @${off}` };
    const itemId = dv.getInt16(off + 8, true);
    let size = 49;
    if (itemId > 2000 && itemId < 2010) size += 8;
    else if (itemId > 2010 && itemId < 2020) size += 32;
    const pc = dv.getUint16(off + size - 2, true);
    if (pc > 4096) return { ok: false, n, off, reason: `params ${pc} @${off}` };
    size += pc * 4;
    off += 4 + size;
    n++;
    if (n > 5_000_000) return { ok: false, n, off, reason: 'runaway' };
  }
  return { ok: true, n, off, remaining: body.length - off };
}

const targets = [];
for (const f of readdirSync(REAL).filter((x) => x.endsWith('.txt')).slice(0, 10)) targets.push([f.slice(0, 30), resolve(REAL, f)]);
for (const f of readdirSync(FIX).filter((x) => x.endsWith('.txt'))) targets.push([`[ref] ${f.slice(0, 24)}`, resolve(FIX, f)]);

for (const [label, path] of targets) {
  let body;
  try {
    body = await gunzipBytes(base64ToBytes(payloadOf(readFileSync(path, 'utf8'))));
  } catch (err) {
    console.log(`${label}: payload failed: ${err.message}`);
    continue;
  }
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const areaCount = body[28] ?? 0;
  const version = dv.getUint32(0, true);
  const results = [];
  for (const headerSize of [29, 28, 32]) {
    for (const areaSize of [14, 16]) {
      const areasEnd = headerSize + areaCount * areaSize;
      if (areasEnd + 8 > body.length) continue;
      // Shape with an explicit count before the records.
      const count = dv.getUint32(areasEnd, true);
      const firstPath = dv.getInt32(areasEnd + 4, true);
      if (count > 0 && count < 1_000_000 && firstPath <= -100) {
        results.push(`h${headerSize}a${areaSize}: count=${count} @${areasEnd} path=${firstPath}`);
      }
      // Shape with records starting immediately.
      const pathHere = dv.getInt32(areasEnd, true);
      if (pathHere <= -100 && pathHere >= -199) {
        const w = walk(body, areasEnd, -100);
        results.push(`h${headerSize}a${areaSize}: open path=${pathHere} ${w.ok ? `WALK OK n=${w.n} remaining=${w.remaining}` : `walk fail ${w.reason}`}`);
      }
    }
  }
  console.log(`\n${label} (len=${body.length} version=${version} areas=${areaCount})`);
  for (const r of results) console.log(`   ${r}`);
  if (results.length === 0) {
    console.log('   bytes 28..48:', [...body.subarray(28, 49)].map((v, i) => `${28 + i}:${v}`).join(' '));
  }
}
