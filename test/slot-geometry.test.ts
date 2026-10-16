/**
 * The sorter slot geometry recovered from the shipped Unity assets.
 *
 * `src/engine/data/building-slots.json` is produced by `tools/unity/build-slots-dataset.py` from
 * `SlotConfig` components in `DSPGAME_Data/resources.assets`. It matters because the wiki's
 * `insertPoses` / `slotPoses` arrays have the right lengths but every element is an empty object
 * — the game stores `Transform` references there, not `Vector3`, so an object-reference export
 * cannot carry them.
 *
 * These tests pin the properties the engine actually relies on:
 *   - the slot count agrees with the dataset's independent `sorterAttachSlots` figure;
 *   - the points are distinct, so a slot index is meaningful rather than decorative;
 *   - a disagreement between the two sources *throws* instead of being silently resolved.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadDataset } from '../src/engine/loader.ts';
import { decodeBlueprint } from '../src/engine/bp/codec.ts';
import { convertBlueprint } from '../src/engine/factory.ts';

const ROOT = resolve(__dirname, '..');
const datasetRaw = JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/dsp-vanilla.json'), 'utf8'));
const slotsRaw = JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/building-slots.json'), 'utf8'));

const load = () => loadDataset(structuredClone(datasetRaw), structuredClone(slotsRaw));

/** Raw slot entry for a building, including the rotations the engine does not carry. */
const rawEntry = (id: number): { slots: unknown[]; rotations: number[][] } => {
  const entry = (slotsRaw.buildings as Record<string, { slots: unknown[]; rotations: number[][] }>)[String(id)];
  if (!entry) throw new Error(`building-slots has no entry for id ${id}`);
  return entry;
};

describe('sorter slot geometry', () => {
  it('loads without the slot document, so the file stays optional', () => {
    const withoutSlots = loadDataset(structuredClone(datasetRaw));
    expect(withoutSlots.buildings.length).toBe(loadDataset(structuredClone(datasetRaw), structuredClone(slotsRaw)).buildings.length);
    // The count still comes from the dataset alone when no geometry was supplied.
    expect(withoutSlots.buildings.find((b) => b.key === 'AssemblingMachineMk1')?.sorterAttachSlots).toBe(12);
  });

  it('attaches slot poses to every building the document lists', () => {
    const data = load();
    const listed = Object.keys(slotsRaw.buildings).length;
    const withPoses = data.buildings.filter((b) => b.sorterSlotPoses?.length);
    expect(withPoses.length).toBe(listed);
  });

  it('agrees with the independent sorterAttachSlots count on every building that declares one', () => {
    const data = load();
    const checked: string[] = [];
    for (const b of data.buildings) {
      const declared = (datasetRaw.buildings as { key: string; sorterAttachSlots?: number }[]).find(
        (r) => r.key === b.key,
      )?.sorterAttachSlots;
      if (declared === undefined || !b.sorterSlotPoses) continue;
      expect(b.sorterSlotPoses.length, `${b.key} slot count`).toBe(declared);
      checked.push(b.key);
    }
    // The cross-check is only meaningful if it actually ran.
    expect(checked.length).toBe(21);
  });

  it('gives distinct (position, rotation) pairs, so a slot index addresses a real place', () => {
    // Position alone is NOT unique: ArcSmelter has 12 slots over only 8 positions, because each
    // of the four corners takes two sorters, one per adjoining side. Those two share a point and
    // differ by a 90-degree rotation, which is what makes the index meaningful.
    const data = load();
    for (const b of data.buildings) {
      if (!b.sorterSlotPoses) continue;
      const raw = rawEntry(b.id!);
      const seen = new Set<string>();
      b.sorterSlotPoses.forEach((p, i) => {
        const rot = (raw.rotations[i] ?? []).map((v) => v.toFixed(4)).join(',');
        const key = `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}|${rot}`;
        expect(seen.has(key), `${b.key} repeats slot (position, rotation) ${key}`).toBe(false);
        seen.add(key);
      });
    }
  });

  it('documents that a corner slot is shared by two differently-rotated entries', () => {
    const data = load();
    const smelter = data.buildings.find((b) => b.key === 'ArcSmelter')!;
    const raw = rawEntry(smelter.id!);
    const positions = new Set(smelter.sorterSlotPoses!.map((p) => `${p.x},${p.z}`));
    expect(smelter.sorterSlotPoses!.length).toBe(12);
    expect(positions.size).toBe(8);
    // The four sides, three slots each, quarter-turned from one another.
    expect(raw.rotations[0]).not.toEqual(raw.rotations[3]);
    expect(raw.rotations[3]).not.toEqual(raw.rotations[6]);
  });

  it('places every slot within the building footprint it belongs to', () => {
    // A slot outside the footprint would mean the coordinates are in a different frame than the
    // one the renderer uses, which is the failure mode worth catching.
    const data = load();
    for (const b of data.buildings) {
      if (!b.sorterSlotPoses || !b.footprint) continue;
      const halfW = b.footprint.w / 2;
      const halfH = b.footprint.h / 2;
      for (const p of b.sorterSlotPoses) {
        const dx = Math.max(0, Math.abs(p.x) - halfW);
        const dz = Math.max(0, Math.abs(p.z) - halfH);
        expect(Math.hypot(dx, dz), `${b.key} slot (${p.x}, ${p.z}) outside ${b.footprint.w}x${b.footprint.h}`).toBeLessThanOrEqual(0.75);
      }
    }
  });

  it('throws when the slot document contradicts the dataset count', () => {
    const broken = structuredClone(slotsRaw);
    broken.buildings['2305'].slots = broken.buildings['2305'].slots.slice(0, 5);
    expect(() => loadDataset(structuredClone(datasetRaw), broken)).toThrow(/has 5 slots but the dataset declares 12/);
  });

  it('throws when the slot document names a building the dataset does not have', () => {
    const broken = structuredClone(slotsRaw);
    broken.buildings['999999'] = { key: 'Nope', prefab: 'nope', source: 'insertPoses', slots: [{ x: 0, y: 0, z: 0 }], rotations: [] };
    expect(() => loadDataset(structuredClone(datasetRaw), broken)).toThrow(/id 999999, which the dataset does not define/);
  });

  it('keeps the splitter visual variants rather than dropping two of them', () => {
    // Three Unity prefabs back item 2020 and they genuinely differ; a blueprint only records the
    // item id, so the variants are recorded instead of one being picked silently.
    const splitter = slotsRaw.buildings['2020'];
    expect(splitter.variants.length).toBe(2);
    expect(splitter.slots).toEqual([{ x: 0, y: 0, z: 0.25 }, { x: 0.25, y: 0, z: 0 }, { x: 0, y: 0, z: -0.25 }, { x: -0.25, y: 0, z: 0 }]);
  });
});

