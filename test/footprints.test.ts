import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadDataset } from '../src/engine/loader.ts';
import { convertBlueprint, resolvedFootprint } from '../src/engine/factory.ts';
import { decodeBlueprint } from '../src/engine/bp/codec.ts';
import datasetJson from '../src/engine/data/dsp-vanilla.json';
import { FOOTPRINT_CALIBRATION } from '../src/engine/data/footprints.ts';
import { viewTransform, footprintOf, layoutBounds } from '../src/ui/canvas.ts';

const data = loadDataset(datasetJson);

/**
 * The production-line view draws one grid cell as one unit and scales every
 * building by its tile footprint, so these invariants are what make the picture
 * proportionally faithful to the game.
 */
describe('footprint model behind the production-line view', () => {
  it('draws a belt at exactly one cell and an assembler at three', () => {
    const belt = footprintOf({ index: 0, footprint: { w: 1, h: 1 } } as never);
    expect(belt).toEqual({ w: 1, h: 1 });
    const assembler = footprintOf({ index: 0, footprint: { w: 3, h: 3 } } as never);
    expect(assembler).toEqual({ w: 3, h: 3 });
    // The ratio is the whole point: 3x3 must be three times 1x1.
    expect(assembler.w / belt.w).toBe(3);
  });

  it('calibrates the interaction box down to the real tile count', () => {
    // The game's prefab selectSize reads 4.2 for an Assembling Machine, but it
    // occupies 3x3 tiles.
    const datasetBuilding = data.requireBuilding('AssemblingMachineMk1');
    expect(datasetBuilding.footprint).toEqual({ w: 4, h: 4 });
    const resolved = resolvedFootprint(datasetBuilding);
    expect(resolved.footprint).toEqual({ w: 3, h: 3 });
    expect(resolved.footprintSource).toBe('documented');
  });

  it('keeps belts and sorters at one cell, matching the measured grid', () => {
    for (const key of ['ConveyorBeltMk1', 'ConveyorBeltMk2', 'ConveyorBeltMk3', 'SorterMk1', 'SorterMk2', 'SorterMk3']) {
      const resolved = resolvedFootprint(data.requireBuilding(key));
      expect(resolved.footprint, key).toEqual({ w: 1, h: 1 });
      expect(resolved.footprintSource, key).toBe('measured');
    }
  });

  it('falls back to the dataset footprint for uncalibrated buildings', () => {
    const resolved = resolvedFootprint(data.requireBuilding('OilRefinery'));
    expect(resolved.footprint).toEqual({ w: 4, h: 7 });
    expect(resolved.footprintSource).toBe('documented');
    // A building with neither source still renders (as one cell) rather than vanish.
    const fallback = footprintOf({ index: 0 } as never);
    expect(fallback).toEqual({ w: 1, h: 1 });
  });

  it('every calibration entry names a building that exists in the dataset', () => {
    const unknown = Object.keys(FOOTPRINT_CALIBRATION).filter((key) => !data.building(key));
    expect(unknown).toEqual([]);
  });

  it('measures the real grid from the ground-truth blueprint: 1 cell = 1 world unit', async () => {
    const text = readFileSync(resolve(import.meta.dirname, 'fixtures/reference-blueprint.txt'), 'utf8');
    const decoded = await decodeBlueprint(text);
    const belts = decoded.body.buildings.filter((b) => b.itemId > 2000 && b.itemId < 2010);
    expect(belts.length).toBeGreaterThan(1);
    // Consecutive belts in a run must be exactly one cell apart on one axis.
    const xs = [...new Set(belts.map((b) => Math.round(b.x * 1000) / 1000))].sort((a, b) => a - b);
    const ys = [...new Set(belts.map((b) => Math.round(b.y * 1000) / 1000))].sort((a, b) => a - b);
    const minGap = (values: number[]): number => {
      let best = Infinity;
      for (let i = 1; i < values.length; i++) best = Math.min(best, values[i]! - values[i - 1]!);
      return best;
    };
    expect(minGap(xs)).toBeCloseTo(1, 2);
    expect(minGap(ys)).toBeCloseTo(1, 2);
  });

  it('bounds the layout by building extents, not just centres', () => {
    // Two 3x3 buildings centred on the same point: the box must be 3 cells wide,
    // not 0 width, otherwise the fit would divide by a span of zero.
    const model = {
      nodes: [
        { index: 0, x: 0, y: 0, footprint: { w: 3, h: 3 } },
        { index: 1, x: 0, y: 0, footprint: { w: 3, h: 3 } },
      ],
    } as never;
    const bounds = layoutBounds(model);
    expect(bounds.maxX - bounds.minX).toBeCloseTo(3, 6);
    expect(bounds.maxY - bounds.minY).toBeCloseTo(3, 6);
    // A degenerate layout must still produce a usable transform.
    const view = viewTransform(model, 800, 600, 1);
    expect(Number.isFinite(view.scale)).toBe(true);
    expect(view.scale).toBeGreaterThan(0);
  });

  it('scales the fit linearly so relative sizes survive zoom', () => {
    const model = {
      nodes: [
        { index: 0, x: 0, y: 0, footprint: { w: 3, h: 3 } },
        { index: 1, x: 10, y: 10, footprint: { w: 1, h: 1 } },
      ],
    } as never;
    const a = viewTransform(model, 800, 600, 1);
    const b = viewTransform(model, 800, 600, 2);
    expect(b.scale).toBeCloseTo(a.scale * 2, 6);
  });

  it('carries the footprint through blueprint conversion', async () => {
    const text = readFileSync(resolve(import.meta.dirname, 'fixtures/reference-blueprint.txt'), 'utf8');
    const decoded = await decodeBlueprint(text);
    const model = convertBlueprint(data, decoded);
    expect(model.nodes).toHaveLength(37);
    const belt = model.nodes[0]!;
    expect(belt.footprint).toEqual({ w: 1, h: 1 });
    expect(belt.footprintSource).toBe('measured');
  });
});
