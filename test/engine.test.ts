import { describe, expect, it } from 'vitest';
import { GameData } from '../src/engine/registry.ts';
import {
  computeBonuses,
  computeMiningRate,
  computeVeinDepletion,
  effectiveMark,
  emptyResearch,
  resolveProliferator,
  veinTotalAmount,
  veinsUtilizationSpeedMultiplier,
} from '../src/engine/rules.ts';
import { computeProduction, machinesForRate, maxMachinesForInput } from '../src/engine/production.ts';
import { fixtureDataset } from './fixtures/dataset.ts';

const data = new GameData(fixtureDataset());

/**
 * Hand-computed expectations. Each `expect` documents the in-game value it
 * reproduces so a wrong number is traceable to the game, not to the test.
 */
describe('smelting rates', () => {
  it('Arc Smelter makes 60 iron ingots/min from 60 iron ore/min', () => {
    // Recipe: 1 IronOre -> 1 IronIngot in 1.0 s. Arc Smelter speed = 1.0.
    // => 60 crafts/min => 60 ingots/min, 60 ore/min, 360 kW.
    const r = computeProduction(data, { recipe: 'IronIngot' });
    expect(r.buildingKey).toBe('ArcSmelter');
    expect(r.craftsPerMinPerMachine).toBeCloseTo(60, 6);
    expect(r.outputsPerMin).toEqual([{ item: 'IronIngot', count: 60 }]);
    expect(r.inputsPerMin).toEqual([{ item: 'IronOre', count: 60 }]);
    expect(r.powerConsumptionKW).toBe(360);
    expect(r.warnings).toEqual([]);
  });

  it('Magnet takes 1.5 s per craft => 40/min per smelter', () => {
    const r = computeProduction(data, { recipe: 'Magnet' });
    expect(r.craftsPerMinPerMachine).toBeCloseTo(40, 6);
    expect(r.outputsPerMin).toEqual([{ item: 'Magnet', count: 40 }]);
  });

  it('scales linearly with machine count', () => {
    const r = computeProduction(data, { recipe: 'IronIngot', machines: 7.5 });
    expect(r.outputsPerMin[0]!.count).toBeCloseTo(450, 6);
    expect(r.totalPowerKW).toBeCloseTo(2700, 6);
  });
});

describe('assembling machine speed table', () => {
  it('Mk.I (0.75x) makes 90 magnetic coils/min from 2 magnets + 1 copper each', () => {
    // 2 MagneticCoil per craft, craftTime 1 s, speed 0.75
    // => 45 crafts/min => 90 coils, 90 magnets, 45 copper ingots.
    const r = computeProduction(data, { recipe: 'MagneticCoil' });
    expect(r.buildingKey).toBe('AssemblingMachineMk1');
    expect(r.craftsPerMinPerMachine).toBeCloseTo(45, 6);
    expect(r.outputsPerMin).toEqual([{ item: 'MagneticCoil', count: 90 }]);
    expect(r.inputsPerMin).toEqual([
      { item: 'Magnet', count: 90 },
      { item: 'CopperIngot', count: 45 },
    ]);
    expect(r.powerConsumptionKW).toBe(270);
  });

  it('the same recipe is 2x faster in a Mk.III (1.5x vs 0.75x)', () => {
    const mk1 = computeProduction(data, { recipe: 'MagneticCoil', building: 'AssemblingMachineMk1' });
    const mk3 = computeProduction(data, { recipe: 'MagneticCoil', building: 'AssemblingMachineMk3' });
    expect(mk3.craftsPerMinPerMachine).toBeCloseTo(mk1.craftsPerMinPerMachine * 2, 6);
  });

  it('matrix lab runs at 1.0x with a 3 s recipe => 20/min on the Matrix Lab', () => {
    // ElectromagneticMatrix: 1 coil + 1 circuit in 3 s. The recipe's facility is
    // MatrixLab (speed 1.0x), NOT the assembling machine, so 60 / 3 = 20/min.
    const r = computeProduction(data, { recipe: 'ElectromagneticMatrix' });
    expect(r.buildingKey).toBe('MatrixLab');
    expect(r.craftsPerMinPerMachine).toBeCloseTo(20, 6);
    expect(r.outputsPerMin).toEqual([{ item: 'ElectromagneticMatrix', count: 20 }]);
    expect(r.powerConsumptionKW).toBe(480);
  });
});

