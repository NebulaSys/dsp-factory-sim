/**
 * Sorter attachment is recovered from geometry, not from the blueprint.
 *
 * The blueprint does not serialise the machine<->sorter attachment: measured across the whole
 * corpus, machine categories write zero `outputObjectIndex`/`inputObjectIndex` links — only sorters
 * (61%) and belts do, and those point at belts / a RayReceiver rather than at a neighbouring
 * building. The game therefore rebuilds the attachment from position when a blueprint is pasted,
 * and the engine now does the same.
 *
 * These tests pin the two things that makes easy to get wrong:
 *
 *  1. an "empty" arm end is only a *defect* when the blueprint does not stack buildings. A stacked
 *     build attaches vertically and the x/y plane cannot see it — reporting those as dangling
 *     produced 137 false alarms, every one of them in one stacked blueprint.
 *  2. the capacity figure is an upper bound on movement in BOTH directions. Which end of a sorter
 *     picks up is not recorded, so input capacity cannot be separated from output capacity, and a
 *     test that treated it as per-direction throughput would be asserting something untrue.
 *
 * Blueprints are built synthetically and pushed through the real encoder and decoder, so this
 * exercises the same path a loaded blueprint takes.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  decodeBlueprint,
  encodeBlueprint,
  type BlueprintBody,
  type BlueprintBuilding,
} from '../src/engine/bp/codec.ts';
import { convertBlueprint, type FactoryModel } from '../src/engine/factory.ts';
import { loadDataset } from '../src/engine/loader.ts';

const ROOT = resolve(__dirname, '..');
const data = loadDataset(
  JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/dsp-vanilla.json'), 'utf8')),
  JSON.parse(readFileSync(resolve(ROOT, 'src/engine/data/building-slots.json'), 'utf8')),
);

const id = (key: string): number => {
  const b = data.buildings.find((x) => x.key === key);
  if (!b || b.id === null) throw new Error(`no building ${key}`);
  return b.id;
};
const SMELTER = id('ArcSmelter');
const BELT = id('ConveyorBeltMk1');
const SORTER = id('SorterMk1');
const PILE = id('PileSorter');

let nextIndex = 0;
function rec(itemId: number, x: number, y: number, extra: Partial<BlueprintBuilding> = {}): BlueprintBuilding {
  const index = nextIndex++;
  return {
    index,
    itemId,
    modelIndex: 0,
    areaIndex: 0,
    x,
    y,
    z: 0,
    yaw: 0,
    x2: x,
    y2: y,
    z2: 0,
    yaw2: 0,
    outputObjectIndex: -1,
    inputObjectIndex: -1,
    outputToSlot: -1,
    inputFromSlot: -1,
    outputFromSlot: -1,
    inputToSlot: -1,
    outputOffset: 0,
    inputOffset: 0,
    recipeId: 0,
    filterId: 0,
    parameters: [],
    ...extra,
  } as unknown as BlueprintBuilding;
}

/** Encode -> decode -> convert, i.e. the same route a pasted blueprint takes. */
async function modelOf(buildings: BlueprintBuilding[]): Promise<FactoryModel> {
  nextIndex = 0;
  const body: BlueprintBody = {
    header: {
      version: 2,
      cursorOffsetX: 0,
      cursorOffsetY: 0,
      cursorTargetArea: 0,
      dragboxSizeX: 20,
      dragboxSizeY: 20,
      primaryAreaIndex: 0,
      areaCount: 1,
    },
    areas: [
      {
        index: 0,
        parentIndex: -1,
        tropicAnchor: 0,
        areaSegments: 200,
        anchorLocalOffsetX: 0,
        anchorLocalOffsetY: 0,
        width: 20,
        height: 20,
      },
    ],
    buildings,
    layout: 'path102',
    declaredBuildingCount: buildings.length,
  } as unknown as BlueprintBody;
  const text = await encodeBlueprint(body);
  return convertBlueprint(data, await decodeBlueprint(text));
}

const sorterNode = (m: FactoryModel, index: number) => m.nodes.find((n) => n.index === index && n.kind === 'sorter')!;

