/**
 * Downloads the reference parser's own test fixtures and reports the raw
 * structure of each body so our layout assumptions can be checked against
 * blueprints with known-good parse expectations.
 *
 *   node tools/inspect-fixtures.mjs
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipBytes } from '../src/engine/bp/gzip.ts';
import { base64ToBytes } from '../src/engine/bp/codec.ts';

const REPO = 'LRFalk01/DSP-Blueprint-Parser';
const BRANCH = 'master';
const CACHE = resolve(import.meta.dirname, '..', 'docs/research/_raw/reffix');
mkdirSync(CACHE, { recursive: true });

const FIXTURES = ['spec/fixtures/blueprint.0.10.34.28326.txt', 'spec/fixtures/blueprint.0.9.27.15466.txt', 'spec/fixtures/blueprint.txt'];

async function fetchFixture(path) {
  const local = resolve(CACHE, path.split('/').pop());
  if (existsSync(local)) return readFileSync(local, 'utf8');
  const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${path}`;
  const res = await fetch(url, { headers: { 'user-agent': 'dsp-factory-sim/0.1' } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const text = await res.text();
  writeFileSync(local, text);
  return text;
}

function decompress(text) {
  const t = text.trim();
  const tail = t.slice('BLUEPRINT:'.length);
  const closeQuote = tail.lastIndexOf('"');
  const head = tail.slice(0, closeQuote);
  const openQuote = head.lastIndexOf('"');
  const field = head.slice(openQuote + 1);
  const b64 = field.slice(field.lastIndexOf(',') + 1).replace(/\s+/g, '');
  return base64ToBytes(b64);
}

for (const path of FIXTURES) {
  let text;
  try {
    text = await fetchFixture(path);
  } catch (err) {
    console.log(`SKIP ${path}: ${err.message}`);
    continue;
  }
  const header = text.trim().slice(0, 140).replace(/\n/g, '');
  const compressed = decompress(text);
  let body;
  try {
    body = await gunzipBytes(compressed);
  } catch (err) {
    console.log(`\n--- ${path}\n  gunzip failed: ${err.message}`);
    continue;
  }
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  console.log(`\n--- ${path}`);
  console.log(`  header: ${header.slice(0, 100)}`);
  console.log(`  body=${body.length} B  version=${dv.getUint32(0, true)}  areaCount=${body[28]}`);
  console.log(`  header i32s: ${[0, 4, 8, 12, 16, 20, 24, 28].map((o) => `${o}:${dv.getInt32(o, true)}`).join(' ')}`);
  // Scan the first 220 bytes for path numbers.
  const paths = [];
  for (let off = 29; off < Math.min(body.length - 4, 220); off++) {
    const v = dv.getInt32(off, true);
    if (v === -100 || v === -101 || v === -102) paths.push(`${v}@${off}`);
  }
  console.log(`  path numbers near start: ${paths.join(', ') || 'none'}`);
  const bytes = [];
  for (let i = 29; i < Math.min(body.length, 125); i++) bytes.push(`${i}:${body[i]}`);
  console.log(`  bytes 29..124: ${bytes.join(' ')}`);
}
