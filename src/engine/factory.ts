/**
 * Blueprint → factory model conversion.
 *
 * A decoded blueprint is a flat list of placed buildings with prototype ids.
 * This module turns that into a structured factory: crafting machines grouped
 * with the recipe they are set to, logistics, power and belts, plus the
 * per-minute rates of every line, computed with the real engine math.
 *
 * Buildings whose prototype id is unknown to the dataset are preserved in
 * `unknown` so that nothing is silently dropped when a dataset is incomplete.
 */

import type { BlueprintBody, BlueprintBuilding, DecodedBlueprint } from './bp/codec.ts';
import type { BuildingCategory, BuildingDef, RateResult, RecipeDef } from './types.ts';

/**
 * Longest horizontal span accepted as a sorter arm, in grid cells.
 *
 * A sorter reaches 1-3 cells in game. Measured over 4427 sorters in 30 blueprints the horizontal
 * span between a record's two anchors is 1-3 cells for 96% of them, with the rest being genuine
 * outliers (a handful at 7.5-8) that are not arms and must not be drawn as long bars.
 */
const SORTER_ARM_MAX_CELLS = 3;
import type { GameData } from './registry.ts';
import { NEUTRAL_BONUSES, type ActiveBonuses } from './rules.ts';
import { computeProduction } from './production.ts';
import { FOOTPRINT_CALIBRATION } from './data/footprints.ts';

export type FactoryNodeKind =
  | 'producer'
  | 'belt'
  | 'sorter'
  | 'logistics'
  | 'power'
  | 'storage'
  | 'research'
  | 'other';

export interface FactoryNode {
  /** `BlueprintBuilding.index` — unique inside one blueprint. */
  index: number;
  kind: FactoryNodeKind;
  /** Building prototype key when the dataset knows the id, else null. */
  buildingKey: string | null;
  buildingName: string;
  itemId: number;
  category: BuildingCategory | 'unknown';
  x: number;
  y: number;
  z: number;
  yaw: number;
  /**
   * Footprint in grid cells (tile footprint, not the interaction box), when the
   * dataset or the calibration table knows it. The view draws each building at its
   * real size relative to the others (1 cell = 1 world unit, verified from a
   * ground-truth blueprint).
   */
  footprint?: { w: number; h: number };
  /** Where the footprint came from, so the view can flag approximations. */
  footprintSource?: 'measured' | 'documented' | 'estimated';
  /** Recipe set on the machine, when it is a crafting station. */
  recipeKey: string | null;
  /** Non-null only for kind === 'producer'. */
  production?: RateResult;
  /** Logistics station parameters, when present. */
  stationParameters?: number[];
  /** Ids of sorters that feed from this building. */
  inputsFrom: number[];
  /** Ids of buildings this one feeds into. */
  outputsTo: number[];
  /**
   * Where a sorter picks up and drops off, in grid coordinates.
   *
   * Stored on the node because sorters are routinely drawn while their endpoints are
   * filtered out of `nodes` (a belt-only or producer-only view), and the direction a
   * sorter points is its whole meaning in a schematic.
   */
  picksUpFrom?: { x: number; y: number };
  dropsOffAt?: { x: number; y: number };
  /**
   * The two ends of a sorter's arm, taken from the record's own anchors `(x, y, z)` and
   * `(x2, y2, z2)` rather than from its link fields.
   *
   * This is the only trustworthy source for the arm's shape. `outputObjectIndex` /
   * `inputObjectIndex` name the object a sorter is wired to logically, and measured against
   * real blueprints those targets are usually nowhere near the sorter (a p90 of 175 cells, and
   * 0 of 2390 references land on a neighbour), because several sorters feeding one belt all
   * point at the same belt record. The anchors instead describe the arm itself: across 4427
   * sorters in 30 blueprints the horizontal span is 1-3 cells for **96%** of them, which is
   * exactly a sorter's physical reach.
   *
   * Only set when the pair actually looks like an arm, so a malformed record cannot silently
   * become a long horizontal bar.
   */
  armFrom?: { x: number; y: number };
  armTo?: { x: number; y: number };
  /**
   * Unit travel direction of a belt, measured from its recorded link target.
   *
   * A belt records the object it feeds into as `outputObjectIndex`, and `inputObjectIndex`
   * is -1, so the generic two-endpoint link above never fires for belts. Carrying the
   * direction here keeps it available for every belt whose target position is known, even
   * when the target itself is filtered out of `nodes`.
   */
  travelDirection?: { dx: number; dy: number };
}

