import { describe, expect, it } from 'vitest';
import { GameData } from '../src/engine/registry.ts';
import { buildPlan, chooseRecipe, powerReport } from '../src/engine/planner.ts';
import { fixtureDataset } from './fixtures/dataset.ts';

const data = new GameData(fixtureDataset());

describe('recipe selection', () => {
  it('picks the default recipe for an item', () => {
    expect(chooseRecipe(data, 'IronIngot')?.key).toBe('IronIngot');
    expect(chooseRecipe(data, 'MagneticCoil')?.key).toBe('MagneticCoil');
  });

  it('returns null for items nothing produces', () => {
    expect(chooseRecipe(data, 'IronOre')).toBe(null);
  });

  it('honours an explicit override', () => {
    expect(chooseRecipe(data, 'IronIngot', { recipeOverrides: { IronIngot: 'Magnet' } })?.key).toBe('Magnet');
  });
});

describe('production plan: electromagnetic matrix', () => {
  // Target: 15 blue matrices/min. The Matrix Lab runs at 1.0x with a 3 s craft,
  // so one lab makes 20/min and 15/min needs 0.75 of a lab.
  const plan = buildPlan(data, { target: 'ElectromagneticMatrix', targetPerMin: 15 });

  it('computes the top level recipe, building and machine count', () => {
    expect(plan.root.recipeKey).toBe('ElectromagneticMatrix');
    expect(plan.root.buildingKey).toBe('MatrixLab');
    expect(plan.root.machines).toBeCloseTo(0.75, 6);
    expect(plan.root.machinesCeil).toBe(1);
    expect(plan.root.requiredPerMin).toBe(15);
    expect(plan.root.inputsPerMin).toEqual([
      { item: 'MagneticCoil', count: 15 },
      { item: 'CircuitBoard', count: 15 },
    ]);
  });

  it('walks down to coils, circuits and finally ore', () => {
    const byRecipe = new Map(plan.nodes.map((n) => [n.recipeKey, n]));
    const coil = byRecipe.get('MagneticCoil')!;
    expect(coil.requiredPerMin).toBeCloseTo(15, 6);
    // MagneticCoil makes 2 per craft at 45 crafts/min = 90/min per Mk.I machine.
    expect(coil.machines).toBeCloseTo(15 / 90, 6);
    expect(coil.machinesCeil).toBe(1);

    const circuit = byRecipe.get('CircuitBoard')!;
    expect(circuit.requiredPerMin).toBeCloseTo(15, 6);
    expect(circuit.machines).toBeCloseTo(15 / 90, 6);

    // 15 circuits/min => 7.5 crafts/min * 2 iron ingots = 15 ingots/min
    const iron = byRecipe.get('IronIngot')!;
    expect(iron.requiredPerMin).toBeCloseTo(15, 6);
    expect(iron.machines).toBeCloseTo(0.25, 6);

    // 15 coils/min = 7.5 crafts/min * 2 magnets = 15 magnets/min -> 0.375 smelter
    const magnet = byRecipe.get('Magnet')!;
    expect(magnet.requiredPerMin).toBeCloseTo(15, 6);
    expect(magnet.machines).toBeCloseTo(15 / 40, 6);
  });

  it('reports raw ore consumption', () => {
    const raw = new Map(plan.rawResources.map((r) => [r.item, r.perMin]));
    // Iron: 15/min for the ingots (15 circuits) + 15/min for the magnets = 30/min
    expect(raw.get('IronOre')).toBeCloseTo(30, 6);
    // Copper: coils need 7.5 crafts/min * 1 = 7.5, circuits need 7.5 -> 15/min
    expect(raw.get('CopperOre')).toBeCloseTo(15, 6);
  });

  it('totals power over the true (fractional) machine demand', () => {
    // 480*0.75 + 270*(1/6 + 1/6) + 360*(0.375 + 0.25 + 0.25) = 765 kW
    expect(plan.totalPowerKW).toBeCloseTo(765, 4);
    // Whole buildings required: lab 1, assemblers 2, smelters 3
    expect(plan.totalMachines).toBe(6);
  });

  it('lists buildings for the shopping list', () => {
    const list = new Map(plan.buildingList.map((b) => [b.buildingKey, b.count]));
    expect(list.get('MatrixLab')).toBe(1);
    expect(list.get('AssemblingMachineMk1')).toBe(2);
    expect(list.get('ArcSmelter')).toBe(3);
  });

  it('reports per-recipe totals', () => {
    const totals = new Map(plan.recipeTotals.map((r) => [r.recipeKey, r]));
    expect(totals.get('ElectromagneticMatrix')!.machinesCeil).toBe(1);
    expect(totals.get('MagneticCoil')!.machines).toBeCloseTo(1 / 6, 6);
    expect(totals.get('Magnet')!.machines).toBeCloseTo(0.375, 6);
  });

  it('keeps a balance where supply covers demand for every intermediate', () => {
    for (const row of plan.balance) {
      if (row.demandedPerMin > 0 && row.suppliedPerMin > 0) {
        expect(row.suppliedPerMin + 1e-6).toBeGreaterThanOrEqual(row.demandedPerMin);
      }
    }
  });
});

