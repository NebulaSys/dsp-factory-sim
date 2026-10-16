import { describe, expect, it } from 'vitest';
import { GameData } from '../src/engine/registry.ts';
import { decodeBlueprint, encodeBlueprint, type BlueprintBody, type BlueprintBuilding, type BlueprintMeta } from '../src/engine/bp/codec.ts';
import { convertBlueprint, mergeFactories } from '../src/engine/factory.ts';
import { fixtureDataset } from './fixtures/dataset.ts';

const data = new GameData(fixtureDataset());

function building(partial: Partial<BlueprintBuilding> & { index: number; itemId: number; x: number; y: number }): BlueprintBuilding {
  return {
    areaIndex: 0,
    z: 0,
    x2: 0,
    y2: 0,
    z2: 0,
    yaw: 0,
    yaw2: -1,
    tilt: 0,
    pitch: 0,
    tilt2: 0,
    pitch2: 0,
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
    ...partial,
  };
}

/**
 * A miniature "from ore to blue matrix" style line:
 *   2 Arc Smelters (IronIngot) -> 1 Assembling Machine Mk.I (Gear)
 * plus one sorter linking smelter #0 to the assembler.
 */
function lineBody(): BlueprintBody {
  return {
    header: {
      version: 1,
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
        areaSegments: 5,
        anchorLocalOffsetX: 0,
        anchorLocalOffsetY: 0,
        width: 200,
        height: 200,
      },
    ],
    buildings: [
      building({ index: 0, itemId: 2302, recipeId: 1, x: 0, y: 0 }), // Arc Smelter, IronIngot
      building({ index: 1, itemId: 2302, recipeId: 1, x: 3, y: 0 }), // Arc Smelter, IronIngot
      building({ index: 2, itemId: 2303, recipeId: 12, x: 6, y: 0 }), // Assembling Machine Mk.I, Gear
      building({ index: 3, itemId: 2001, recipeId: 0, x: 0, y: 5 }), // Conveyor Belt Mk.I
      building({ index: 4, itemId: 2011, recipeId: 0, x: 2, y: 2, outputObjectIndex: 0, inputObjectIndex: 2 }), // Sorter
      building({ index: 5, itemId: 2301, recipeId: 0, x: 9, y: 9 }), // Mining Machine
    ],
  };
}