describe('research bonuses', () => {
  it('Veins Utilisation adds +10% mining speed per level, linearly', () => {
    expect(veinsUtilizationSpeedMultiplier(0)).toBe(1);
    expect(veinsUtilizationSpeedMultiplier(1)).toBeCloseTo(1.1, 9);
    expect(veinsUtilizationSpeedMultiplier(5)).toBeCloseTo(1.5, 9);
    expect(computeBonuses(data, { technologies: new Set(), upgradeLevels: { VeinUtilization: 5 } }).miningSpeedMultiplier).toBeCloseTo(1.5, 9);
  });

  it('mining machine yields 30 items/min per covered vein at level 0', () => {
    // Wiki: "harvests each vein covered by its harvest area at a base rate of
    // 30 items per minute".
    const bonuses = computeBonuses(data, emptyResearch());
    expect(computeMiningRate({ coveredVeins: 1, baseRatePerVeinPerMin: 30, bonuses })).toBeCloseTo(30, 9);
    expect(computeMiningRate({ coveredVeins: 6, baseRatePerVeinPerMin: 30, bonuses })).toBeCloseTo(180, 9);
  });

  it('Veins Utilisation level 5 gives 45/min per vein and less depletion', () => {
    const bonuses = computeBonuses(data, { technologies: new Set(), upgradeLevels: { VeinUtilization: 5 } });
    const rate = computeMiningRate({ coveredVeins: 1, baseRatePerVeinPerMin: 30, bonuses });
    expect(rate).toBeCloseTo(45, 6); // 30 * 1.5, matches the wiki table's 45.0/min
    expect(computeVeinDepletion(rate, 5)).toBeCloseTo(45 * Math.pow(0.94, 5), 6);
    // The wiki's table rounds this row to 33.1/min; 33.03 is the exact value.
    expect(computeVeinDepletion(rate, 5)).toBeCloseTo(33.0, 1);
  });

  it('vein reserves last longer by 0.94^-L', () => {
    expect(veinTotalAmount(1000, 0)).toBe(1000);
    expect(veinTotalAmount(1000, 1)).toBeCloseTo(1000 / 0.94, 6);
  });

  it('Assembling Speed upgrade multiplies assembler throughput but not smelters', () => {
    const research = { technologies: new Set<string>(), upgradeLevels: { AssemblingSpeed: 2 } }; // +50%
    const bonuses = computeBonuses(data, research);
    const assembler = computeProduction(data, { recipe: 'MagneticCoil', bonuses });
    const smelter = computeProduction(data, { recipe: 'IronIngot', bonuses });
    expect(assembler.craftsPerMinPerMachine).toBeCloseTo(45 * 1.5, 6);
    expect(smelter.craftsPerMinPerMachine).toBeCloseTo(60, 6); // smelting is unaffected
  });
});

