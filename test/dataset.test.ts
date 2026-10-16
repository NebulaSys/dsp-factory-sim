import { describe, expect, it } from 'vitest';
import datasetJson from '../src/engine/data/dsp-vanilla.json';
import { loadDataset } from '../src/engine/loader.ts';
import { buildPlan } from '../src/engine/planner.ts';
import { computeProduction } from '../src/engine/production.ts';
import { computeMiningRate, computeBonuses, emptyResearch } from '../src/engine/rules.ts';
import { encodeBlueprint, decodeBlueprint, looksLikeBlueprint, type BlueprintBody } from '../src/engine/bp/codec.ts';
import { convertBlueprint } from '../src/engine/factory.ts';
import type { BlueprintBuilding, BlueprintMeta } from '../src/engine/bp/codec.ts';

/**
 * Tests against the real shipped dataset. These are the guard rails that stop a
 * bad data extraction from silently changing every number in the simulator.
 */
const data = loadDataset(datasetJson);

describe('shipped dataset', () => {
  it('loads and validates without problems', () => {
    expect(data.items.length).toBeGreaterThan(150);
    expect(data.recipes.length).toBeGreaterThan(150);
    expect(data.buildings.length).toBeGreaterThan(50);
    expect(data.validate()).toEqual([]);
  });

  it('carries the real internal prototype ids for the core items', () => {
    expect(data.requireItem('IronOre').id).toBe(1001);
    expect(data.requireItem('CopperOre').id).toBe(1002);
    expect(data.requireItem('IronIngot').id).toBe(1101);
    expect(data.requireItem('Magnet').id).toBe(1102);
    expect(data.requireItem('CopperIngot').id).toBe(1104);
    expect(data.requireItem('Gear').id).toBe(1201);
    expect(data.requireItem('MagneticCoil').id).toBe(1202);
    expect(data.requireItem('CircuitBoard').id).toBe(1301);
    expect(data.requireItem('Proliferator1').id).toBe(1141);
    expect(data.requireItem('Proliferator2').id).toBe(1142);
    expect(data.requireItem('Proliferator3').id).toBe(1143);
    expect(data.requireItem('ElectromagneticMatrix').id).toBe(6001);
  });

  it('carries the real internal prototype ids for the core buildings', () => {
    expect(data.requireBuilding('ArcSmelter').id).toBe(2302);
    expect(data.requireBuilding('AssemblingMachineMk1').id).toBe(2303);
    expect(data.requireBuilding('AssemblingMachineMk2').id).toBe(2304);
    expect(data.requireBuilding('AssemblingMachineMk3').id).toBe(2305);
    expect(data.requireBuilding('MiningMachine').id).toBe(2301);
    expect(data.requireBuilding('MatrixLab').id).toBe(2901);
  });

  it('has the in-game machine speed table', () => {
    // Verified against dsp-wiki.com building pages.
    expect(data.requireBuilding('AssemblingMachineMk1').workSpeed).toBe(0.75);
    expect(data.requireBuilding('AssemblingMachineMk2').workSpeed).toBe(1);
    expect(data.requireBuilding('AssemblingMachineMk3').workSpeed).toBe(1.5);
    expect(data.requireBuilding('RecomposingAssembler').workSpeed).toBe(3);
    expect(data.requireBuilding('ArcSmelter').workSpeed).toBe(1);
    expect(data.requireBuilding('PlaneSmelter').workSpeed).toBe(2);
    expect(data.requireBuilding('ChemicalPlant').workSpeed).toBe(1);
    expect(data.requireBuilding('QuantumChemicalPlant').workSpeed).toBe(2);
    expect(data.requireBuilding('MatrixLab').workSpeed).toBe(1);
  });

  it('has the in-game crafting machine power draws', () => {
    expect(data.requireBuilding('AssemblingMachineMk1').powerConsumptionKW).toBe(270);
    expect(data.requireBuilding('AssemblingMachineMk2').powerConsumptionKW).toBe(540);
    expect(data.requireBuilding('AssemblingMachineMk3').powerConsumptionKW).toBe(1080);
    expect(data.requireBuilding('ArcSmelter').powerConsumptionKW).toBe(360);
    // 12 MW, verified on the rendered wiki page for the collider.
    expect(data.requireBuilding('MiniatureParticleCollider').powerConsumptionKW).toBe(12000);
    expect(data.requireBuilding('MatrixLab').powerConsumptionKW).toBe(480);
  });

  /**
   * Sorter attachment points come from the game's own prefab data
   * (`SlotConfig.insertPoses`). They must not be confused with the two other slot
   * counts the dataset already carries: `slots` is simultaneous recipe workers
   * (assembler 1, lab 6) and `station.slots` is a station's item slot count.
   */
  it('carries sorter attachment slot counts from the game prefab data', () => {
    const attach = (key: string): number | undefined => data.requireBuilding(key).sorterAttachSlots;
    // Machines that accept sorters on every face of a 3x3 footprint.
    expect(attach('AssemblingMachineMk1')).toBe(12);
    expect(attach('AssemblingMachineMk3')).toBe(12);
    expect(attach('ArcSmelter')).toBe(12);
    // Labs hold research items rather than running one recipe, which is what `slots` is for.
    expect(attach('MatrixLab')).toBe(12);
    // Fewer faces are reachable on these shapes.
    expect(attach('OilRefinery')).toBe(9);
    expect(attach('MiniatureParticleCollider')).toBe(9);
    expect(attach('ChemicalPlant')).toBe(8);
    expect(attach('ThermalPowerPlant')).toBe(5);
    expect(attach('ArtificialStar')).toBe(4);
    expect(attach('VerticalLaunchingSilo')).toBe(3);
    // Belts, sorters and turrets take no sorters.
    expect(attach('ConveyorBeltMk1')).toBeUndefined();
    expect(attach('SorterMk1')).toBeUndefined();
  });

  it('keeps recipe-worker slots distinct from sorter attachment slots', () => {
    // `slots` is recipe workers: an assembler runs one recipe at a time, a lab six.
    expect(data.requireBuilding('AssemblingMachineMk1').slots).toBe(1);
    expect(data.requireBuilding('MatrixLab').slots).toBe(6);
    // A logistics station runs no recipe, so it has no `slots`; its capacity lives in
    // `station.slots` and it exposes no sorter attachment points.
    const station = data.requireBuilding('PlanetaryLogisticsStation');
    expect(station.slots ?? null).toBeNull();
    expect(station.sorterAttachSlots).toBeUndefined();
    expect(station.station?.slots).toBe(4);
  });

  it('reports a sorter slot index that exceeds the attachment count', () => {
    // The simulator range-checks a recorded slot against the shipped count. Build a
    // body that deliberately oversteps it and confirm the warning is raised rather
    // than the bad index being accepted silently.
    const area = { index: 0, parentIndex: -1, tropicAnchor: 0, areaSegments: 5, anchorLocalOffsetX: 0, anchorLocalOffsetY: 0, width: 200, height: 200 };
    const assembler: BlueprintBuilding = {
      index: 0,
      areaIndex: 0,
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      x2: 0,
      y2: 0,
      z2: 0,
      yaw2: -1,
      itemId: 2303, // Assembling Machine Mk.I, which declares 12 sorter attachment points
      recipeId: 0,
      modelIndex: 0,
      outputObjectIndex: -1,
      inputObjectIndex: -1,
      outputToSlot: 0,
      inputFromSlot: 0,
      outputFromSlot: 0,
      inputToSlot: 0,
      outputOffset: 0,
      inputOffset: 0,
      filterId: 0,
      parameters: [],
    };
    const sorter: BlueprintBuilding = {
      ...assembler,
      index: 1,
      x: 1,
      itemId: 2011, // Sorter Mk.I
      inputObjectIndex: 0, // feeds the assembler
      outputToSlot: -1,
      inputFromSlot: 99, // far beyond the assembler's 12 slots
    };

    const over: BlueprintBody = {
      header: { version: 1, cursorOffsetX: 0, cursorOffsetY: 0, cursorTargetArea: 0, dragboxSizeX: 8, dragboxSizeY: 8, primaryAreaIndex: 0, areaCount: 1 },
      areas: [area],
      buildings: [assembler, sorter],
    };
    const meta: BlueprintMeta = {
      timestampTicks: 0,
      gameVersion: '0.10.35.29104',
      shortDesc: 'slot check',
      longDesc: '',
      icon: { layout: 0, images: [0, 0, 0, 0, 0] },
    };
    const warned = convertBlueprint(data, { body: over, meta, format: 'text' });
    expect(warned.totals.warnings.some((w) => w.includes('input slot 99'))).toBe(true);

    // The same wiring with a slot the building really has must stay quiet.
    const valid: BlueprintBody = { ...over, buildings: [assembler, { ...sorter, inputFromSlot: 3 }] };
    const clean = convertBlueprint(data, { body: valid, meta, format: 'text' });
    expect(clean.totals.warnings.some((w) => w.includes('sorter #1'))).toBe(false);
  });

  it('has the proliferator table from the wiki', () => {
    const mk1 = data.requireProliferatorMark('Proliferator1');
    const mk2 = data.requireProliferatorMark('Proliferator2');
    const mk3 = data.requireProliferatorMark('Proliferator3');
    expect([mk1, mk2, mk3].map((m) => m.extraProductsBonus)).toEqual([0.125, 0.2, 0.25]);
    expect([mk1, mk2, mk3].map((m) => m.speedBonus)).toEqual([0.25, 0.5, 1]);
    expect([mk1, mk2, mk3].map((m) => m.spraysPerItem)).toEqual([12, 24, 60]);
    expect([mk1, mk2, mk3].map((m) => m.energyPenalty)).toEqual([0.3, 0.7, 1.5]);
    // Self-sprayed sprays: biligame 13/28/75 vs the EN wiki table 13/28/72.
    // The extra-products formula (floor(sprays × (1 + bonus))) reproduces 13 and
    // 28 for Mk.I/II, so 75 is kept for Mk.III; the conflict is recorded in the
    // dataset rather than hidden.
    expect([mk1, mk2, mk3].map((m) => m.spraysWhenSelfSprayed)).toEqual([13, 28, 75]);
    expect(mk3.conflictNote ?? '').toMatch(/SelfSprayed/i);
  });

  it('reproduces the early game chain with real data', () => {
    // Iron ingot: 1 ore -> 1 ingot in 1 s on an Arc Smelter => 60/min.
    const iron = computeProduction(data, { recipe: 'IronIngot' });
    expect(iron.buildingKey).toBe('ArcSmelter');
    expect(iron.craftsPerMinPerMachine).toBeCloseTo(60, 6);

    const coil = computeProduction(data, { recipe: 'MagneticCoil' });
    expect(coil.buildingKey).toBe('AssemblingMachineMk1');
    expect(coil.craftsPerMinPerMachine).toBeCloseTo(45, 6);
    expect(coil.outputsPerMin).toEqual([{ item: 'MagneticCoil', count: 90 }]);
  });

  it('reproduces the mining rate and the Veins Utilisation upgrade', () => {
    const bonuses = computeBonuses(data, emptyResearch());
    expect(computeMiningRate({ coveredVeins: 1, baseRatePerVeinPerMin: 30, bonuses })).toBe(30);
    expect(computeMiningRate({ coveredVeins: 8, baseRatePerVeinPerMin: 30, bonuses })).toBe(240);

    // Game data keys this upgrade "VeinUtilization" (singular) and stores the ore
    // consumption (0.94/level); the +10%/level mining speed comes from the wiki
    // page and is merged into effectsPerLevel by tools/build-dataset.mjs.
    const leveled = computeBonuses(data, { technologies: new Set(), upgradeLevels: { VeinUtilization: 5 } });
    expect(leveled.miningSpeedMultiplier).toBeCloseTo(1.5, 9);
    expect(computeMiningRate({ coveredVeins: 1, baseRatePerVeinPerMin: 30, bonuses: leveled })).toBeCloseTo(45, 6);
    expect(leveled.veinConsumptionMultiplier).toBeCloseTo(Math.pow(0.94, 5), 9);
    // The plural alias must keep working so UI labels cannot silently zero it.
    const aliased = computeBonuses(data, { technologies: new Set(), upgradeLevels: { VeinsUtilization: 5 } });
    expect(aliased.miningSpeedMultiplier).toBeCloseTo(1.5, 9);
  });

  it('plans a full white-matrix chain down to ore', () => {
    const plan = buildPlan(data, { target: 'UniverseMatrix', targetPerMin: 60 });
    expect(plan.totalMachines).toBeGreaterThan(100);
    expect(plan.rawResources.length).toBeGreaterThan(3);
    // Every intermediate must be supplied by the plan.
    for (const row of plan.balance) {
      if (row.demandedPerMin > 0 && row.suppliedPerMin > 0) {
        expect(row.suppliedPerMin + 1e-6).toBeGreaterThanOrEqual(row.demandedPerMin);
      }
    }
    // Iron ore and copper ore must appear as raw inputs.
    const rawItems = plan.rawResources.map((r) => r.item);
    expect(rawItems).toContain('IronOre');
    expect(rawItems).toContain('CopperOre');
  });

  it('honours proliferator speedup across the real data', () => {
    const plain = computeProduction(data, { recipe: 'MagneticCoil' });
    const sprayed = computeProduction(data, {
      recipe: 'MagneticCoil',
      proliferator: { markKey: 'Proliferator3', mode: 'speedup' },
    });
    // Mk.III speedup is +100%: craft speed doubles.
    expect(sprayed.craftsPerMinPerMachine).toBeCloseTo(plain.craftsPerMinPerMachine * 2, 6);
    // Energy penalty +150%.
    expect(sprayed.totalPowerKW).toBeCloseTo(plain.totalPowerKW * 2.5, 6);
  });

  it('round-trips a blueprint made from real prototype ids', async () => {
    const smelter = data.requireBuilding('ArcSmelter');
    const assembler = data.requireBuilding('AssemblingMachineMk1');
    const smelterRecipe = data.recipes.find((r) => r.facility === 'ArcSmelter' && r.outputs[0]?.item === 'IronIngot')!;
    const assemblerRecipe = data.recipes.find((r) => r.facility === 'AssemblingMachineMk1' && r.outputs[0]?.item === 'Gear')!;

    const body: BlueprintBody = {
      header: { version: 1, cursorOffsetX: 0, cursorOffsetY: 0, cursorTargetArea: 0, dragboxSizeX: 8, dragboxSizeY: 8, primaryAreaIndex: 0, areaCount: 1 },
      areas: [{ index: 0, parentIndex: -1, tropicAnchor: 0, areaSegments: 5, anchorLocalOffsetX: 0, anchorLocalOffsetY: 0, width: 200, height: 200 }],
      buildings: [
        {
          index: 0, areaIndex: 0, x: 0, y: 0, z: 0, x2: 0, y2: 0, z2: 0, yaw: 0, yaw2: -1,
          itemId: smelter.id!, recipeId: smelterRecipe.id!, modelIndex: 0,
          outputObjectIndex: -1, inputObjectIndex: -1, outputToSlot: 0, inputFromSlot: 0,
          outputFromSlot: 0, inputToSlot: 0, outputOffset: 0, inputOffset: 0, filterId: 0, parameters: [],
        },
        {
          index: 1, areaIndex: 0, x: 4, y: 0, z: 0, x2: 0, y2: 0, z2: 0, yaw: 0, yaw2: -1,
          itemId: assembler.id!, recipeId: assemblerRecipe.id!, modelIndex: 0,
          outputObjectIndex: 0, inputObjectIndex: -1, outputToSlot: 0, inputFromSlot: 0,
          outputFromSlot: 0, inputToSlot: 0, outputOffset: 0, inputOffset: 0, filterId: 0, parameters: [],
        },
      ],
    };

    const text = await encodeBlueprint(body, { meta: { shortDesc: '铁块→齿轮' } });
    expect(looksLikeBlueprint(text)).toBe(true);
    expect(text.startsWith('BLUEPRINT:')).toBe(true);

    const decoded = await decodeBlueprint(text);
    expect(decoded.hashWarning).toBeUndefined();

    const model = convertBlueprint(data, decoded);
    expect(model.unknown).toEqual([]);
    expect(model.totals.producers).toBe(2);
    const gearLine = model.lines.find((l) => l.recipeKey === assemblerRecipe.key)!;
    expect(gearLine.machines).toBe(1);
    expect(gearLine.rate.craftsPerMinPerMachine).toBeCloseTo(45, 6);
    expect(model.totals.rawInputsPerMin.some((r) => r.item === 'IronOre')).toBe(true);
  });
});
