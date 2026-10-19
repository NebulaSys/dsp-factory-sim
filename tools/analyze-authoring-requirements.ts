/**
 * What would it take to SYNTHESISE a blueprint, rather than only decode one?
 *
 * The encoder already reproduces the game's own export byte for byte, but that is a different
 * problem: a real blueprint hands us every field to copy. An editor has to invent them. This
 * measures, over the whole corpus, which fields are effectively constants (safe to hardcode),
 * which are derivable from geometry (safe to compute), and which follow a rule we do not
 * actually know yet.
 *
 * That split is what decides how much reverse engineering the authoring feature really needs.
 *
 *   node --experimental-strip-types tools/analyze-authoring-requirements.ts
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeBlueprint } from '../src/engine/bp/codec.ts';
import { loadDataset } from '../src/engine/loader.ts';

const ROOT = resolve(import.meta.dirname, '..');
const data = loadDataset(
  JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/dsp-vanilla.json'), 'utf8')),
  JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/building-slots.json'), 'utf8')),
);
const footprintOf = new Map(data.buildings.map((b) => [b.id, b.footprint]));

const DIRS = ['docs/research/_raw/realbp', 'docs/research/_raw/realbp2'];

interface Tally {
  files: number;
  buildings: number;
  areas: number;
  /** values seen for a field, most common first */
  counts: Map<string, number>;
}
const tally = (): Tally => ({ files: 0, buildings: 0, areas: 0, counts: new Map() });
const bump = (m: Map<string, number>, k: string | number | boolean | null | undefined): void => {
  const key = String(k);
  m.set(key, (m.get(key) ?? 0) + 1);
};

const modelIndex = tally();
const trailer = tally();
const tropicAnchor = tally();
const areaSegments = tally();
const parentIndex = tally();
const primaryArea = tally();
const cursorTarget = tally();

/** Are building `index` values exactly 0..n-1? */
const indexShape = tally();
/** Do the link fields reference in-range indices? */
const linkShape = tally();
/** Does area width/height equal the bounding box of its buildings? */
const areaBox = tally();
/** area width/height vs the <repo> header dragbox */
const dragbox = tally();
/** Which area do buildings actually live in — how many areas are non-empty? */
const usedAreas = tally();

for (const dir of DIRS) {
  let files: string[] = [];
  try {
    files = readdirSync(resolve(ROOT, dir)).filter((f) => f.endsWith('.txt'));
  } catch {
    continue;
  }
  for (const f of files) {
    let bp;
    try {
      bp = await decodeBlueprint(readFileSync(resolve(ROOT, dir, f), 'utf8').trim());
    } catch {
      continue;
    }
    const b = bp.body;
    modelIndex.files++;
    modelIndex.buildings += b.buildings.length;
    modelIndex.areas += b.areas.length;

    // --- per-building constants -------------------------------------------------
    // The optional trailing string is NOT decoded: `trailer` is its 4-byte length prefix, so a
    // trailer of 0 means the string is absent. That is the honest measurement — asserting the
    // string is "empty" would overstate what the codec actually reads.
    for (const x of b.buildings) {
      bump(modelIndex.counts, x.modelIndex);
      bump(trailer.counts, x.trailer ?? 0);
    }

    // --- index shape -------------------------------------------------------------
    const sequential = b.buildings.every((x, i) => x.index === i);
    bump(indexShape.counts, sequential ? 'index == array position' : 'NOT sequential');

    // --- link validity -----------------------------------------------------------
    const n = b.buildings.length;
    let linksOk = 0;
    let linksBad = 0;
    let linksNone = 0;
    for (const x of b.buildings) {
      for (const v of [x.outputObjectIndex, x.inputObjectIndex]) {
        if (v === -1) linksNone++;
        else if (v >= 0 && v < n) linksOk++;
        else linksBad++;
      }
    }
    bump(linkShape.counts, linksBad === 0 ? `all links in range (${linksOk} used, ${linksNone} -1)` : `${linksBad} out-of-range links`);

    // --- per-area fields ---------------------------------------------------------
    for (const a of b.areas) {
      bump(tropicAnchor.counts, a.tropicAnchor);
      bump(areaSegments.counts, a.areaSegments);
      bump(parentIndex.counts, a.parentIndex);
    }
    bump(primaryArea.counts, b.header.primaryAreaIndex);
    bump(cursorTarget.counts, b.header.cursorTargetArea);

    // --- is the area box derivable from its buildings? ---------------------------
    for (const a of b.areas) {
      const inArea = b.buildings.filter((x) => x.areaIndex === a.index);
      if (inArea.length === 0) {
        bump(areaBox.counts, 'empty area');
        continue;
      }
      // Building footprint half-extents: the record x/y is the centre.
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const x of inArea) {
        const fp = footprintOf.get(x.itemId);
        const hw = (fp?.w ?? 1) / 2;
        const hh = (fp?.h ?? 1) / 2;
        minX = Math.min(minX, x.x - hw);
        maxX = Math.max(maxX, x.x + hw);
        minY = Math.min(minY, x.y - hh);
        maxY = Math.max(maxY, x.y + hh);
      }
      const w = Math.round(maxX - minX);
      const h = Math.round(maxY - minY);
      const ox = Math.round(minX - a.anchorLocalOffsetX);
      const oy = Math.round(minY - a.anchorLocalOffsetY);
      bump(areaBox.counts, `w ${a.width === w ? '=' : '!='} bbox(${w}), h ${a.height === h ? '=' : '!='} bbox(${h})`);
      void ox;
      void oy;
    }
    usedAreas.files++;
    bump(usedAreas.counts, `declared ${b.areas.length}, used ${new Set(b.buildings.map((x) => x.areaIndex)).size}`);

    // --- header dragbox vs union of area boxes -----------------------------------
    const anyArea = b.areas[0];
    if (anyArea) {
      bump(
        dragbox.counts,
        `dragbox ${b.header.dragboxSizeX}x${b.header.dragboxSizeY} vs area0 ${anyArea.width}x${anyArea.height}`,
      );
    }
  }
}

function report(title: string, t: Tally, note: string, limit = 6): void {
  const total = [...t.counts.values()].reduce((a, b) => a + b, 0);
  console.log(`\n=== ${title} ===`);
  console.log(`  ${note}`);
  const rows = [...t.counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  for (const [k, v] of rows) {
    console.log(`    ${String(v).padStart(6)}  ${((v / total) * 100).toFixed(1).padStart(5)}%  ${k}`);
  }
  if (t.counts.size > limit) console.log(`    ... ${t.counts.size - limit} more distinct values`);
}

console.log(`corpus: ${modelIndex.files} files, ${modelIndex.buildings} buildings, ${modelIndex.areas} area records`);

report('modelIndex  (we decode it, never interpreted it)', modelIndex, 'constant would be trivially synthesised');
report('record trailer (length prefix of the optional trailing string)', trailer, 'a 0 prefix means the string is absent — the codec does not decode the string itself');
report('TOTAL  (tropicAnchor)', tropicAnchor, 'per-area');
report('areaSegments', areaSegments, 'per-area — looks like the arc segmentation of the planet');
report('parentIndex', parentIndex, 'per-area');
report('header.primaryAreaIndex', primaryArea, '');
report('header.cursorTargetArea', cursorTarget, '');
report('building index shape', indexShape, 'must a synthesised blueprint renumber?');
report('link field validity', linkShape, 'outputObjectIndex / inputObjectIndex');
report('area width/height vs building bounding box', areaBox, 'is the box derivable from geometry?');
report('header dragboxSize vs area0 size', dragbox, '');
report('how many areas are actually used', usedAreas, '');
