/**
 * Audits one real blueprint: is it a valid game export, and where does the vertical stacking
 * come from?
 *
 * The checks are the ones that separate "this string is intact" from "the game would accept
 * this layout":
 *
 *   1. the MD5F checksum, which proves the string is exactly what was exported;
 *   2. the envelope fields, where a mod or editor shows up as an author / custom version;
 *   3. the declared vs parsed building count, so nothing is being invented or dropped;
 *   4. reference and area integrity;
 *   5. whether any two buildings occupy the *same* cell at the *same* height, which is a real
 *      collision rather than a stack;
 *   6. the vertical structure: how many distinct heights there are, how far apart, and
 *      whether stacks repeat the same prototype at the same (x, y).
 *
 *   node --experimental-strip-types tools/audit-blueprint.ts [sample-name]
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeBlueprint } from '../src/engine/bp/codec.ts';

const ROOT = resolve(import.meta.dirname, '..');
const dir = resolve(ROOT, 'docs/research/_raw/realbp');

const wanted = process.argv[2] ?? 'solar';

// Prefer the bundled sample the UI loads, falling back to the raw corpus. In the manifest
// `name` is the bundled file and `file` records the original corpus export it came from.
const SAMPLES = resolve(ROOT, 'public/samples');
let path = '';
let source = '';
try {
  const manifest = JSON.parse(readFileSync(resolve(SAMPLES, 'manifest.json'), 'utf8')) as { name: string; file: string; note: string }[];
  const entry = manifest.find((m) => m.name.includes(wanted));
  if (entry) {
    path = resolve(SAMPLES, entry.name);
    source = `bundled sample 「${entry.name}」 (${entry.note})\n         original export: ${entry.file}`;
  }
} catch {
  /* fall through to the corpus */
}

if (!path) {
  // An explicit path wins over the corpus name search, so a fixture outside the corpus
  // (such as the reference blueprint) can be audited the same way.
  if (wanted.includes('/') || wanted.includes('\\') || wanted.endsWith('.txt')) {
    path = resolve(ROOT, wanted);
    source = 'explicit path';
  } else {
    const { readdirSync } = await import('node:fs');
    const hit = readdirSync(dir).find((f) => f.includes(wanted));
    if (!hit) throw new Error(`no blueprint matching "${wanted}"`);
    path = resolve(dir, hit);
    source = 'corpus file';
  }
}

const text = readFileSync(path, 'utf8').trim();
console.log(`file   : ${path.split(/[\\/]/).pop()}`);
console.log(`source : ${source}`);
console.log(`bytes  : ${text.length}\n`);

const decoded = await decodeBlueprint(text);
const { meta, body } = decoded;

console.log('=== 1. envelope ===');
console.log(`  format        : ${decoded.format}`);
console.log(`  hash          : ${decoded.hashWarning ? `MISMATCH — ${decoded.hashWarning}` : 'MD5F checksum MATCHES'}`);
console.log(`  gameVersion   : ${meta.gameVersion}`);
console.log(`  shortDesc     : ${JSON.stringify(meta.shortDesc)}`);
console.log(`  longDesc      : ${JSON.stringify(meta.longDesc.slice(0, 160))}`);
const extra = meta as unknown as Record<string, unknown>;
for (const key of ['author', 'customVersion', 'authorName', 'modVersion']) {
  if (extra[key] !== undefined) console.log(`  ${key.padEnd(13)} : ${JSON.stringify(extra[key])}`);
}
console.log(`  meta keys     : ${Object.keys(meta).join(', ')}`);

console.log('\n=== 2. declared vs parsed ===');
console.log(`  declared areas    : ${body.header.areaCount}`);
console.log(`  header dragbox    : ${body.header.dragboxSizeX} x ${body.header.dragboxSizeY}`);
for (const area of body.areas) {
  console.log(`  area ${area.index}: ${area.width} x ${area.height}, segments ${area.areaSegments}, parent ${area.parentIndex}`);
}
console.log(`  parsed buildings  : ${body.buildings.length}`);