describe('sorter slot validation', () => {
  const sample = () => decodeBlueprint(readFileSync(resolve(ROOT, 'public/samples/factory-v2.txt'), 'utf8').trim());
  const idOf = (key: string): number => {
    const found = load().buildings.find((b) => b.key === key);
    if (!found || found.id == null) throw new Error(`no building ${key}`);
    return found.id;
  };
  const slotWarnings = (model: { totals: { warnings?: string[] } }) =>
    (model.totals.warnings ?? []).filter((w) => /sorter slots/.test(w));

  it('stays silent on the real sample, whose sorters all record -1', async () => {
    // Pins that the check does not fire on the -1 sentinel: the sample set records -1 for every
    // sorter slot, so a warning here would be a false positive.
    expect(slotWarnings(convertBlueprint(load(), await sample()))).toEqual([]);
  });

  it('flags a slot index past the end of the building table', async () => {
    // Proves the check is live. RayReceiver has 2 slots and, before the geometry was recovered,
    // had no declared count at all — so the "2" in this message can only come from the extracted
    // table, not from the wiki-derived sorterAttachSlots.
    const bp = await sample();
    const sorter = bp.body.buildings.find((b) => b.itemId >= 2011 && b.itemId <= 2014)!;
    const receiver = bp.body.buildings.find((b) => b.itemId === idOf('RayReceiver'))!;
    sorter.outputObjectIndex = receiver.index;
    sorter.outputToSlot = 99;

    const hit = slotWarnings(convertBlueprint(load(), bp));
    expect(hit.length).toBe(1);
    expect(hit[0]).toMatch(/uses output slot 99 on Ray Receiver, which has 2 sorter slots/);
  });

  it('accepts the last valid index on the same building', async () => {
    const bp = await sample();
    const sorter = bp.body.buildings.find((b) => b.itemId >= 2011 && b.itemId <= 2014)!;
    const receiver = bp.body.buildings.find((b) => b.itemId === idOf('RayReceiver'))!;
    sorter.outputObjectIndex = receiver.index;
    sorter.outputToSlot = 1; // RayReceiver has 2 slots, so 1 is the last valid index

    expect(slotWarnings(convertBlueprint(load(), bp))).toEqual([]);
  });
});