export interface FactoryLine {
  recipeKey: string;
  buildingKey: string | null;
  recipeName: string;
  /** How many buildings run this recipe. */
  machines: number;
  /** Aggregated per-minute rates for the whole line. */
  rate: RateResult;
}

export interface FactoryModel {
  meta: DecodedBlueprint['meta'] & {
    format: DecodedBlueprint['format'];
    hashWarning?: string;
  };
  nodes: FactoryNode[];
  lines: FactoryLine[];
  /** Proliferator applied to the whole factory (session setting). */
  proliferator: { markKey: string | null; mode: 'none' | 'extraProducts' | 'speedup' };
  bonuses: ActiveBonuses;
  totals: {
    buildings: number;
    producers: number;
    belts: number;
    sorters: number;
    logistics: number;
    powerBuildings: number;
    /** Total working power of crafting machines only (kW). */
    craftingPowerKW: number;
    /** Total ore/min, i.e. inputs that no recipe in this blueprint produces. */
    rawInputsPerMin: { item: string; count: number }[];
    /** Outputs not consumed by any machine in this blueprint. */
    finalOutputsPerMin: { item: string; count: number }[];
    /** Per-item production and consumption across the whole factory. */
    balance: { item: string; producedPerMin: number; consumedPerMin: number }[];
    boundingBox: { minX: number; minY: number; maxX: number; maxY: number };
    warnings: string[];
  };
  /** Buildings present in the blueprint that the dataset cannot identify. */
  unknown: { itemId: number; count: number }[];
}

export interface ConvertOptions {
  bonuses?: ActiveBonuses;
  proliferator?: { markKey?: string | null; mode?: 'none' | 'extraProducts' | 'speedup' };
  /** Uptime multiplier applied to every machine (default 1). */
  throughput?: number;
  /** Include belt/sorter/power buildings as nodes (default true). */
  includeNonProducers?: boolean;
}

const KIND_BY_CATEGORY: Record<string, FactoryNodeKind> = {
  production: 'producer',
  smelter: 'producer',
  chemical: 'producer',
  refinery: 'producer',
  collider: 'producer',
  fractionator: 'producer',
  research: 'research',
  belt: 'belt',
  sorter: 'sorter',
  logistics: 'logistics',
  storage: 'storage',
  power: 'power',
  mining: 'other',
  pump: 'other',
  extractor: 'other',
  turret: 'other',
  other: 'other',
};

function kindFor(category: BuildingCategory | 'unknown', hasRecipe: boolean): FactoryNodeKind {
  if (category === 'unknown') return 'other';
  const mapped = KIND_BY_CATEGORY[category];
  if (mapped === 'research') return 'research';
  if (mapped === 'producer') return 'producer';
  // A building that has a recipe set is a crafting station even if its category
  // is unusual (e.g. a lab running a matrix recipe is handled as 'research').
  if (hasRecipe && (category === 'other' || category === 'storage')) return 'producer';
  return mapped ?? 'other';
}

