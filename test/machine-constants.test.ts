/**
 * Checks the shipped dataset's machine constants against the game's own prefab data.
 *
 * This is adversarial verification of numbers that were originally transcribed from the
 * wiki: instead of trusting the transcription, every value is recomputed from
 * `docs/research/_raw/prefabs.json` (a cached export of the game's prefab definitions)
 * and compared. It is the strongest evidence available that the simulator's core
 * machine constants are the game's real ones.
 *
 * Two relations are asserted, both exactly:
 *
 *   workSpeed          == AssemblerDesc.speedf  (LabDesc.assembleSpeed for labs)
 *   powerConsumptionKW == PowerDesc.workEnergyPerTick * 60 / 1000
 *
 * The 60/1000 factor is the game's tick rate: energy is stored per tick and there are 60
 * ticks per second. Asserting the relation (rather than a literal per building) means a
 * future data update that changes a machine's speed is caught here.
 *
 * `powerIdleKW` is NOT asserted. The dataset's idle figures do not follow the same
 * factor and the wiki's assembled-machine page disagrees with the prefab, so idle power
 * remains unverified — see docs/SLOT-DATA-REVERSING.md.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import datasetJson from '../src/engine/data/dsp-vanilla.json';
import { loadDataset } from '../src/engine/loader.ts';

const data = loadDataset(datasetJson);

const prefabs = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../docs/research/_raw/prefabs.json'), 'utf8'),
) as {
  version?: string;
  prefabs: Record<
    string,
    {
      AssemblerDesc?: { speedf?: number; recipeType?: string };
      LabDesc?: { assembleSpeed?: number };
      PowerDesc?: { workEnergyPerTick?: number; idleEnergyPerTick?: number };
      BeltDesc?: { beltPrototype?: number; speed?: number };
    }
  >;
};

/** dataset key -> prefab short name. Not derivable one from the other, so explicit. */
const BUILDING_TO_PREFAB: Record<string, string> = {
  AssemblingMachineMk1: 'assembler-mk-1',
  AssemblingMachineMk2: 'assembler-mk-2',
  AssemblingMachineMk3: 'assembler-mk-3',
  RecomposingAssembler: 'assembler-mk-4',
  ArcSmelter: 'smelter',
  PlaneSmelter: 'smelter-2',
  NegentropySmelter: 'smelter-3',
  ChemicalPlant: 'chemical-plant',
  QuantumChemicalPlant: 'chemical-plant-2',
  OilRefinery: 'oil-refinery',
  MiniatureParticleCollider: 'hadron-collider',
  MatrixLab: 'lab',
  SelfEvolutionLab: 'lab-2',
};

/** prefab short name -> facts the game declares. */
function factsByShort(): Map<string, { speed?: number; speedField: string; work?: number; idle?: number; recipeType?: string }> {
  const map = new Map<string, { speed?: number; speedField: string; work?: number; idle?: number; recipeType?: string }>();
  for (const [key, value] of Object.entries(prefabs.prefabs)) {
    const assembler = value.AssemblerDesc?.speedf;
    const lab = value.LabDesc?.assembleSpeed;
    map.set(key.split('/').pop()!, {
      speed: assembler ?? lab,
      speedField: assembler != null ? 'AssemblerDesc.speedf' : lab != null ? 'LabDesc.assembleSpeed' : 'none',
      work: value.PowerDesc?.workEnergyPerTick,
      idle: value.PowerDesc?.idleEnergyPerTick,
      recipeType: value.AssemblerDesc?.recipeType,
    });
  }
  return map;
}

const TICKS_PER_SECOND = 60;

