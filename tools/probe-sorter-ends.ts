/**
 * Do a sorter's two anchors describe its two ends?
 *
 * A sorter record carries (x, y, z) and a secondary anchor (x2, y2, z2). If those are the two
 * ends of the arm, then each end can be matched to the building it touches, and the offset from
 * that building's centre gives a **connectable sorter position in the building's own frame** —
 * derived from real blueprints rather than read from a table.
 *
 * This checks the anchor span first, because the whole geometric approach depends on it.
 *
 *   node --experimental-strip-types tools/probe-sorter-ends.ts [--corpus]
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeBlueprint } from '../src/engine/bp/codec.ts';
import { loadDataset } from '../src/engine/loader.ts';

const ROOT = resolve(import.meta.dirname, '..');
const data = loadDataset(
  JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/dsp-vanilla.json'), 'utf8')),
);
const byId = new Map(data.buildings.map((b) => [b.id, b]));

const sorter = (id: number): boolean => id >= 2011 && id <= 2014;
const belt = (id: number): boolean => id >= 2001 && id <= 2003;
const key = (id: number): string => byId.get(id)?.key ?? `id${id}`;

async function collect(text: string): Promise<{ id: number; a: [number, number, number]; b: [number, number, number] }[]> {
  const d = await decodeBlueprint(text);
  const out: { id: number; a: [number, number, number]; b: [number, number, number] }[] = [];
  for (const x of d.body.buildings) {
    if (!sorter(x.itemId)) continue;
    out.push({ id: x.itemId, a: [x.x, x.y, x.z], b: [x.x2, x.y2, x.z2] });
  }
  return out;
}

const corpus = process.argv.includes('--corpus');
const sources: { name: string; text: string }[] = [];
if (corpus) {
  const dir = resolve(ROOT, 'docs/research/_raw/realbp');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.txt'))) {
    sources.push({ name: f, text: readFileSync(resolve(dir, f), 'utf8').trim() });
  }
  const sdir = resolve(ROOT, 'public/samples');
  for (const f of readdirSync(sdir).filter((x) => x.endsWith('.txt'))) {
    sources.push({ name: `sample:${f}`, text: readFileSync(resolve(sdir, f), 'utf8').trim() });
  }
} else {
  const name = process.argv[2] ?? 'factory-v2.txt';
  sources.push({ name, text: readFileSync(resolve(ROOT, 'public/samples', name), 'utf8').trim() });
}

const all: { id: number; a: [number, number, number]; b: [number, number, number] }[] = [];
for (const s of sources) {
  try {
    all.push(...(await collect(s.text)));
  } catch (e) {
    console.log(`  ${s.name}: FAILED ${(e as Error).message}`);
  }
}

console.log(`sorters examined: ${all.length}  (${sources.length} blueprints)\n`);

const span = (r: { a: [number, number, number]; b: [number, number, number] }): number =>
  Math.hypot(r.a[0] - r.b[0], r.a[1] - r.b[1], r.a[2] - r.b[2]);

const spans = all.map(span).sort((x, y) => x - y);
const hist = new Map<string, number>();
for (const s of spans) {
  const bucket = s === 0 ? '0' : s <= 0.05 ? '~0' : s <= 1.05 ? '1' : s <= 2.05 ? '2' : s <= 3.05 ? '3' : s <= 5 ? '4-5' : '>5';
  hist.set(bucket, (hist.get(bucket) ?? 0) + 1);
}
console.log('=== span between primary and secondary anchor (cells) ===');
console.log(`  min=${spans[0]?.toFixed(3)}  p50=${spans[Math.floor(spans.length / 2)]?.toFixed(3)}  p90=${spans[Math.floor(spans.length * 0.9)]?.toFixed(3)}  max=${spans[spans.length - 1]?.toFixed(3)}`);
for (const b of ['0', '~0', '1', '2', '3', '4-5', '>5']) {
  const n = hist.get(b) ?? 0;
  if (n) console.log(`  span ${b.padEnd(4)} : ${String(n).padStart(5)}  ${((n / all.length) * 100).toFixed(1)}%`);
}

console.log('');
console.log('=== per sorter type ===');
for (const id of [2011, 2012, 2013, 2014]) {
  const rows = all.filter((r) => r.id === id);
  if (rows.length === 0) continue;
  const sp = rows.map(span).sort((x, y) => x - y);
  const nonZero = sp.filter((s) => s > 0.05).length;
  console.log(
    `  ${key(id).padEnd(14)} n=${String(rows.length).padStart(5)}  non-zero span=${String(nonZero).padStart(5)} ` +
      `(${((nonZero / rows.length) * 100).toFixed(0)}%)  p50=${sp[Math.floor(sp.length / 2)]?.toFixed(3)}`,
  );
}

console.log('');
console.log('=== raw examples with a non-zero span ===');
let shown = 0;
for (const r of all) {
  if (span(r) <= 0.05) continue;
  console.log(
    `  ${key(r.id).padEnd(14)} a=(${r.a.map((v) => v.toFixed(2)).join(', ')})  b=(${r.b.map((v) => v.toFixed(2)).join(', ')})  span=${span(r).toFixed(2)}`,
  );
  if (++shown >= 10) break;
}
if (shown === 0) {
  console.log('  (none — every sorter has both anchors at the same point)');
}

// Also: how many sorters have both anchors exactly equal?
const equal = all.filter((r) => span(r) <= 1e-6).length;
console.log('');
console.log(`both anchors exactly equal: ${equal} / ${all.length} (${((equal / all.length) * 100).toFixed(1)}%)`);