console.log('\n=== 3. integrity ===');
const n = body.buildings.length;
const areaCount = body.areas.length;
let badArea = 0;
let dangling = 0;
const byIndex = new Map(body.buildings.map((b) => [b.index, b]));
for (const b of body.buildings) {
  if (b.areaIndex < 0 || b.areaIndex >= areaCount) badArea++;
  for (const ref of [b.outputObjectIndex, b.inputObjectIndex]) {
    if (ref >= 0 && !byIndex.has(ref)) dangling++;
  }
}
console.log(`  areaIndex out of range : ${badArea}`);
console.log(`  dangling object refs   : ${dangling}`);
const indexes = new Set(body.buildings.map((b) => b.index));
console.log(`  index uniqueness       : ${indexes.size === n ? 'all distinct' : `DUPLICATES (${n - indexes.size})`}`);

console.log('\n=== 4. coordinates ===');
const xs = body.buildings.map((b) => b.x);
const ys = body.buildings.map((b) => b.y);
const zs = body.buildings.map((b) => b.z);
const range = (v: number[]): string => `${Math.min(...v)} .. ${Math.max(...v)}`;
console.log(`  x ${range(xs)}`);
console.log(`  y ${range(ys)}`);
console.log(`  z ${range(zs)}`);
const offGrid = body.buildings.filter((b) => Math.abs(b.x - Math.round(b.x)) > 1e-6 || Math.abs(b.y - Math.round(b.y)) > 1e-6).length;
console.log(`  off-grid (non-integer x/y) : ${offGrid}`);

console.log('\n=== 5. collisions: same cell AND same height ===');
const cells = new Map<string, number[]>();
for (const b of body.buildings) {
  const key = `${b.x}|${b.y}|${b.z}`;
  const list = cells.get(key) ?? [];
  list.push(b.index);
  cells.set(key, list);
}
const colliding = [...cells.entries()].filter(([, v]) => v.length > 1);
console.log(`  occupied (x,y,z) cells     : ${cells.size} for ${n} buildings`);
console.log(`  cells with >1 building     : ${colliding.length}`);
for (const [key, list] of colliding.slice(0, 5)) {
  const ids = list.map((i) => byIndex.get(i)!.itemId);
  console.log(`    ${key}  -> ${list.length} buildings, itemIds ${ids.join(', ')}`);
}

console.log('\n=== 6. vertical structure ===');
const zHist = new Map<number, number>();
for (const z of zs) zHist.set(z, (zHist.get(z) ?? 0) + 1);
const levels = [...zHist.keys()].sort((a, b) => a - b);
console.log(`  distinct heights : ${levels.length}`);
console.log(`  height ladder    : ${levels.slice(0, 20).join(', ')}${levels.length > 20 ? ` … (${levels.length} total)` : ''}`);
const steps = levels.slice(1).map((z, i) => Math.round((z - levels[i]!) * 1000) / 1000);
const stepHist = new Map<number, number>();
for (const s of steps) stepHist.set(s, (stepHist.get(s) ?? 0) + 1);
console.log(`  gaps between heights : ${[...stepHist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([s, c]) => `${s}x${c}`).join(', ')}`);

// Same (x, y) reused across heights, and whether the stack repeats one prototype.
const columns = new Map<string, typeof body.buildings>();
for (const b of body.buildings) {
  const key = `${b.x}|${b.y}`;
  const list = columns.get(key) ?? [];
  list.push(b);
  columns.set(key, list);
}
const stacked = [...columns.values()].filter((v) => v.length > 1);
console.log(`  distinct (x,y) columns      : ${columns.size}`);
console.log(`  columns holding >1 building : ${stacked.length} (${((stacked.length / Math.max(1, columns.size)) * 100).toFixed(0)}% of columns)`);
const deepest = stacked.slice().sort((a, b) => b.length - a.length)[0];
if (deepest) {
  console.log(`  deepest column : (${deepest[0]!.x}, ${deepest[0]!.y}) holds ${deepest.length} buildings`);
  console.log(`    heights ${deepest.map((b) => b.z).sort((a, b) => a - b).join(', ')}`);
  console.log(`    itemIds ${deepest.map((b) => b.itemId).join(', ')}`);
}

console.log('\n=== 7. prototype mix ===');
const ids = new Map<number, number>();
for (const b of body.buildings) ids.set(b.itemId, (ids.get(b.itemId) ?? 0) + 1);
for (const [id, count] of [...ids.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`  itemId ${String(id).padStart(5)} : ${count}`);
}