describe('machine constants vs the game prefab data', () => {
  it('maps every listed dataset key to an existing prefab and building', () => {
    const facts = factsByShort();
    for (const [buildingKey, short] of Object.entries(BUILDING_TO_PREFAB)) {
      expect(() => data.requireBuilding(buildingKey), `dataset key ${buildingKey}`).not.toThrow();
      expect(facts.has(short), `prefab ${short} for ${buildingKey}`).toBe(true);
    }
  });

  it('has the work-speed multiplier the game declares, for every machine', () => {
    const facts = factsByShort();
    const checked: string[] = [];
    for (const [buildingKey, short] of Object.entries(BUILDING_TO_PREFAB)) {
      const declared = facts.get(short)!.speed;
      if (declared == null) continue;
      const building = data.requireBuilding(buildingKey);
      expect(building.workSpeed, `${buildingKey} workSpeed`).not.toBeNull();
      expect(building.workSpeed, `${buildingKey} workSpeed vs ${short}`).toBeCloseTo(declared, 9);
      checked.push(buildingKey);
    }
    // Every machine in the map must actually have been checked, so a silently missing
    // prefab field cannot turn this test into a no-op.
    expect(checked.length).toBe(Object.keys(BUILDING_TO_PREFAB).length);
  });

  it('has the power draw the game declares, at 60 ticks per second', () => {
    const facts = factsByShort();
    const checked: string[] = [];
    for (const [buildingKey, short] of Object.entries(BUILDING_TO_PREFAB)) {
      const work = facts.get(short)!.work;
      if (work == null) continue;
      const building = data.requireBuilding(buildingKey);
      expect(building.powerConsumptionKW, `${buildingKey} powerConsumptionKW`).not.toBeNull();
      const derivedKW = (work * TICKS_PER_SECOND) / 1000;
      expect(building.powerConsumptionKW, `${buildingKey} power vs ${short}`).toBeCloseTo(derivedKW, 6);
      checked.push(buildingKey);
    }
    expect(checked.length).toBe(Object.keys(BUILDING_TO_PREFAB).length);
  });

  it('keeps the three labs and assemblers distinct from each other', () => {
    // Guards against a copy-paste that gives every machine the same speed, which the
    // per-building assertions above would still pass if the prefab data were wrong too.
    const speeds = ['AssemblingMachineMk1', 'AssemblingMachineMk2', 'AssemblingMachineMk3'].map(
      (k) => data.requireBuilding(k).workSpeed,
    );
    expect(speeds).toEqual([0.75, 1, 1.5]);
    expect(data.requireBuilding('MatrixLab').workSpeed).toBe(1);
    expect(data.requireBuilding('SelfEvolutionLab').workSpeed).toBe(3);
    expect(data.requireBuilding('MiniatureParticleCollider').powerConsumptionKW).toBe(12000);
  });

  it('records where the prefab data came from', () => {
    expect(prefabs.version).toBe('0.10.35.29104');
  });

  it('has the belt speed multipliers, item ids and tier ordering the game declares', () => {
    // `BeltDesc.speed` is a multiplier on the belt base rate, not an absolute rate: the
    // game declares 1 / 2 / 5 for the three tiers, which is what makes Mk.III 5x Mk.I.
    // The loader exposes the absolute rate, so the multiplier is recovered from it.
    const expectations: { short: string; itemId: number; multiplier: number; speedPerMin: number }[] = [
      { short: 'belt-1', itemId: 2001, multiplier: 1, speedPerMin: 360 },
      { short: 'belt-2', itemId: 2002, multiplier: 2, speedPerMin: 720 },
      { short: 'belt-3', itemId: 2003, multiplier: 5, speedPerMin: 1800 },
    ];
    const byId = new Map(data.belts.map((b) => [b.id, b]));

    let checked = 0;
    for (const want of expectations) {
      const entry = Object.entries(prefabs.prefabs).find(([k]) => k.endsWith(`/${want.short}`));
      expect(entry, `prefab ${want.short}`).toBeDefined();
      const beltDesc = entry![1].BeltDesc;
      expect(beltDesc?.beltPrototype, `${want.short} beltPrototype`).toBe(want.itemId);
      expect(beltDesc?.speed, `${want.short} BeltDesc.speed`).toBe(want.multiplier);

      const belt = byId.get(want.itemId);
      expect(belt, `dataset belt ${want.itemId}`).toBeDefined();
      expect(belt!.speedPerMin, `${want.short} dataset speedPerMin`).toBe(want.speedPerMin);
      checked++;
    }
    expect(checked).toBe(expectations.length);

    // The absolute rate is the base rate times the multiplier, and the tiers must be
    // strictly increasing or a "faster belt" would not actually be faster.
    const mk1 = byId.get(2001)!;
    expect(mk1.speedPerMin).toBe(360);
    const base = mk1.speedPerMin / 1;
    for (const want of expectations) {
      expect(byId.get(want.itemId)!.speedPerMin, `${want.short} rate = base x multiplier`).toBeCloseTo(
        base * want.multiplier,
        9,
      );
    }
    expect(byId.get(2002)!.speedPerMin).toBeGreaterThan(mk1.speedPerMin);
    expect(byId.get(2003)!.speedPerMin).toBeGreaterThan(byId.get(2002)!.speedPerMin);
  });
});