export function convertBlueprint(data: GameData, blueprint: DecodedBlueprint, options: ConvertOptions = {}): FactoryModel {
  const bonuses = options.bonuses ?? NEUTRAL_BONUSES;
  const proliferator = {
    markKey: options.proliferator?.markKey ?? null,
    mode: options.proliferator?.mode ?? 'none',
  } as const;
  const throughput = options.throughput ?? 1;
  const includeNonProducers = options.includeNonProducers !== false;
  const warnings: string[] = [];

  const nodes: FactoryNode[] = [];
  const unknownCounts = new Map<number, number>();
  const producersByRecipe = new Map<string, { machines: number; buildingKey: string | null }>();

  // Two passes: first build every node, then resolve sorter connections that
  // reference indices by object id.
  const byIndex = new Map<number, BlueprintBuilding>();
  for (const b of blueprint.body.buildings) byIndex.set(b.index, b);

  for (const b of blueprint.body.buildings) {
    const building = data.buildingByIdOrUndefined(b.itemId);
    if (!building) {
      unknownCounts.set(b.itemId, (unknownCounts.get(b.itemId) ?? 0) + 1);
      nodes.push({
        index: b.index,
        kind: 'other',
        buildingKey: null,
        buildingName: `Unknown #${b.itemId}`,
        itemId: b.itemId,
        category: 'unknown',
        x: b.x,
        y: b.y,
        z: b.z,
        yaw: b.yaw,
        recipeKey: null,
        inputsFrom: [],
        outputsTo: [],
      });
      continue;
    }

    const recipe: RecipeDef | undefined = b.recipeId ? data.recipeByIdOrUndefined(b.recipeId) : undefined;
    if (b.recipeId && !recipe) {
      warnings.push(`building #${b.index} (${building.key}) has unknown recipe_id ${b.recipeId}`);
    }

    const kind = kindFor(building.category, Boolean(recipe));
    const node: FactoryNode = {
      index: b.index,
      kind,
      buildingKey: building.key,
      buildingName: building.name,
      itemId: b.itemId,
      category: building.category,
      x: b.x,
      y: b.y,
      z: b.z,
      yaw: b.yaw,
      ...resolvedFootprint(building),
      recipeKey: recipe?.key ?? null,
      inputsFrom: [],
      outputsTo: [],
    };

    if (kind === 'producer' && recipe) {
      node.production = computeProduction(data, {
        recipe,
        machines: 1,
        building: building.key,
        proliferator: proliferator.mode === 'none' ? undefined : proliferator,
        bonuses,
        throughput,
      });
      warnings.push(...node.production.warnings.map((w) => `#${b.index}: ${w}`));
      const entry = producersByRecipe.get(recipe.key) ?? { machines: 0, buildingKey: building.key };
      entry.machines += 1;
      producersByRecipe.set(recipe.key, entry);
    }

    if (building.category === 'logistics' && b.parameters.length > 0) {
      node.stationParameters = b.parameters;
    }

    if (includeNonProducers || kind === 'producer' || kind === 'research') nodes.push(node);
  }

  // --- sorter connections -------------------------------------------------
  // A sorter's output_object_index / input_object_index are building *object*
  // ids (the `index` field) of its two endpoints. Either can be -1 (belt).
  // Endpoint positions are read from the raw records, not from `nodes`, because the
  // endpoints are often filtered out of the visible node list while the sorter
  // itself is still drawn.
  const nodeByIndex = new Map<number, FactoryNode>();
  for (const node of nodes) nodeByIndex.set(node.index, node);
  const positionByIndex = new Map<number, { x: number; y: number }>();
  for (const b of blueprint.body.buildings) positionByIndex.set(b.index, { x: b.x, y: b.y });

  for (const b of blueprint.body.buildings) {
    const sorterNode = nodeByIndex.get(b.index);
    const from = b.outputObjectIndex >= 0 ? nodeByIndex.get(b.outputObjectIndex) : undefined;
    const to = b.inputObjectIndex >= 0 ? nodeByIndex.get(b.inputObjectIndex) : undefined;
    if (from && to) {
      from.outputsTo.push(to.index);
      to.inputsFrom.push(from.index);
    }

    // A belt's travel direction is measured geometry, not a convention: it records the
    // object it feeds into, whose position is exact. `inputObjectIndex` is -1 for belts,
    // so the two-endpoint link above cannot supply this. The `yaw` field is not a usable
    // substitute — measured against this data it is in degrees bounded in [0, 360) and the
    // radians/zero-+x reading scores -0.797 against the true travel direction
    // (tools/solve-yaw-convention.ts).
    const beltNode = nodeByIndex.get(b.index);
    if (beltNode?.kind === 'belt' && b.outputObjectIndex >= 0) {
      const target = positionByIndex.get(b.outputObjectIndex);
      if (target) {
        const dx = target.x - b.x;
        const dy = target.y - b.y;
        const len = Math.hypot(dx, dy);
        if (len > 1e-6) beltNode.travelDirection = { dx: dx / len, dy: dy / len };
      }
    }
    if (sorterNode?.kind === 'sorter') {
      // A -1 endpoint is a belt, so fall back to the sorter's own cell for that end;
      // the direction still points the right way as long as one end is known.
      const pick = b.outputObjectIndex >= 0 ? positionByIndex.get(b.outputObjectIndex) : undefined;
      const drop = b.inputObjectIndex >= 0 ? positionByIndex.get(b.inputObjectIndex) : undefined;
      sorterNode.picksUpFrom = pick ?? { x: b.x, y: b.y };
      sorterNode.dropsOffAt = drop ?? { x: b.x, y: b.y };

      // The arm's real shape comes from the record's own two anchors, not from the link fields
      // above. Measured over 4427 sorters the horizontal span is 1-3 cells for 96% of them; the
      // link fields instead resolve to a distant belt for most sorters, which is why the view
      // used to draw them as in-place layer transfers.
      const armH = Math.hypot(b.x2 - b.x, b.y2 - b.y);
      const armV = Math.abs(b.z2 - b.z);
      if (armH >= 0.5 && armH <= SORTER_ARM_MAX_CELLS + 0.05 && armV <= 0.5) {
        sorterNode.armFrom = { x: b.x, y: b.y };
        sorterNode.armTo = { x: b.x2, y: b.y2 };
      }

      // Range-check the recorded slot indices against the building's real attachment
      // points. The count now comes from the slot geometry recovered out of the
      // shipped Unity assets (`SlotConfig.insertPoses` / `slotPoses`), which is the
      // same source the game itself reads; `sorterAttachSlots` alone is the
      // wiki-derived count and is used only where no geometry was recovered.
      if (b.outputToSlot >= 0 && from) {
        const host = data.buildingByIdOrUndefined(from.itemId);
        const limit = host?.sorterSlotPoses?.length ?? host?.sorterAttachSlots;
        if (limit !== undefined && b.outputToSlot >= limit) {
          warnings.push(
            `sorter #${b.index} uses output slot ${b.outputToSlot} on ${from.buildingName}, which has ${limit} sorter slots`,
          );
        }
      }
      if (b.inputFromSlot >= 0 && to) {
        const host = data.buildingByIdOrUndefined(to.itemId);
        const limit = host?.sorterSlotPoses?.length ?? host?.sorterAttachSlots;
        if (limit !== undefined && b.inputFromSlot >= limit) {
          warnings.push(
            `sorter #${b.index} uses input slot ${b.inputFromSlot} on ${to.buildingName}, which has ${limit} sorter slots`,
          );
        }
      }
    }
  }

  // --- aggregate lines ----------------------------------------------------
  const lines: FactoryLine[] = [];
  for (const [recipeKey, { machines, buildingKey }] of producersByRecipe) {
    const recipe = data.requireRecipe(recipeKey);
    const rate = computeProduction(data, {
      recipe,
      machines,
      building: buildingKey ?? undefined,
      proliferator: proliferator.mode === 'none' ? undefined : proliferator,
      bonuses,
      throughput,
    });
    lines.push({
      recipeKey,
      buildingKey,
      recipeName: recipe.name ?? recipe.key,
      machines,
      rate,
    });
  }
  lines.sort((a, b) => b.machines - a.machines);

  // --- totals -------------------------------------------------------------
  const produced = new Map<string, number>();
  const consumed = new Map<string, number>();
  let craftingPowerKW = 0;
  for (const line of lines) {
    craftingPowerKW += line.rate.totalPowerKW;
    for (const out of line.rate.outputsPerMin) produced.set(out.item, (produced.get(out.item) ?? 0) + out.count);
    for (const inp of line.rate.inputsPerMin) consumed.set(inp.item, (consumed.get(inp.item) ?? 0) + inp.count);
  }
  const allItems = new Set([...produced.keys(), ...consumed.keys()]);
  const balance = [...allItems]
    .map((item) => ({
      item,
      producedPerMin: produced.get(item) ?? 0,
      consumedPerMin: consumed.get(item) ?? 0,
    }))
    .sort((a, b) => a.item.localeCompare(b.item));
  const rawInputsPerMin = balance
    .filter((row) => row.producedPerMin === 0 && row.consumedPerMin > 0)
    .map((row) => ({ item: row.item, count: round(row.consumedPerMin) }));
  const finalOutputsPerMin = balance
    .filter((row) => row.consumedPerMin === 0 && row.producedPerMin > 0)
    .map((row) => ({ item: row.item, count: round(row.producedPerMin) }));
  const surplus = balance
    .filter((row) => row.producedPerMin > 0 && row.consumedPerMin > 0 && row.producedPerMin > row.consumedPerMin + 1e-9)
    .map((row) => ({ item: row.item, count: round(row.producedPerMin - row.consumedPerMin) }));

  const bbox = boundingBox(blueprint.body);

  return {
    meta: { ...blueprint.meta, format: blueprint.format, hashWarning: blueprint.hashWarning },
    nodes,
    lines,
    proliferator: { markKey: proliferator.markKey, mode: proliferator.mode },
    bonuses,
    totals: {
      buildings: blueprint.body.buildings.length,
      producers: nodes.filter((n) => n.kind === 'producer').length,
      belts: nodes.filter((n) => n.kind === 'belt').length,
      sorters: nodes.filter((n) => n.kind === 'sorter').length,
      logistics: nodes.filter((n) => n.kind === 'logistics').length,
      powerBuildings: nodes.filter((n) => n.kind === 'power').length,
      craftingPowerKW: round(craftingPowerKW),
      rawInputsPerMin,
      finalOutputsPerMin,
      balance,
      boundingBox: bbox,
      warnings,
    },
    unknown: [...unknownCounts.entries()].map(([itemId, count]) => ({ itemId, count })).sort((a, b) => b.count - a.count),
  };
}

