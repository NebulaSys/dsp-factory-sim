import { describe, expect, it } from 'vitest';
import { beltTravelDirection } from '../src/ui/glyphs.ts';
import type { FactoryModel, FactoryNode } from '../src/engine/factory.ts';

/**
 * Belt travel direction from the connection graph.
 *
 * The `yaw` field is not a usable 2-D rotation: measured against the real 2971-building
 * blueprint, every belt that links to a neighbour carries the same angle, and the
 * radians/zero-+x reading scores -0.797 against the measured travel direction (see
 * tools/solve-yaw-convention.ts). The link target is an exact object id with an exact
 * position, so the direction between two cells is measured, not assumed.
 *
 * These tests fix that preference order and the "unknown stays unknown" behaviour.
 */

function belt(index: number, x: number, y: number, outputsTo: number[] = [], yaw = 0): FactoryNode {
  return {
    index,
    kind: 'belt',
    buildingKey: 'ConveyorBeltMk1',
    buildingName: 'Conveyor Belt Mk.I',
    x,
    y,
    z: 0,
    yaw,
    footprint: { w: 1, h: 1 },
    outputsTo,
  } as FactoryNode;
}

function model(nodes: FactoryNode[]): FactoryModel {
  return { nodes } as FactoryModel;
}

describe('beltTravelDirection', () => {
  it('points a belt at the neighbour it links to', () => {
    // Belt 0 at the origin links to belt 1 one cell along +x.
    const m = model([belt(0, 0, 0, [1]), belt(1, 1, 0, [])]);
    const dirs = beltTravelDirection(m);
    const d = dirs.get(0);
    expect(d).toBeDefined();
    expect(d!.known).toBe(true);
    expect(d!.dx).toBeCloseTo(1, 9);
    expect(d!.dy).toBeCloseTo(0, 9);
  });

  it('normalises the direction rather than returning the raw delta', () => {
    const m = model([belt(0, 0, 0, [1]), belt(1, 3, 4, [])]);
    const d = beltTravelDirection(m).get(0)!;
    // 3-4-5 triangle: the direction must be unit length, not (3, 4).
    expect(Math.hypot(d.dx, d.dy)).toBeCloseTo(1, 9);
    expect(d.dx).toBeCloseTo(0.6, 9);
    expect(d.dy).toBeCloseTo(0.8, 9);
  });

  it('has no entry for a belt with no resolvable neighbour, so it stays unknown', () => {
    const m = model([belt(0, 0, 0, []), belt(1, 5, 5, [99])]);
    const dirs = beltTravelDirection(m);
    expect(dirs.has(0)).toBe(false);
    expect(dirs.has(1)).toBe(false);
  });

  it('ignores a neighbour that sits on the same cell', () => {
    // A zero-length direction cannot be normalised, so it must not produce an entry.
    const m = model([belt(0, 2, 2, [1]), belt(1, 2, 2, [])]);
    expect(beltTravelDirection(m).has(0)).toBe(false);
  });

  it('prefers the graph over the yaw field, which is contradicted by measurement', () => {
    // yaw 180 is what every linked belt actually stores in the real blueprint. The old
    // radians reading of it produces ~(-0.6, -0.8); the graph must win.
    const m = model([belt(0, 0, 0, [1], 180), belt(1, 0, 1, [])]);
    const d = beltTravelDirection(m).get(0)!;
    expect(d.dx).toBeCloseTo(0, 9);
    expect(d.dy).toBeCloseTo(1, 9);
  });

  it('only orients belts, never other kinds', () => {
    const producer = { ...belt(0, 0, 0, [1]), kind: 'producer' } as FactoryNode;
    const m = model([producer, belt(1, 1, 0, [])]);
    expect(beltTravelDirection(m).size).toBe(0);
  });

  it('uses the first resolvable link when several are recorded', () => {
    const m = model([belt(0, 0, 0, [99, 1]), belt(1, 0, 1, [])]);
    const d = beltTravelDirection(m).get(0)!;
    expect(d.dy).toBeCloseTo(1, 9);
  });
});
