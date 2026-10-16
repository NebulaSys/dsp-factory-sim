import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYER_SEPARATION, layerInfo, layerOffset, layoutBounds } from '../src/ui/canvas.ts';
import type { FactoryModel, FactoryNode } from '../src/engine/factory.ts';

/**
 * Vertical-layer separation.
 *
 * Real blueprints in the corpus are frequently vertical stacks ("堆叠蓝图"): 30,003 of
 * 33,451 decoded buildings share an (x, y) footprint with a building at another height.
 * A plain top-down view draws them on top of each other, so the renderer offsets each
 * layer diagonally. These tests fix the behaviour that offset depends on.
 */

function node(partial: Partial<FactoryNode> & { index: number; x: number; y: number; z: number }): FactoryNode {
  return {
    kind: 'producer',
    buildingKey: 'ArcSmelter',
    buildingName: 'Arc Smelter',
    footprint: { w: 3, h: 3 },
    ...partial,
  } as FactoryNode;
}

function model(nodes: FactoryNode[]): FactoryModel {
  return { nodes } as FactoryModel;
}

describe('layerInfo', () => {
  it('reports a flat layout as one layer with nothing stacked', () => {
    const info = layerInfo(model([node({ index: 0, x: 0, y: 0, z: 0 }), node({ index: 1, x: 4, y: 0, z: 0 })]));
    expect(info.layers).toBe(1);
    expect(info.stacked).toBe(0);
  });

  it('counts buildings that share an (x, y) footprint at different heights', () => {
    // Three buildings on one cell at three heights: two of them are "extra" layers.
    const info = layerInfo(
      model([
        node({ index: 0, x: 0, y: 0, z: 0 }),
        node({ index: 1, x: 4, y: 0, z: 0 }),
        node({ index: 2, x: 0, y: 0, z: 8 }),
      ]),
    );
    expect(info.layers).toBe(2);
    expect(info.stacked).toBe(1);
    expect(info.minZ).toBe(0);
    expect(info.maxZ).toBe(8);
  });

  it('does not treat the same height at different cells as stacked', () => {
    const info = layerInfo(
      model([
        node({ index: 0, x: 0, y: 0, z: 5 }),
        node({ index: 1, x: 10, y: 0, z: 5 }),
        node({ index: 2, x: 20, y: 0, z: 5 }),
      ]),
    );
    expect(info.layers).toBe(1);
    expect(info.stacked).toBe(0);
  });

  it('handles fractional heights, which appear in real blueprints', () => {
    const info = layerInfo(
      model([
        node({ index: 0, x: 0, y: 0, z: -0.00011383649 }),
        node({ index: 1, x: 0, y: 0, z: 8.0 }),
        node({ index: 2, x: 0, y: 0, z: 16.0 }),
      ]),
    );
    expect(info.layers).toBe(3);
    expect(info.stacked).toBe(2);
  });

  it('is empty for an empty model', () => {
    expect(layerInfo(model([]))).toEqual({ layers: 0, stacked: 0, minZ: 0, maxZ: 0 });
  });
});

describe('layerOffset', () => {
  it('is the identity when separation is off', () => {
    const offset = layerOffset(model([node({ index: 0, x: 1, y: 2, z: 9 })]), 0);
    expect(offset(node({ index: 0, x: 1, y: 2, z: 9 }))).toEqual({ dx: 0, dy: 0 });
  });

  it('separates two layers in opposite directions, centred on zero', () => {
    const m = model([node({ index: 0, x: 0, y: 0, z: 0 }), node({ index: 1, x: 0, y: 0, z: 10 })]);
    const offset = layerOffset(m, 1);
    // Middle of the spread is the average, so the two layers move apart symmetrically.
    expect(offset(m.nodes[0]!)).toEqual({ dx: -0.5, dy: 0.5 });
    expect(offset(m.nodes[1]!)).toEqual({ dx: 0.5, dy: -0.5 });
  });

  it('keeps the lowest layer at the origin when there is only one layer', () => {
    const m = model([node({ index: 0, x: 0, y: 0, z: 4 })]);
    const offset = layerOffset(m, DEFAULT_LAYER_SEPARATION);
    const { dx, dy } = offset(m.nodes[0]!);
    // Compare numerically: a single layer produces -0 for the negated component, which
    // is the same offset but not deep-equal to 0.
    expect(Math.abs(dx)).toBe(0);
    expect(Math.abs(dy)).toBe(0);
  });

  it('gives buildings in the same layer the same offset', () => {
    const m = model([
      node({ index: 0, x: 0, y: 0, z: 0 }),
      node({ index: 1, x: 5, y: 5, z: 0 }),
      node({ index: 2, x: 0, y: 0, z: 4 }),
    ]);
    const offset = layerOffset(m, 1);
    expect(offset(m.nodes[0]!)).toEqual(offset(m.nodes[1]!));
    expect(offset(m.nodes[0]!)).not.toEqual(offset(m.nodes[2]!));
  });
});

describe('layoutBounds with an offset', () => {
  it('grows to include the offset buildings, so an exploded view still fits', () => {
    const m = model([node({ index: 0, x: 0, y: 0, z: 0 }), node({ index: 1, x: 0, y: 0, z: 20 })]);
    const plain = layoutBounds(m);
    const offset = layerOffset(m, 4);
    const exploded = layoutBounds(m, offset);
    expect(exploded.maxX).toBeGreaterThan(plain.maxX);
    expect(exploded.minY).toBeLessThan(plain.minY);
  });

  it('matches the plain bounds when there is no offset', () => {
    const m = model([node({ index: 0, x: 3, y: 7, z: 0 })]);
    expect(layoutBounds(m, () => ({ dx: 0, dy: 0 }))).toEqual(layoutBounds(m));
  });
});