function round(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/**
 * Resolve a building's tile footprint.
 *
 * Preference order:
 *  1. the calibration table (tile footprints, with provenance),
 *  2. the dataset footprint (the game's prefab `selectSize`, which is the
 *     interaction box and is usually within about a cell of the tile count).
 */
export function resolvedFootprint(building: BuildingDef): { footprint?: { w: number; h: number }; footprintSource?: 'measured' | 'documented' | 'estimated' } {
  const calibrated = FOOTPRINT_CALIBRATION[building.key];
  if (calibrated) {
    return { footprint: { w: calibrated.w, h: calibrated.h }, footprintSource: calibrated.source };
  }
  if (building.footprint && building.footprint.w > 0 && building.footprint.h > 0) {
    return { footprint: building.footprint, footprintSource: 'estimated' };
  }
  return {};
}

export function boundingBox(body: BlueprintBody): { minX: number; minY: number; maxX: number; maxY: number } {
  if (body.buildings.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of body.buildings) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x);
    maxY = Math.max(maxY, b.y);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Aggregate several blueprints (e.g. a whole "early game to copper" pack) into
 * one factory model, so the user can see the combined rate picture.
 */
export function mergeFactories(models: FactoryModel[]): FactoryModel {
  if (models.length === 0) throw new Error('mergeFactories needs at least one model');
  if (models.length === 1) return models[0]!;

  const nodes = models.flatMap((m) => m.nodes);
  const lineByRecipe = new Map<string, FactoryLine>();
  for (const model of models) {
    for (const line of model.lines) {
      const existing = lineByRecipe.get(line.recipeKey);
      if (!existing) {
        lineByRecipe.set(line.recipeKey, { ...line, rate: { ...line.rate } });
        continue;
      }
      existing.machines += line.machines;
      existing.rate = {
        ...existing.rate,
        machines: existing.rate.machines + line.rate.machines,
        outputsPerMin: sumIO(existing.rate.outputsPerMin, line.rate.outputsPerMin),
        inputsPerMin: sumIO(existing.rate.inputsPerMin, line.rate.inputsPerMin),
        totalPowerKW: existing.rate.totalPowerKW + line.rate.totalPowerKW,
        proliferator: {
          ...existing.rate.proliferator,
          spraysPerMin: existing.rate.proliferator.spraysPerMin + line.rate.proliferator.spraysPerMin,
        },
        warnings: [...existing.rate.warnings, ...line.rate.warnings],
      };
    }
  }
  const lines = [...lineByRecipe.values()].sort((a, b) => b.machines - a.machines);

  const produced = new Map<string, number>();
  const consumed = new Map<string, number>();
  let craftingPowerKW = 0;
  for (const line of lines) {
    craftingPowerKW += line.rate.totalPowerKW;
    for (const out of line.rate.outputsPerMin) produced.set(out.item, (produced.get(out.item) ?? 0) + out.count);
    for (const inp of line.rate.inputsPerMin) consumed.set(inp.item, (consumed.get(inp.item) ?? 0) + inp.count);
  }
  const allItems = new Set([...produced.keys(), ...consumed.keys()]);
  const balance = [...allItems]
    .map((item) => ({
      item,
      producedPerMin: produced.get(item) ?? 0,
      consumedPerMin: consumed.get(item) ?? 0,
    }))
    .sort((a, b) => a.item.localeCompare(b.item));

  const first = models[0]!;
  return {
    meta: first.meta,
    nodes,
    lines,
    proliferator: first.proliferator,
    bonuses: first.bonuses,
    totals: {
      buildings: models.reduce((s, m) => s + m.totals.buildings, 0),
      producers: models.reduce((s, m) => s + m.totals.producers, 0),
      belts: models.reduce((s, m) => s + m.totals.belts, 0),
      sorters: models.reduce((s, m) => s + m.totals.sorters, 0),
      logistics: models.reduce((s, m) => s + m.totals.logistics, 0),
      powerBuildings: models.reduce((s, m) => s + m.totals.powerBuildings, 0),
      craftingPowerKW: round(craftingPowerKW),
      rawInputsPerMin: balance
        .filter((r) => r.producedPerMin === 0 && r.consumedPerMin > 0)
        .map((r) => ({ item: r.item, count: round(r.consumedPerMin) })),
      finalOutputsPerMin: balance
        .filter((r) => r.consumedPerMin === 0 && r.producedPerMin > 0)
        .map((r) => ({ item: r.item, count: round(r.producedPerMin) })),
      balance,
      boundingBox: first.totals.boundingBox,
      warnings: models.flatMap((m) => m.totals.warnings),
    },
    unknown: models.flatMap((m) => m.unknown),
  };
}

function sumIO(
  a: readonly { item: string; count: number }[],
  b: readonly { item: string; count: number }[],
): { item: string; count: number }[] {
  const map = new Map<string, number>();
  for (const io of a) map.set(io.item, (map.get(io.item) ?? 0) + io.count);
  for (const io of b) map.set(io.item, (map.get(io.item) ?? 0) + io.count);
  return [...map.entries()].map(([item, count]) => ({ item, count: round(count) }));
}