describe('blueprint → factory conversion', () => {
  it('groups machines into lines with correct aggregate rates', () => {
    const model = convertBlueprint(data, {
      format: 'text',
      meta: {
        timestampTicks: 0,
        gameVersion: '0.10.30.24610',
        shortDesc: 'test',
        longDesc: '',
        icon: { layout: 10, images: [0, 0, 0, 0, 0] },
      },
      body: lineBody(),
    });

    expect(model.totals.buildings).toBe(6);
    expect(model.unknown).toEqual([]);

    const gear = model.lines.find((l) => l.recipeKey === 'Gear')!;
    expect(gear.machines).toBe(1);
    expect(gear.rate.craftsPerMinPerMachine).toBeCloseTo(45, 6); // Mk.I 0.75x, 1s craft
    expect(gear.rate.outputsPerMin).toEqual([{ item: 'Gear', count: 45 }]);

    const iron = model.lines.find((l) => l.recipeKey === 'IronIngot')!;
    expect(iron.machines).toBe(2);
    expect(iron.rate.outputsPerMin).toEqual([{ item: 'IronIngot', count: 120 }]); // 2 * 60/min

    // 120 iron ingots produced, 45 consumed by the gear line.
    const ironBalance = model.totals.balance.find((b) => b.item === 'IronIngot')!;
    expect(ironBalance.producedPerMin).toBeCloseTo(120, 6);
    expect(ironBalance.consumedPerMin).toBeCloseTo(45, 6);

    // Iron ore is the raw input; gears are the final output.
    expect(model.totals.rawInputsPerMin).toEqual([{ item: 'IronOre', count: 120 }]);
    expect(model.totals.finalOutputsPerMin).toEqual([{ item: 'Gear', count: 45 }]);
    expect(model.totals.craftingPowerKW).toBeCloseTo(2 * 360 + 270, 6);
  });

  it('classifies belts, sorters, miners and power buildings', () => {
    const model = convertBlueprint(data, {
      format: 'text',
      meta: { timestampTicks: 0, gameVersion: 'x', shortDesc: '', longDesc: '', icon: { layout: 10, images: [0, 0, 0, 0, 0] } },
      body: lineBody(),
    });
    const byIndex = new Map(model.nodes.map((n) => [n.index, n]));
    expect(byIndex.get(0)!.kind).toBe('producer');
    expect(byIndex.get(3)!.kind).toBe('belt');
    expect(byIndex.get(4)!.kind).toBe('sorter');
    expect(byIndex.get(5)!.kind).toBe('other'); // mining machine
    expect(model.totals.belts).toBe(1);
    expect(model.totals.sorters).toBe(1);
  });

  it('records sorter connections between buildings', () => {
    const model = convertBlueprint(data, {
      format: 'text',
      meta: { timestampTicks: 0, gameVersion: 'x', shortDesc: '', longDesc: '', icon: { layout: 10, images: [0, 0, 0, 0, 0] } },
      body: lineBody(),
    });
    const smelter = model.nodes.find((n) => n.index === 0)!;
    const assembler = model.nodes.find((n) => n.index === 2)!;
    expect(smelter.outputsTo).toContain(2);
    expect(assembler.inputsFrom).toContain(0);
  });

  it('keeps unknown prototype ids instead of dropping them', () => {
    const body = lineBody();
    body.buildings.push(building({ index: 9, itemId: 9999, x: 1, y: 1 }));
    const model = convertBlueprint(data, {
      format: 'text',
      meta: { timestampTicks: 0, gameVersion: 'x', shortDesc: '', longDesc: '', icon: { layout: 10, images: [0, 0, 0, 0, 0] } },
      body,
    });
    expect(model.unknown).toEqual([{ itemId: 9999, count: 1 }]);
    expect(model.nodes.some((n) => n.buildingKey === null)).toBe(true);
  });

  it('applies a session-wide proliferator setting to every line', () => {
    const model = convertBlueprint(
      data,
      {
        format: 'text',
        meta: { timestampTicks: 0, gameVersion: 'x', shortDesc: '', longDesc: '', icon: { layout: 10, images: [0, 0, 0, 0, 0] } },
        body: lineBody(),
      },
      { proliferator: { markKey: 'Proliferator3', mode: 'speedup' } },
    );
    const gear = model.lines.find((l) => l.recipeKey === 'Gear')!;
    expect(gear.rate.craftsPerMinPerMachine).toBeCloseTo(90, 6); // 45 * 2
    expect(gear.rate.totalPowerKW).toBeCloseTo(270 * 2.5, 6); // energy penalty
    const iron = model.lines.find((l) => l.recipeKey === 'IronIngot')!;
    expect(iron.rate.craftsPerMinPerMachine).toBeCloseTo(120, 6); // 60/min * 2 speedup
  });

  it('reports unknown recipe ids as warnings', () => {
    const body = lineBody();
    body.buildings[0]!.recipeId = 777;
    const model = convertBlueprint(data, {
      format: 'text',
      meta: { timestampTicks: 0, gameVersion: 'x', shortDesc: '', longDesc: '', icon: { layout: 10, images: [0, 0, 0, 0, 0] } },
      body,
    });
    expect(model.totals.warnings.join(' ')).toMatch(/unknown recipe_id 777/);
  });

  it('computes a bounding box over all placements', () => {
    const model = convertBlueprint(data, {
      format: 'text',
      meta: { timestampTicks: 0, gameVersion: 'x', shortDesc: '', longDesc: '', icon: { layout: 10, images: [0, 0, 0, 0, 0] } },
      body: lineBody(),
    });
    expect(model.totals.boundingBox).toEqual({ minX: 0, minY: 0, maxX: 9, maxY: 9 });
  });

  it('survives a full encode → decode → convert round trip', async () => {
    const body = lineBody();
    const text = await encodeBlueprint(body, { meta: { shortDesc: '齿轮线', gameVersion: '0.10.30.24610' } });
    const decoded = await decodeBlueprint(text);
    expect(decoded.hashWarning).toBeUndefined();

    const fromDecoded = convertBlueprint(data, decoded);
    const fromRaw = convertBlueprint(data, {
      format: 'text',
      meta: decoded.meta,
      body,
    });
    expect(fromDecoded.lines).toEqual(fromRaw.lines);
    expect(fromDecoded.totals.finalOutputsPerMin).toEqual(fromRaw.totals.finalOutputsPerMin);
    expect(fromDecoded.meta.shortDesc).toBe('齿轮线');
  });

  it('merges models of several blueprints into one rate picture', () => {
    const meta: BlueprintMeta = { timestampTicks: 0, gameVersion: 'x', shortDesc: '', longDesc: '', icon: { layout: 10, images: [0, 0, 0, 0, 0] } };
    const a = convertBlueprint(data, { format: 'text', meta, body: lineBody() });
    const b = convertBlueprint(data, { format: 'text', meta, body: lineBody() });
    const merged = mergeFactories([a, b]);
    const iron = merged.lines.find((l) => l.recipeKey === 'IronIngot')!;
    expect(iron.machines).toBe(4);
    expect(iron.rate.outputsPerMin).toEqual([{ item: 'IronIngot', count: 240 }]);
    expect(merged.totals.buildings).toBe(12);
    expect(merged.totals.finalOutputsPerMin).toEqual([{ item: 'Gear', count: 90 }]);
  });
});
