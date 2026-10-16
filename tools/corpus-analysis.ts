/**
 * Physical-consistency analysis across every decodable real blueprint.
 *
 * With 33k+ buildings decoded, the corpus can answer questions that a single blueprint
 * cannot. This checks invariants the simulator relies on and reports violations, which
 * is the strongest available evidence that the decoded coordinates are the game's real
 * ones rather than plausible-looking numbers.
 *
 * Checks:
 *  - coordinate grid: are positions on a 1.0 lattice (the simulator assumes 1 cell = 1
 *    world unit)? Many of these blueprints are vertical stacks, where the third
 *    coordinate is the layer height rather than depth.
 *  - overlaps: do two buildings share the same (x, y, z) cell? The earlier version of
 *    this check keyed on (x, y, areaIndex) and reported thousands of "overlaps" that
 *    were really the stacked layers of a tower, so the key now includes the height.
 *  - references: does every `outputObjectIndex` / `inputObjectIndex` resolve to a
 *    building in the same blueprint?
 *  - sorter endpoints: do sorters connect two distinct cells?
 *  - areaIndex bounds: does every area index exist?
 *
 *   node --experimental-strip-types tools/corpus-analysis.ts
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { requireCorpus } from './lib/corpus.ts';
import { base64ToBytes, decodeBody, type BlueprintBuilding } from '../src/engine/bp/codec.ts';
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

interface Report {
  file: string;
  version: number;
  buildings: number;
  offGrid: number;
  duplicateCells: number;
  /** Buildings sharing an (x, y) footprint at different heights: a vertical stack. */
  stackedLayers: number;
  danglingRefs: number;
  sorterSameCell: number;
  badArea: number;
  /** Distinct fractional parts seen, to characterise the lattice. */
  lattice: string;
  belts: number;
  sorters: number;
}
const reports: Report[] = [];

for (const file of requireCorpus('realbp', 'corpus consistency').sort()) {
  let raw: Uint8Array;
  try {
    raw = await payloadOf(file);
  } catch {
    continue;
  }
  let parsed;
  try {
    parsed = decodeBody(raw);
  } catch {
    continue;
  }
  if (parsed.buildings.length === 0) continue;

  const buildings: BlueprintBuilding[] = parsed.buildings;
  const byIndex = new Map(buildings.map((b) => [b.index, b]));
  const areaCount = parsed.areas.length;

  // Lattice check: a 1-cell grid means positions are whole numbers.
  let offGrid = 0;
  const fracs = new Set<string>();
  for (const b of buildings) {
    const fx = b.x - Math.round(b.x);
    const fy = b.y - Math.round(b.y);
    if (Math.abs(fx) > 1e-3 || Math.abs(fy) > 1e-3) offGrid++;
    if (Math.abs(fx) > 1e-3) fracs.add(fx.toFixed(3));
    if (Math.abs(fy) > 1e-3) fracs.add(fy.toFixed(3));
  }

  // Overlap check on the full rounded cell, height included: these blueprints stack
  // buildings vertically, so two buildings at one (x, y) are only an overlap when their
  // heights match too.
  const cells = new Map<string, number>();
  let stackedLayers = 0;
  const byFootprint = new Map<string, number>();
  for (const b of buildings) {
    const key = `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.z)}`;
    cells.set(key, (cells.get(key) ?? 0) + 1);
    const xy = `${Math.round(b.x)},${Math.round(b.y)}`;
    byFootprint.set(xy, (byFootprint.get(xy) ?? 0) + 1);
  }
  let duplicateCells = 0;
  for (const n of cells.values()) if (n > 1) duplicateCells += n - 1;
  for (const n of byFootprint.values()) if (n > 1) stackedLayers += n - 1;

  // Reference integrity.
  let danglingRefs = 0;
  for (const b of buildings) {
    for (const ref of [b.outputObjectIndex, b.inputObjectIndex]) {
      if (ref === -1) continue;
      if (!byIndex.has(ref)) danglingRefs++;
    }
  }

  // Sorter endpoints must be two different cells.
  let sorterSameCell = 0;
  let sorters = 0;
  let belts = 0;
  for (const b of buildings) {
    if (b.itemId > 2000 && b.itemId < 2010) belts++;
    if (!(b.itemId > 2010 && b.itemId < 2020)) continue;
    sorters++;
    const from = b.outputObjectIndex >= 0 ? byIndex.get(b.outputObjectIndex) : undefined;
    const to = b.inputObjectIndex >= 0 ? byIndex.get(b.inputObjectIndex) : undefined;
    if (from && to) {
      const same = Math.abs(from.x - to.x) < 1e-3 && Math.abs(from.y - to.y) < 1e-3;
      if (same) sorterSameCell++;
    }
  }

  let badArea = 0;
  for (const b of buildings) if (b.areaIndex < 0 || b.areaIndex >= areaCount) badArea++;

  reports.push({
    file,
    version: raw[0] ?? -1,
    buildings: buildings.length,
    offGrid,
    duplicateCells,
    stackedLayers,
    danglingRefs,
    sorterSameCell,
    badArea,
    lattice: fracs.size === 0 ? 'exact integers' : [...fracs].slice(0, 4).join(', '),
    belts,
    sorters,
  });
}

const total = reports.reduce((a, r) => a + r.buildings, 0);
console.log(`decoded blueprints: ${reports.length}   buildings: ${total}\n`);
console.log('file                                    v  bldgs  offGrid  dupCell  stacked  dangling  sorterSame  badArea  belts  sorters  lattice');
for (const r of reports.sort((a, b) => b.buildings - a.buildings)) {
  console.log(
    `${r.file.slice(0, 38).padEnd(40)} ${r.version} ${String(r.buildings).padStart(6)} ` +
      `${String(r.offGrid).padStart(8)} ${String(r.duplicateCells).padStart(8)} ${String(r.stackedLayers).padStart(8)} ` +
      `${String(r.danglingRefs).padStart(9)} ` +
      `${String(r.sorterSameCell).padStart(11)} ${String(r.badArea).padStart(8)} ${String(r.belts).padStart(6)} ` +
      `${String(r.sorters).padStart(8)}  ${r.lattice}`,
  );
}

const sum = (pick: (r: Report) => number): number => reports.reduce((a, r) => a + pick(r), 0);
console.log(`\ntotals: offGrid=${sum((r) => r.offGrid)} duplicateCells=${sum((r) => r.duplicateCells)} ` +
  `stackedLayers=${sum((r) => r.stackedLayers)} danglingRefs=${sum((r) => r.danglingRefs)} ` +
  `sorterSameCell=${sum((r) => r.sorterSameCell)} ` +
  `badArea=${sum((r) => r.badArea)} belts=${sum((r) => r.belts)} sorters=${sum((r) => r.sorters)}`);

const clean = reports.every((r) => r.danglingRefs === 0 && r.badArea === 0);
console.log(
  clean
    ? '\nreference integrity and area bounds hold on every decoded blueprint'
    : '\nINTEGRITY PROBLEM: see the non-zero dangling/badArea columns',
);
