/**
 * Hash verification survey across REAL game blueprints from the community
 * repository. Reports how many validate with the documented MD5F region (whole
 * string up to the closing data quote) versus not.
 *
 *   node tools/hash-survey.mjs
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { md5f } from '../src/engine/bp/md5f.ts';

const dir = resolve(import.meta.dirname, '..', 'docs/research/_raw/realbp');
const files = readdirSync(dir).filter((f) => f.endsWith('.txt'));

let ok = 0;
let bad = 0;
let failed = [];
const shapeCounts = new Map();

for (const f of files) {
  const s = readFileSync(resolve(dir, f), 'utf8').trim();
  const body = s.slice('BLUEPRINT:'.length);
  const closeQuote = body.lastIndexOf('"');
  if (closeQuote < 0) {
    failed.push([f, 'no closing quote']);
    continue;
  }
  const declared = body.slice(closeQuote + 1).trim();
  const prefix = s.slice(0, 'BLUEPRINT:'.length + closeQuote);
  const payloadPrefix = body.slice(0, closeQuote);
  // Which envelope shape: does the payload carry a comma before the base64?
  const lastCommaInPayload = payloadPrefix.lastIndexOf(',');
  const token = payloadPrefix.slice(lastCommaInPayload + 1);
  const shape = token.includes('"') ? 'v1(quote-before-b64)' : 'v0(comma-before-b64)';
  shapeCounts.set(shape, (shapeCounts.get(shape) ?? 0) + 1);

  const candidates = [prefix, `${prefix}"`, payloadPrefix, `${payloadPrefix}"`];
  const hashes = candidates.map((c) => md5f(c));
  if (hashes.includes(declared.toLowerCase())) {
    ok++;
  } else {
    bad++;
    if (failed.length < 6) {
      const first = hashes[0] ?? '';
      failed.push([f, `declared=${declared.slice(0, 12)} got=${first.slice(0, 12)}`]);
    }
  }
}

console.log(`real blueprints scanned : ${files.length}`);
console.log(`hash valid              : ${ok}`);
console.log(`hash not matching       : ${bad}`);
console.log(`envelope shapes         : ${[...shapeCounts.entries()].map(([k, v]) => `${k}=${v}`).join(', ')}`);
console.log('examples of non-matching:');
for (const [f, why] of failed) console.log(`  ${f.slice(0, 46)} — ${why}`);