describe('proliferator', () => {
  it('reproduces the wiki bonus table', () => {
    const mk1 = data.requireProliferatorMark('Proliferator1');
    const mk2 = data.requireProliferatorMark('Proliferator2');
    const mk3 = data.requireProliferatorMark('Proliferator3');
    // Extra Products: +12.5% / +20% / +25%
    expect([mk1, mk2, mk3].map((m) => m.extraProductsBonus)).toEqual([0.125, 0.2, 0.25]);
    // Production Speedup: +25% / +50% / +100%
    expect([mk1, mk2, mk3].map((m) => m.speedBonus)).toEqual([0.25, 0.5, 1.0]);
    // Sprays: 12/24/60, self-sprayed 13/28/72
    expect([mk1, mk2, mk3].map((m) => m.spraysPerItem)).toEqual([12, 24, 60]);
    expect([mk1, mk2, mk3].map((m) => m.spraysWhenSelfSprayed)).toEqual([13, 28, 72]);
    // Energy penalty: +30% / +70% / +150%
    expect([mk1, mk2, mk3].map((m) => m.energyPenalty)).toEqual([0.3, 0.7, 1.5]);
  });

  it('speedup mode reproduces the wiki "3x base crafting speed" example', () => {
    // Wiki: "applying Proliferator Mk.III to all ingredients will result in a
    // final crafting speed of 3x the base amount when used by an Assembling
    // Machine Mk.III (+100% to the Assembly Machine Mk.III's 1.5x crafting
    // speed)". Here speedMultiplier is the multiplier on the recipe's craft
    // time, so 1.5 (machine) * 2.0 (proliferator) = 3.0 => 3x the base rate.
    const r = computeProduction(data, {
      recipe: 'MagneticCoil',
      building: 'AssemblingMachineMk3',
      proliferator: { markKey: 'Proliferator3', mode: 'speedup' },
    });
    expect(r.speedMultiplier).toBeCloseTo(3, 9); // 1.5 * 2.0
    expect(r.craftsPerMinPerMachine).toBeCloseTo(180, 6); // craftTime 1s / 3 => 180/min
    // energy penalty: 1080 kW * 2.5
    expect(r.totalPowerKW).toBeCloseTo(2700, 6);
  });

  it('speedup on the slower Mk.I gives exactly 1.5x its base speed', () => {
    // 0.75 (Mk.I) * 2.0 (Mk.III speedup) = 1.5 => craftTime 1s / 1.5 = 0.667s
    const r = computeProduction(data, {
      recipe: 'MagneticCoil',
      building: 'AssemblingMachineMk1',
      proliferator: { markKey: 'Proliferator3', mode: 'speedup' },
    });
    expect(r.speedMultiplier).toBeCloseTo(1.5, 9);
    expect(r.craftsPerMinPerMachine).toBeCloseTo(90, 6);
  });

  it('extra products mode multiplies output but not inputs', () => {
    const r = computeProduction(data, {
      recipe: 'MagneticCoil',
      proliferator: { markKey: 'Proliferator1', mode: 'extraProducts' },
    });
    expect(r.craftsPerMinPerMachine).toBeCloseTo(45, 6); // craft time unchanged
    expect(r.outputsPerMin[0]!.count).toBeCloseTo(90 * 1.125, 6);
    expect(r.inputsPerMin[0]!.count).toBeCloseTo(90, 6); // inputs unchanged
    expect(r.outputMultiplier).toBeCloseTo(1.125, 9);
  });

  it('reports proliferator upkeep in sprays per minute', () => {
    // A sprayed machine moves `inputs + outputs` physical items per craft:
    // 2 coils out + 2 magnets + 1 copper in = 5 items/craft.
    // 45 crafts/min * 5 = 225 items/min, and Mk.III stores 60 sprays per
    // Proliferator item => 225/60 = 3.75 sprays/min.
    const r = computeProduction(data, {
      recipe: 'MagneticCoil',
      proliferator: { markKey: 'Proliferator3', mode: 'extraProducts' },
    });
    expect(r.proliferator.spraysPerMin).toBeCloseTo((45 * 5) / 60, 6);
  });

  it('falls back to speedup for recipes that cannot use extra products', () => {
    const ds = fixtureDataset();
    ds.items.push({
      id: 1302,
      key: 'Antimatter',
      name: 'Antimatter',
      category: 'intermediate',
      stackSize: 100,
      isRaw: false,
      isFluid: false,
    });
    ds.recipes.push({
      id: 99,
      key: 'AntimatterRecipe',
      outputs: [{ item: 'Antimatter', count: 1 }],
      inputs: [{ item: 'IronOre', count: 1 }],
      craftTime: 2,
      facility: 'AssemblingMachineMk1',
      proliferatorBoost: true,
      proliferatorOutput: true,
      isDefault: true,
    });
    const withAntimatter = new GameData(ds);
    const r = computeProduction(withAntimatter, {
      recipe: 'AntimatterRecipe',
      proliferator: { markKey: 'Proliferator3', mode: 'extraProducts' },
    });
    expect(r.proliferator.mode).toBe('speedup');
    expect(r.warnings.join(' ')).toMatch(/Extra Products/);
    // Machine is Mk.I (0.75x) so the craft-speed multiplier is 0.75 * 2.0.
    expect(r.speedMultiplier).toBeCloseTo(1.5, 6);
    expect(r.craftsPerMinPerMachine).toBeCloseTo(45, 6); // 2s craft / 1.5 => 1.333s => 45/min
  });

  it('uses the lowest mark among ingredients, and none if any is unsprayed', () => {
    expect(effectiveMark(['Proliferator3', 'Proliferator1'], data)?.key).toBe('Proliferator1');
    expect(effectiveMark(['Proliferator3', null], data)).toBe(null);
    expect(effectiveMark([], data)).toBe(null);
  });

  it('resolveProliferator returns neutral values for mode "none"', () => {
    const r = resolveProliferator(data, { markKey: 'Proliferator3', mode: 'none' });
    expect(r.speedFactor).toBe(1);
    expect(r.outputFactor).toBe(1);
    expect(r.energyMultiplier).toBe(1);
    expect(r.mark).toBe(null);
  });
});

describe('sizing helpers', () => {
  it('machinesForRate computes fractional machine counts', () => {
    // 90 coils/min per Mk.I assembler; ask for 450/min => 5 machines.
    const { machines, achievedPerMin } = machinesForRate(data, {
      recipe: 'MagneticCoil',
      targetPerMin: 450,
      targetItem: 'MagneticCoil',
    });
    expect(machines).toBeCloseTo(5, 6);
    expect(achievedPerMin).toBeCloseTo(450, 6);
  });

  it('maxMachinesForInput is limited by belt throughput', () => {
    // Mk.I belt = 360 iron ore/min; each smelter eats 60/min => 6 smelters.
    const belt = data.belt('ConveyorBeltMk1')!;
    const n = maxMachinesForInput(data, { recipe: 'IronIngot' }, 'IronOre', belt.speedPerMin);
    expect(n).toBeCloseTo(6, 9);
  });
});

describe('dataset integrity', () => {
  it('fixture dataset validates', () => {
    expect(data.validate()).toEqual([]);
  });

  it('rejects duplicate keys', () => {
    const ds = fixtureDataset();
    ds.items.push({ ...ds.items[0]! });
    expect(() => new GameData(ds)).toThrow(/duplicate item key/);
  });
});
