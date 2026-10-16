/**
 * Copies a real decoded game blueprint into the dev server's static folder so the UI
 * can be pointed at it with `?real=1`.
 *
 * The point is to see a real 8687-building v1 blueprint rendered by the actual view,
 * which is the difference between "the decoder produces records" and "the simulator
 * shows the player's factory".
 *
 *   node tools/prepare-real-sample.mjs
 */

import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { base64ToBytes, decodeBody } from '../src/engine/bp/codec.ts';
import { gunzipBytes } from '../src/engine/bp/gzip.ts';

const ROOT = resolve(import.meta.dirname, '..');
const srcDir = resolve(ROOT, 'docs/research/_raw/realbp');
const outDir = resolve(ROOT, 'public/samples');
mkdirSync(outDir, { recursive: true });

/** Pick the largest decodable v1 blueprint and the mixed v2 one. */
const picks: { out: string; file: string; note: string }[] = [];

const candidates = readdirSync(srcDir)
  .filter((f) => f.endsWith('.txt'))
  .map((f) => ({ f, size: statSync(resolve(srcDir, f)).size }))
  .sort((a, b) => b.size - a.size);

for (const { f } of candidates) {
  const text = readFileSync(resolve(srcDir, f), 'utf8').trim();
  try {
    const body = text.slice('BLUEPRINT:'.length);
    const closeQuote = body.lastIndexOf('"');
    const prefix = body.slice(0, closeQuote);
    const token = prefix.slice(prefix.lastIndexOf(',') + 1);
    const quote = token.indexOf('"');
    const raw = await gunzipBytes(base64ToBytes(token.slice(quote + 1)));
    const parsed = decodeBody(raw);
    if (parsed.buildings.length === 0) continue;
    // Keep one solar farm (v1) and one belt/sorter factory (v2).
    const isV1 = raw[0] === 1;
    const hasSorters = parsed.buildings.some((b) => b.itemId > 2010 && b.itemId < 2020);
    const target = isV1 ? 'solar-farm-v1.txt' : hasSorters ? 'factory-v2.txt' : null;
    if (!target) continue;
    if (picks.some((p) => p.out === target)) continue;
    picks.push({ out: target, file: f, note: `${parsed.buildings.length} buildings, body v${raw[0]}` });
    readFileSync(resolve(srcDir, f)); // sanity: readable
  } catch {
    continue;
  }
  if (picks.length >= 2) break;
}

const manifest: { name: string; file: string; note: string }[] = [];
for (const p of picks) {
  copyFileSync(resolve(srcDir, p.file), resolve(outDir, p.out));
  manifest.push({ name: p.out, file: p.file, note: p.note });
  console.log(`copied ${p.out.padEnd(20)} ${p.note}  (from ${p.file.slice(0, 40)})`);
}
writeFileSync(resolve(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
console.log(`\nwrote ${outDir}\\manifest.json`);