describe('production plan options', () => {
  it('scales with the target rate (machine rounding keeps totals consistent)', () => {
    const a = buildPlan(data, { target: 'ElectromagneticMatrix', targetPerMin: 15 });
    const b = buildPlan(data, { target: 'ElectromagneticMatrix', targetPerMin: 150 });
    // Rates scale exactly even though machine counts are rounded up.
    const aRaw = new Map(a.rawResources.map((r) => [r.item, r.perMin]));
    const bRaw = new Map(b.rawResources.map((r) => [r.item, r.perMin]));
    expect(bRaw.get('IronOre')!).toBeCloseTo(aRaw.get('IronOre')! * 10, 4);
    expect(bRaw.get('CopperOre')!).toBeCloseTo(aRaw.get('CopperOre')! * 10, 4);
    expect(b.totalPowerKW).toBeCloseTo(a.totalPowerKW * 10, 4);
    // Rounding up whole machines means bigger plans are at least as efficient.
    expect(b.totalMachines / b.targetPerMin).toBeLessThanOrEqual(a.totalMachines / a.targetPerMin + 1e-9);
  });

  it('applies a proliferator to every machine in the plan', () => {
    const plain = buildPlan(data, { target: 'ElectromagneticMatrix', targetPerMin: 15 });
    const sprayed = buildPlan(data, {
      target: 'ElectromagneticMatrix',
      targetPerMin: 15,
      proliferator: { markKey: 'Proliferator3', mode: 'extraProducts' },
    });
    expect(sprayed.spraysPerMin).toBeGreaterThan(0);
    // Extra products means fewer machines for the same output.
    expect(sprayed.totalMachines).toBeLessThanOrEqual(plain.totalMachines);
    // And a higher power draw per machine (energy penalty).
    const plainRoot = plain.nodes.find((n) => n.recipeKey === 'ElectromagneticMatrix')!;
    const sprayedRoot = sprayed.nodes.find((n) => n.recipeKey === 'ElectromagneticMatrix')!;
    expect(sprayedRoot.powerKW!).toBeGreaterThan(plainRoot.powerKW!);
  });

  it('treats requested items as raw when asked', () => {
    const plan = buildPlan(data, { target: 'Gear', targetPerMin: 45, rawItems: ['IronIngot'] });
    expect(plan.nodes.some((n) => n.recipeKey === 'IronIngot')).toBe(false);
    expect(plan.rawResources.some((r) => r.item === 'IronIngot')).toBe(true);
  });

  it('handles a target with no recipe without crashing', () => {
    const plan = buildPlan(data, { target: 'IronOre', targetPerMin: 120 });
    expect(plan.root.kind).toBe('raw');
    expect(plan.rawResources).toEqual([{ item: 'IronOre', perMin: 120 }]);
    expect(plan.warnings.length).toBeGreaterThan(0);
  });

  it('cuts dependency cycles instead of recursing forever', () => {
    const ds = fixtureDataset();
    // A -> B -> A cycle
    ds.items.push(
      { id: 7001, key: 'CycleA', name: 'Cycle A', category: 'component', stackSize: 100, isRaw: false, isFluid: false },
      { id: 7002, key: 'CycleB', name: 'Cycle B', category: 'component', stackSize: 100, isRaw: false, isFluid: false },
    );
    ds.recipes.push(
      {
        id: 9001,
        key: 'CycleARecipe',
        outputs: [{ item: 'CycleA', count: 1 }],
        inputs: [{ item: 'CycleB', count: 1 }],
        craftTime: 1,
        facility: 'AssemblingMachineMk1',
        proliferatorBoost: true,
        proliferatorOutput: true,
        isDefault: true,
      },
      {
        id: 9002,
        key: 'CycleBRecipe',
        outputs: [{ item: 'CycleB', count: 1 }],
        inputs: [{ item: 'CycleA', count: 1 }],
        craftTime: 1,
        facility: 'AssemblingMachineMk1',
        proliferatorBoost: true,
        proliferatorOutput: true,
        isDefault: true,
      },
    );
    const cyclic = new GameData(ds);
    const plan = buildPlan(cyclic, { target: 'CycleA', targetPerMin: 45 });
    expect(plan.nodes.some((n) => n.kind === 'cycle')).toBe(true);
    expect(plan.warnings.join(' ')).toMatch(/循环/);
  });

  it('rejects a non positive target rate', () => {
    expect(() => buildPlan(data, { target: 'Gear', targetPerMin: 0 })).toThrow(/targetPerMin/);
  });

  it('rejects an unknown target item', () => {
    expect(() => buildPlan(data, { target: 'Unobtainium', targetPerMin: 1 })).toThrow(/unknown item/);
  });
});

describe('power report', () => {
  it('computes the generator count needed to break even', () => {
    const report = powerReport(3000, [{ buildingKey: 'WindTurbine', outputKW: 300, count: 0 }]);
    expect(report.netKW).toBe(-3000);
    expect(report.generatorsNeeded).toEqual([{ buildingKey: 'WindTurbine', count: 10 }]);
  });

  it('reports a surplus when generation exceeds consumption', () => {
    const report = powerReport(1000, [{ buildingKey: 'WindTurbine', outputKW: 300, count: 8 }]);
    expect(report.netKW).toBe(1400);
    expect(report.generatorsNeeded[0]!.count).toBe(0);
  });
});
