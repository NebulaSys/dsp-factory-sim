/**
 * Shows which colour each belt/sorter mark would be drawn in, and where that colour comes
 * from.
 *
 * The glyph colour is the `accent` sampled from the building's own wiki icon, falling back to
 * the flat category colour when a mark has no icon or no resolved `buildingKey`. A blueprint
 * where every conveyor is Mk.I therefore looks uniform even when the per-mark colours work, so
 * this reports the resolved colour per mark instead of leaving it to a screenshot.
 *
 *   node --experimental-strip-types tools/check-tier-colours.ts [sample]
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { requireCorpus } from './lib/corpus.ts';
import { decodeBlueprint } from '../src/engine/bp/codec.ts';
import { convertBlueprint } from '../src/engine/factory.ts';
import { loadDataset } from '../src/engine/loader.ts';
import { glyphColour, liftForDarkCanvas } from '../src/ui/glyphs.ts';

const ROOT = resolve(import.meta.dirname, '..');

const CATEGORY: Record<string, string> = { belt: '#546e7a', sorter: '#8d6e63' };

const data = loadDataset(JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/dsp-vanilla.json'), 'utf8')));
const icons = (
  JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/building-icons.json'), 'utf8')) as {
    icons: Record<string, { palette: { accent: string } | null }>;
  }
).icons;

/** Tally every belt/sorter mark across the whole cached corpus. */
async function corpusTally(): Promise<void> {
  const dir = resolve(ROOT, 'docs/research/_raw/realbp');
  const { readdirSync } = await import('node:fs');
  const counts = new Map<number, number>();
  let files = 0;
  for (const file of requireCorpus('realbp', 'tier colour sampling')) {
    const raw = readFileSync(resolve(dir, file), 'utf8');
    let model;
    try {
      model = convertBlueprint(data, await decodeBlueprint(raw.trim()), {});
    } catch {
      continue;
    }
    if (model.nodes.length === 0) continue;
    files++;
    for (const node of model.nodes) {
      if (node.kind !== 'belt' && node.kind !== 'sorter') continue;
      counts.set(node.itemId, (counts.get(node.itemId) ?? 0) + 1);
    }
  }
  console.log(`corpus files decoded: ${files}\n`);
  console.log('itemId  name                 category  icon accent   drawn colour  count');
  for (const [itemId, count] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
    const def = data.buildings.find((b) => b.id === itemId);
    const kind = def?.category === 'belt' ? 'belt' : 'sorter';
    const accent = def?.key ? (icons[def.key]?.palette?.accent ?? null) : null;
    const drawn = glyphColour(accent, CATEGORY[kind] ?? '#455a64');
    console.log(
      `${String(itemId).padStart(6)}  ${(def?.key ?? '?').padEnd(20)} ${kind.padEnd(9)} ` +
        `${String(accent ?? '(none)').padEnd(12)} ${drawn.main.padEnd(13)} ${count}`,
    );
  }
}

const sample = process.argv[2] ?? 'factory-v2.txt';

/**
 * Scans the legibility lift's parameters.
 *
 * The lift is a compromise: it must raise lightness so thin strokes read on the dark canvas,
 * while never pulling two marks closer together than their source accents were. Rather than
 * picking the gains by eye, this reports which pairs any candidate setting distorts and by how
 * much, so the choice is made on measurements.
 */
if (sample === '--tune') {
  const accents: [string, string][] = [
    ['belt Mk.I', '#daad7c'],
    ['belt Mk.II', '#68bbab'],
    ['belt Mk.III', '#73b0d9'],
    ['sorter Mk.I', '#978973'],
    ['sorter Mk.II', '#598b8c'],
    ['sorter Mk.III', '#608aaa'],
    ['pile sorter', '#8398a6'],
  ];
  const rgb = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const dist = (a: string, b: string): number => {
    const [x, y] = [rgb(a), rgb(b)];
    return Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!);
  };
  console.log('gainSat gainL  worst shrink  minSep  meanLum  verdict');
  for (const gainSat of [1.0, 1.2, 1.4, 1.5, 1.6, 1.7, 2.0]) {
    for (const gainL of [0.06, 0.09, 0.11, 0.13, 0.16]) {
      let worstShrink = 0;
      let worstPair = '';
      let minSep = Infinity;
      let lum = 0;
      const drawn = accents.map(([label, hex]) => {
        const out = liftForDarkCanvas(hex, gainSat, gainL);
        lum += (rgb(out)[0]! + rgb(out)[1]! + rgb(out)[2]!) / 3;
        return [label, out] as const;
      });
      for (let i = 0; i < drawn.length; i++) {
        for (let j = i + 1; j < drawn.length; j++) {
          const before = dist(accents[i]![1], accents[j]![1]);
          const after = dist(drawn[i]![1], drawn[j]![1]);
          const shrink = before - after;
          if (shrink > worstShrink) {
            worstShrink = shrink;
            worstPair = `${drawn[i]![0]}/${drawn[j]![0]}`;
          }
          minSep = Math.min(minSep, after);
        }
      }
      const ok = worstShrink <= 0.5 ? 'ok' : `shrink ${worstPair}`;
      console.log(
        `${gainSat.toFixed(1).padStart(6)} ${gainL.toFixed(2).padStart(5)} ` +
          `${worstShrink.toFixed(2).padStart(12)} ${minSep.toFixed(1).padStart(7)} ` +
          `${(lum / drawn.length).toFixed(1).padStart(8)}  ${ok}`,
      );
    }
  }
  process.exit(0);
}

if (sample === '--corpus') {
  await corpusTally();
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(resolve(ROOT, 'public/samples/manifest.json'), 'utf8')) as {
  name: string;
  note: string;
}[];
const entry = manifest.find((m) => m.name === sample) ?? manifest[0]!;
const text = readFileSync(resolve(ROOT, 'public/samples', entry.name), 'utf8').trim();

const decoded = await decodeBlueprint(text);
const model = convertBlueprint(data, decoded, {});

console.log(`sample: ${entry.name}  (${entry.note})`);
console.log(`buildings: ${model.nodes.length}\n`);

const seen = new Map<string, { itemId: number; buildingKey: string | null; buildingName: string; count: number }>();
for (const node of model.nodes) {
  if (node.kind !== 'belt' && node.kind !== 'sorter') continue;
  const key = `${node.kind}:${node.itemId}`;
  const hit = seen.get(key);
  if (hit) hit.count++;
  else seen.set(key, { itemId: node.itemId, buildingKey: node.buildingKey, buildingName: node.buildingName, count: 1 });
}

console.log('kind     itemId  name                buildingKey         icon accent   drawn colour  count');
for (const [key, row] of [...seen.entries()].sort((a, b) => b[1].count - a[1].count)) {
  const kind = key.split(':')[0]!;
  const accent = row.buildingKey ? (icons[row.buildingKey]?.palette?.accent ?? null) : null;
  const drawn = glyphColour(accent, CATEGORY[kind] ?? '#455a64');
  console.log(
    `${kind.padEnd(8)} ${String(row.itemId).padStart(6)}  ${row.buildingName.padEnd(18)} ` +
      `${String(row.buildingKey ?? '(none)').padEnd(19)} ${String(accent ?? '(none)').padEnd(12)} ` +
      `${drawn.main.padEnd(13)} ${row.count}`,
  );
}

const missing = [...seen.values()].filter((r) => !r.buildingKey);
if (missing.length > 0) {
  console.log(`\nWARNING: ${missing.length} mark(s) resolved no buildingKey, so they fall back to the flat category colour:`);
  for (const m of missing) console.log(`  itemId ${m.itemId}`);
}
