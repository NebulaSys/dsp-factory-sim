/**
 * Stage the real-blueprint corpus used by the measurement tools and several gates.
 *
 * The blueprints are other people's work and are not vendored in this repository, so a fresh
 * clone has to fetch them. They come from the public `DSPBluePrints/FactoryBluePrints` repo:
 *
 *   realbp  — the `仙术_Illegal` folder (28 files, stacked / cheat builds)
 *   realbp2 — a few ordinary blueprints from `基础材料_Basic-Materials`, used as an INDEPENDENT
 *             check. The recipe decode was first measured only on 仙术_Illegal, and a rule that
 *             holds on one corpus of one kind is not yet a rule.
 *
 * Downloads are plain HTTPS from raw.githubusercontent.com; nothing is executed and no game
 * files are touched.
 *
 *   node tools/fetch-corpus.mjs            # stage whatever is missing
 *   node tools/fetch-corpus.mjs --force    # re-download everything
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const RAW = resolve(ROOT, 'docs', 'research', '_raw');
const API = 'https://api.github.com/repos/DSPBluePrints/FactoryBluePrints/contents';
const RAW_BASE = 'https://raw.githubusercontent.com/DSPBluePrints/FactoryBluePrints/main';
const FORCE = process.argv.includes('--force');

const headers = { 'User-Agent': 'dsp-factory-sim-corpus-fetch' };

async function listDir(folder) {
  const url = `${API}/${encodeURIComponent(folder)}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`listing ${folder} failed: HTTP ${res.status}`);
  const items = await res.json();
  return items.filter((x) => x.type === 'file' && x.name.endsWith('.txt')).map((x) => x.name);
}

async function download(folder, name, destDir) {
  const dest = resolve(destDir, name);
  if (existsSync(dest) && !FORCE) return 'skip';
  const url = `${RAW_BASE}/${encodeURIComponent(folder)}/${encodeURIComponent(name)}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GET ${name} failed: HTTP ${res.status}`);
  const text = await res.text();
  if (!text.startsWith('BLUEPRINT:')) throw new Error(`${name} is not a BLUEPRINT string`);
  writeFileSync(dest, text, 'utf8');
  return 'ok';
}

async function stage(folder, destName, limit) {
  const destDir = resolve(RAW, destName);
  mkdirSync(destDir, { recursive: true });
  const names = await listDir(folder);
  const pick = limit ? names.slice(0, limit) : names;
  console.log(`\n${folder}  ->  docs/research/_raw/${destName}  (${pick.length} of ${names.length} files)`);
  let ok = 0;
  let skipped = 0;
  for (const name of pick) {
    try {
      const r = await download(folder, name, destDir);
      if (r === 'ok') ok++;
      else skipped++;
    } catch (err) {
      console.log(`  FAIL ${name}: ${err.message}`);
    }
  }
  const total = readdirSync(destDir).filter((f) => f.endsWith('.txt')).length;
  console.log(`  downloaded ${ok}, already present ${skipped}; folder now holds ${total}`);
}

await stage('仙术_Illegal', 'realbp');
await stage('基础材料_Basic-Materials', 'realbp2', 5);

console.log('\ndone. Re-run the corpus gates now:');
console.log('  node --experimental-strip-types tools/corpus-status.ts');
console.log('  node --experimental-strip-types tools/validate-v1-recipe-facility.ts');