describe('geometric end classification', () => {
  it('names the machine and the belt at a sorter arm ends', async () => {
    // ArcSmelter is 3x3 at (10,10) -> spans 8.5..11.5. Belt at (13,10) spans 12.5..13.5.
    // A 1-cell sorter bridges the smelter edge at 11.5 to the belt edge at 12.5.
    const m = await modelOf([
      rec(SMELTER, 10, 10),
      rec(BELT, 13, 10),
      rec(SORTER, 11.5, 10, { x2: 12.5, y2: 10 }),
    ]);
    const s = sorterNode(m, 2);
    expect(s.armFrom).toBeDefined();
    expect(s.armFromKind).toBe('machine');
    expect(s.armToKind).toBe('belt');
  });

  it('reports a genuinely unattached end as empty and dangling', async () => {
    // Nothing at either end: in a blueprint with no stacking this is a real defect.
    const m = await modelOf([rec(SORTER, 20, 20, { x2: 21, y2: 20 })]);
    const s = sorterNode(m, 0);
    expect(s.armFromKind).toBe('empty');
    expect(s.armToKind).toBe('empty');
    expect(s.armEndUncertain).toBe(false);
    expect(m.totals.danglingSorters).toBe(1);
  });
});

describe('stacked blueprints are unresolved, not broken', () => {
  it('does not report a dangling sorter when the blueprint stacks buildings', async () => {
    // Same unattached sorter, but one unrelated building sits at z = 41. The attachment may be
    // vertical, so the empty end must be reported as unresolved rather than as a defect.
    // This is the exact shape that produced 137 false alarms in the corpus.
    const m = await modelOf([rec(SORTER, 20, 20, { x2: 21, y2: 20 }), rec(SMELTER, 40, 40, { z: 41 })]);
    expect(m.totals.danglingSorters).toBe(0);
    expect(m.totals.danglingSortersUncertain).toBe(1);
    expect(sorterNode(m, 0).armEndUncertain).toBe(true);
  });

  it('never reports a Pile Sorter as dangling', async () => {
    // The Pile Sorter is the stacking inserter: its horizontal end is legitimately empty, and in
    // the corpus every one of the 137 "dangling" reports was one of these.
    const m = await modelOf([rec(PILE, 20, 20, { x2: 21, y2: 20 })]);
    expect(sorterNode(m, 0).armEndUncertain).toBe(true);
    expect(m.totals.danglingSorters).toBe(0);
    expect(m.totals.danglingSortersUncertain).toBe(1);
  });
});

