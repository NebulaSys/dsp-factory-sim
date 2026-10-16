/**
 * Diagnoses why 27 of the 28 cached real blueprints decode their header and areas
 * but yield zero buildings, while one decodes fully.
 *
 * The record section is found by shape detection: a u32 building count followed by
 * a path-prefixed record, or records starting immediately. Reporting the candidate
 * values at that offset for each file shows whether the payload uses a variant
 * wrapper or a different record framing.
 *
 *   node --experimental-strip-types tools/diagnose-corpus.ts
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { base64ToBytes } from '../src/engine/bp/codec.ts';
import { gunzipBytes } from '../src/engine/bp/gzip.ts';

const ROOT = resolve(import.meta.dirname, '..');
const dir = resolve(ROOT, 'docs/research/_raw/realbp');
const files = readdirSync(dir).filter((f) => f.endsWith('.txt')).sort();

/** Pull the gzip body out of the BLUEPRINT envelope. */
async function payloadOf(text: string): Promise<Uint8Array | null> {
  const body = text.trim().slice('BLUEPRINT:'.length);
  const closeQuote = body.lastIndexOf('"');
  if (closeQuote < 0) return null;
  const prefix = body.slice(0, closeQuote);
  const token = prefix.slice(prefix.lastIndexOf(',') + 1);
  const quote = token.indexOf('"');
  if (quote < 0) return null;
  try {
    return await gunzipBytes(base64ToBytes(token.slice(quote + 1)));
  } catch {
    return null;
  }
}

console.log('file                                   bodyB  ver areaCnt areasEnd  u32@areasEnd  i32@areasEnd  i32@+4');
for (const file of files) {
  const text = readFileSync(resolve(dir, file), 'utf8');
  let raw: Uint8Array | null = null;
  try {
    raw = await payloadOf(text);
  } catch {
    raw = null;
  }
  if (!raw) {
    console.log(`${file.slice(0, 36).padEnd(38)} payload not gzip-decodable`);
    continue;
  }
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const version = raw[0];
  const areaCount = raw[28] ?? 0;
  const areasEnd = 29 + areaCount * 14;
  const u32 = areasEnd + 4 <= raw.length ? dv.getUint32(areasEnd, true) : -1;
  const i32 = areasEnd + 4 <= raw.length ? dv.getInt32(areasEnd, true) : 0;
  const i32next = areasEnd + 8 <= raw.length ? dv.getInt32(areasEnd + 4, true) : 0;
  console.log(
    `${file.slice(0, 36).padEnd(38)} ${String(raw.length).padStart(5)}  ${String(version).padStart(3)}  ${String(areaCount).padStart(6)}  ${String(areasEnd).padStart(7)}  ${String(u32).padStart(11)}  ${String(i32).padStart(11)}  ${String(i32next).padStart(8)}`,
  );
}