describe('machine service count and capacity ceiling', () => {
  it('counts the sorters attached to a machine and sums their capacity', async () => {
    // Smelter at (10,10) with two sorters on its left edge, each reaching a belt.
    const m = await modelOf([
      rec(SMELTER, 10, 10),
      rec(BELT, 6, 9),
      rec(BELT, 6, 11),
      rec(SORTER, 8.5, 9, { x2: 7.5, y2: 9 }),
      rec(SORTER, 8.5, 11, { x2: 7.5, y2: 11 }),
    ]);
    const smelter = m.nodes.find((n) => n.index === 0)!;
    expect(smelter.servedBySorters).toBe(2);
    // Sorter Mk.I carries 1.5 items/s = 90/min.
    expect(smelter.sorterCapacityPerMin).toBe(180);
    expect(m.totals.machinesWithSorter).toBe(1);
    expect(m.totals.machinesWithoutSorter).toBe(0);
  });

  it('attributes both ends when a sorter joins two machines', async () => {
    const m = await modelOf([
      rec(SMELTER, 10, 10), // spans 8.5..11.5
      rec(SMELTER, 15, 10), // spans 13.5..16.5
      // arm from the right edge of the first to the left edge of the second is 2 cells
      rec(SORTER, 11.5, 10, { x2: 13.5, y2: 10 }),
    ]);
    const s = sorterNode(m, 2);
    expect(s.armFromKind).toBe('machine');
    expect(s.armToKind).toBe('machine');
    expect(m.nodes.find((n) => n.index === 0)!.servedBySorters).toBe(1);
    expect(m.nodes.find((n) => n.index === 1)!.servedBySorters).toBe(1);
  });

  it('keeps the machine totals consistent', async () => {
    const m = await modelOf([
      rec(SMELTER, 10, 10),
      rec(SMELTER, 30, 30), // nothing attached
      rec(SORTER, 8.5, 10, { x2: 7.5, y2: 10 }),
      rec(BELT, 6, 10),
    ]);
    expect(m.totals.machinesWithSorter + m.totals.machinesWithoutSorter).toBe(m.totals.producers);
    expect(m.totals.machinesWithSorter).toBe(1);
    expect(m.totals.machinesWithoutSorter).toBe(1);
  });

  it('counts a sorter once per machine even when both ends land on it', async () => {
    // Both arms sit entirely inside the 3x3 smelter footprint, so both ends classify as 'machine'.
    // That is two ends but ONE sorter, and must not double-count.
    const m = await modelOf([rec(SMELTER, 10, 10), rec(SORTER, 9, 9, { x2: 11, y2: 9 }), rec(SORTER, 9, 11, { x2: 11, y2: 11 })]);
    const s = sorterNode(m, 1);
    expect(s.armFromKind).toBe('machine');
    expect(s.armToKind).toBe('machine');
    const smelter = m.nodes.find((n) => n.index === 0)!;
    expect(smelter.servedBySorters).toBe(2); // two sorters, not four ends
    expect(smelter.sorterCapacityPerMin).toBe(180); // 2 x 90
  });

  it('compares capacity against the recipe flow and flags a genuinely starved machine', async () => {
    const recipe = data.recipes.find((r) => r.key === 'TitaniumAlloy')!;
    const m = await modelOf([
      rec(SMELTER, 10, 10, { recipeId: recipe.id as number }),
      rec(BELT, 6, 10),
      rec(SORTER, 8.5, 10, { x2: 7.5, y2: 10 }), // exactly one Sorter Mk.I: 90/min
    ]);
    const smelter = m.nodes.find((n) => n.index === 0)!;

    // The requirement is the machine's own input+output flow, so check it against the rate result
    // rather than a number copied out of the engine.
    const rate = smelter.production!;
    const expected =
      rate.inputsPerMin.reduce((s, r) => s + r.count, 0) + rate.outputsPerMin.reduce((s, r) => s + r.count, 0);
    expect(smelter.requiredFlowPerMin).toBeCloseTo(expected, 6);
    // One Arc Smelter on Titanium Alloy needs more than one Mk.I sorter can carry (90/min), so this
    // machine is starved — exactly the case the diagnostic exists to name.
    expect(smelter.sorterCapacityPerMin).toBe(90);
    expect(smelter.requiredFlowPerMin!).toBeGreaterThan(90);
    expect(smelter.sorterStarved).toBe(true);
    expect(m.totals.sorterStarvedMachines).toBe(1);
  });

  it('does not flag a machine whose sorters comfortably exceed the flow', async () => {
    const recipe = data.recipes.find((r) => r.key === 'TitaniumAlloy')!;
    // Six Sorter Mk.I = 540/min against a ~100/min requirement. They must stand on DISTINCT cells:
    // two sorters sharing a cell classify each other rather than the machine.
    const buildings: BlueprintBuilding[] = [rec(SMELTER, 10, 10, { recipeId: recipe.id ?? 0 })];
    for (const y of [9, 10, 11]) {
      buildings.push(rec(BELT, 7, y), rec(SORTER, 8.5, y, { x2: 7.5, y2: y }));
      buildings.push(rec(BELT, 13, y), rec(SORTER, 11.5, y, { x2: 12.5, y2: y }));
    }
    const m = await modelOf(buildings);
    const smelter = m.nodes.find((n) => n.index === 0)!;
    expect(smelter.servedBySorters).toBe(6);
    expect(smelter.sorterCapacityPerMin).toBe(540);
    expect(smelter.sorterStarved).toBe(false);
    expect(m.totals.sorterStarvedMachines).toBe(0);
  });
});
