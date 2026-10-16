/**
 * Production planning: "I want N of X per minute — what do I need to build?"
 *
 * The planner walks backwards from a target item through the recipe graph,
 * aggregating demand per item, and only then sizes machines. That ordering
 * matters: sizing while walking would round every intermediate up to a whole
 * machine and inflate the demand of everything downstream (asking for 15
 * matrices/min would demand 20 coils/min). Demand stays fractional here; only
 * the machine counts and the shopping list are rounded up.
 *
 * Ore, fluids and anything with no available producer become raw resources.
 * Cycles (Deuterium ⇄ Fractionator, Graphene ⇄ Carbon Nanotube, X-Ray Cracking)
 * are cut with a `cycle` marker so the user is told where the math stopped.
 */

import type { FacilityKey, ProliferatorMode, RecipeDef, RecipeIO } from './types.ts';
import { GameDataError, type GameData } from './registry.ts';
import { NEUTRAL_BONUSES, type ActiveBonuses } from './rules.ts';
import { computeProduction, machinesForRate, round } from './production.ts';

export type PlanNodeKind = 'recipe' | 'raw' | 'cycle';

export interface PlanNode {
  id: string;
  kind: PlanNodeKind;
  item: string;
  itemName: string;
  /** How much of this item the factory needs per minute. */
  requiredPerMin: number;
  /**
   * How much the sized machines actually produce per minute. Higher than
   * `requiredPerMin` whenever the machine count was rounded up to a whole
   * building — that surplus is what the UI should show as spare capacity.
   */
  suppliedPerMin?: number;
  /** Recipe used to make it (kind === 'recipe'). */
  recipeKey?: string;
  recipeName?: string;
  buildingKey?: string | null;
  facility?: FacilityKey;
  /** Fractional machine count needed for the true demand. */
  machines?: number;
  /** Whole buildings required. */
  machinesCeil?: number;
  /** Recipe runs per minute for the whole node. */
  craftsPerMin?: number;
  /** Inputs this node has to be fed with, per minute. */
  inputsPerMin?: RecipeIO[];
  children: PlanNode[];
  /** Byproducts of the chosen recipe that also feed other nodes. */
  byproducts?: RecipeIO[];
  powerKW?: number;
  note?: string;
}

export interface PlanOptions {
  target: string;
  targetPerMin: number;
  /** Allow alternate/rare recipes. Default false (vanilla default recipes). */
  allowAlternates?: boolean;
  /** Explicit recipe key per output item. */
  recipeOverrides?: Record<string, string>;
  /** Override the building that runs a recipe (key = recipe key). */
  facilityOverrides?: Record<string, string>;
  /** Proliferator applied to every production machine. */
  proliferator?: { markKey?: string | null; mode?: ProliferatorMode };
  bonuses?: ActiveBonuses;
  /** Items to treat as raw even if a recipe exists (e.g. shipped in by logistics). */
  rawItems?: Iterable<string>;
  /** Items already available per minute from an external source (byproducts, imports). */
  externalSupplyPerMin?: Record<string, number>;
  /** How many levels deep to expand before treating inputs as raw. */
  maxDepth?: number;
}

export interface PlanResult {
  target: string;
  targetPerMin: number;
  /** The dependency tree rooted at the target. */
  root: PlanNode;
  /** Every node of the tree, depth first. */
  nodes: PlanNode[];
  /** Raw resources the plan consumes per minute. */
  rawResources: { item: string; perMin: number }[];
  /** Total working power of all crafting machines (kW). */
  totalPowerKW: number;
  /** Total whole buildings required. */
  totalMachines: number;
  /** Aggregated per-minute demand/flow of every item. */
  balance: { item: string; demandedPerMin: number; suppliedPerMin: number; externalPerMin: number }[];
  /** Shopping list of crafting buildings. */
  buildingList: { buildingKey: string; count: number }[];
  /** Total proliferator sprays needed per minute. */
  spraysPerMin: number;
  /** Per-recipe totals, one row per recipe used by the plan. */
  recipeTotals: {
    recipeKey: string;
    buildingKey: string | null;
    machines: number;
    machinesCeil: number;
    craftsPerMin: number;
    powerKW: number;
  }[];
  warnings: string[];
}

const EPSILON = 1e-9;

interface DemandRecord {
  item: string;
  /** Total required per minute before external supply. */
  requiredPerMin: number;
  recipe: RecipeDef | null;
  /** Tree nodes that demand this item (for wiring children). */
  demandNodes: PlanNode[];
}

export function buildPlan(data: GameData, options: PlanOptions): PlanResult {
  if (!(options.targetPerMin > 0)) throw new GameDataError('targetPerMin must be > 0');
  const targetItem = data.requireItem(options.target);
  const bonuses = options.bonuses ?? NEUTRAL_BONUSES;
  const rawSet = new Set(options.rawItems ?? []);
  const external = new Map(Object.entries(options.externalSupplyPerMin ?? {}));
  const maxDepth = options.maxDepth ?? 32;

  const nodes: PlanNode[] = [];
  const warnings: string[] = [];
  /** demand per item, in the order items were first discovered */
  const demand = new Map<string, DemandRecord>();
  let seq = 0;

  const root: PlanNode = {
    id: `root:${options.target}`,
    kind: 'recipe',
    item: options.target,
    itemName: targetItem.name,
    requiredPerMin: options.targetPerMin,
    children: [],
  };

  // ---------------------------------------------------------------------
  // Phase 1 — walk the recipe graph, accumulating demand per item.
  // ---------------------------------------------------------------------

  function recordDemand(item: string, amount: number, node: PlanNode, recipe: RecipeDef | null): void {
    const existing = demand.get(item);
    if (existing) {
      existing.requiredPerMin += amount;
      if (recipe) existing.recipe = recipe;
      existing.demandNodes.push(node);
      return;
    }
    demand.set(item, { item, requiredPerMin: amount, recipe, demandNodes: [node] });
  }

  /** Returns the node created for `item` (or null when it is raw). */
  function expand(item: string, amountPerMin: number, depth: number, path: ReadonlySet<string>): PlanNode | null {
    const itemDef = data.item(item);
    const name = itemDef?.name ?? item;

    const recipe = chooseRecipe(data, item, options);
    const treatAsRaw = !recipe || rawSet.has(item) || recipe.facility === 'MiningMachine' || depth >= maxDepth;

    const node: PlanNode = {
      id: `n${seq++}`,
      kind: treatAsRaw ? 'raw' : 'recipe',
      item,
      itemName: name,
      requiredPerMin: round(amountPerMin, 6),
      children: [],
    };
    nodes.push(node);

    if (treatAsRaw) {
      recordDemand(item, amountPerMin, node, null);
      return node;
    }

    if (path.has(item)) {
      node.kind = 'cycle';
      node.note = `循环依赖：${item} 的链条回到自身（${[...path].join(' → ')} → ${item}），此处按外部输入处理`;
      warnings.push(node.note);
      recordDemand(item, amountPerMin, node, recipe);
      return node;
    }

    recordDemand(item, amountPerMin, node, recipe);
    node.recipeKey = recipe.key;
    node.recipeName = recipe.name ?? recipe.key;

    // Inputs needed to produce `amountPerMin` of `item` — computed from the TRUE
    // output rate, not from a rounded machine count.
    const oneMachine = computeProduction(data, {
      recipe,
      machines: 1,
      building: options.facilityOverrides?.[recipe.key],
      proliferator: options.proliferator,
      bonuses,
    });
    const perMachineOutput = oneMachine.outputsPerMin.find((o) => o.item === item)?.count ?? 0;
    if (perMachineOutput <= EPSILON) {
      node.kind = 'raw';
      node.note = `配方 ${recipe.key} 不产出 ${item}，按外部输入处理`;
      warnings.push(node.note);
      return node;
    }
    const scale = amountPerMin / perMachineOutput;
    node.inputsPerMin = oneMachine.inputsPerMin.map((io) => ({ item: io.item, count: round(io.count * scale, 6) }));
    node.byproducts = oneMachine.outputsPerMin
      .filter((o) => o.item !== item)
      .map((o) => ({ item: o.item, count: round(o.count * scale, 6) }));

    const nextPath = new Set(path);
    nextPath.add(item);
    for (const inp of node.inputsPerMin) {
      const child = expand(inp.item, inp.count, depth + 1, nextPath);
      if (child) node.children.push(child);
    }
    return node;
  }

  const rootRecipe = chooseRecipe(data, options.target, options);
  if (!rootRecipe) {
    root.kind = 'raw';
    root.note = '目标物品没有可用配方，只能采集/外部输入';
    warnings.push(root.note);
    recordDemand(options.target, options.targetPerMin, root, null);
    return {
      target: options.target,
      targetPerMin: options.targetPerMin,
      root,
      nodes: [root],
      rawResources: [{ item: options.target, perMin: round(options.targetPerMin, 6) }],
      totalPowerKW: 0,
      totalMachines: 0,
      balance: [
        {
          item: options.target,
          demandedPerMin: round(options.targetPerMin, 6),
          suppliedPerMin: 0,
          externalPerMin: round(external.get(options.target) ?? 0, 6),
        },
      ],
      buildingList: [],
      spraysPerMin: 0,
      recipeTotals: [],
      warnings,
    };
  }

  const targetNode = expand(options.target, options.targetPerMin, 0, new Set());
  if (targetNode) {
    root.kind = targetNode.kind;
    root.recipeKey = targetNode.recipeKey;
    root.recipeName = targetNode.recipeName;
    root.children = targetNode.children;
    root.inputsPerMin = targetNode.inputsPerMin;
    root.byproducts = targetNode.byproducts;
    root.note = targetNode.note;
  }

  // ---------------------------------------------------------------------
  // Phase 2 — size every recipe from the aggregated demand.
  // ---------------------------------------------------------------------

  let totalPowerKW = 0;
  let totalMachines = 0;
  let spraysPerMin = 0;
  const machinesByBuilding = new Map<string, number>();
  const recipeTotals: PlanResult['recipeTotals'] = [];
  const supplied = new Map<string, number>();

  const nodeByItem = new Map<string, PlanNode[]>();
  for (const node of nodes) {
    const list = nodeByItem.get(node.item) ?? [];
    list.push(node);
    nodeByItem.set(node.item, list);
  }

  for (const record of demand.values()) {
    if (!record.recipe) continue;

    const recipe = record.recipe;
    const buildingKey = options.facilityOverrides?.[recipe.key];
    const { machines } = machinesForRate(data, {
      recipe,
      targetPerMin: record.requiredPerMin,
      targetItem: record.item,
      building: buildingKey,
      proliferator: options.proliferator,
      bonuses,
    });
    if (!(machines > 0)) continue;
    const ceil = Math.ceil(machines - EPSILON);

    const machineInfo = computeProduction(data, {
      recipe,
      machines: 1,
      building: buildingKey,
      proliferator: options.proliferator,
      bonuses,
    });
    const powerKW = machineInfo.totalPowerKW * machines;
    const craftsPerMin = machineInfo.craftsPerMinPerMachine * machines;
    totalPowerKW += powerKW;
    spraysPerMin += machineInfo.proliferator.spraysPerMin * machines;
    if (machineInfo.buildingKey) {
      machinesByBuilding.set(machineInfo.buildingKey, (machinesByBuilding.get(machineInfo.buildingKey) ?? 0) + ceil);
    }
    totalMachines += ceil;
    recipeTotals.push({
      recipeKey: recipe.key,
      buildingKey: machineInfo.buildingKey,
      machines: round(machines, 6),
      machinesCeil: ceil,
      craftsPerMin: round(craftsPerMin, 6),
      powerKW: round(powerKW, 6),
    });
    const out = machineInfo.outputsPerMin.find((o) => o.item === record.item)?.count ?? 0;
    supplied.set(record.item, (supplied.get(record.item) ?? 0) + out * machines);
    for (const w of machineInfo.warnings) warnings.push(`${recipe.key}: ${w}`);
  }

  // Write sizing back onto the tree nodes.
  for (const node of nodes) {
    if (node.kind !== 'recipe' || !node.recipeKey) continue;
    const total = recipeTotals.find((r) => r.recipeKey === node.recipeKey);
    if (!total) continue;
    node.buildingKey = total.buildingKey;
    node.machines = total.machines;
    node.machinesCeil = total.machinesCeil;
    node.craftsPerMin = total.craftsPerMin;
    const totalDemand = demand.get(node.item)?.requiredPerMin ?? node.requiredPerMin;
    const share = totalDemand > 0 ? node.requiredPerMin / totalDemand : 0;
    node.powerKW = round(total.powerKW * share, 6);
    // Capacity of the sized (whole) machines for this item, scaled to the node's share.
    const fullCapacity = supplied.get(node.item) ?? 0;
    node.suppliedPerMin = round(fullCapacity * share, 6);
  }
  if (root.recipeKey) {
    const total = recipeTotals.find((r) => r.recipeKey === root.recipeKey);
    if (total) {
      root.machines = total.machines;
      root.machinesCeil = total.machinesCeil;
      root.craftsPerMin = total.craftsPerMin;
      root.powerKW = total.powerKW;
      const info = computeProduction(data, {
        recipe: data.requireRecipe(root.recipeKey),
        machines: 1,
        proliferator: options.proliferator,
        bonuses,
      });
      root.facility = data.requireRecipe(root.recipeKey).facility;
      root.buildingKey = info.buildingKey;
    }
  }

  // ---------------------------------------------------------------------
  // Phase 3 — raw resources and item balance.
  // ---------------------------------------------------------------------

  const rawResources: { item: string; perMin: number }[] = [];
  const balance: PlanResult['balance'] = [];
  for (const record of demand.values()) {
    const suppliedHere = supplied.get(record.item) ?? 0;
    const externalAvailable = options.externalSupplyPerMin?.[record.item] ?? 0;
    // External supply only matters for the part of the demand no recipe covers.
    const externalUsed = Math.max(0, Math.min(externalAvailable, record.requiredPerMin - suppliedHere));
    if (!record.recipe) {
      rawResources.push({ item: record.item, perMin: round(Math.max(0, record.requiredPerMin - externalUsed), 6) });
    }
    balance.push({
      item: record.item,
      demandedPerMin: round(record.requiredPerMin, 6),
      suppliedPerMin: round(suppliedHere, 6),
      externalPerMin: round(externalUsed, 6),
    });
  }

  // Items consumed as inputs but never demanded as an output (shouldn't happen,
  // but keeps the balance honest if a recipe has an input with no producer).
  for (const node of nodes) {
    for (const inp of node.inputsPerMin ?? []) {
      if (!balance.some((b) => b.item === inp.item)) {
        balance.push({ item: inp.item, demandedPerMin: round(inp.count, 6), suppliedPerMin: 0, externalPerMin: 0 });
      }
    }
  }

  return {
    target: options.target,
    targetPerMin: options.targetPerMin,
    root,
    nodes,
    rawResources: rawResources.sort((a, b) => b.perMin - a.perMin),
    totalPowerKW: round(totalPowerKW, 6),
    totalMachines,
    balance: balance.sort((a, b) => a.item.localeCompare(b.item)),
    buildingList: [...machinesByBuilding.entries()]
      .map(([buildingKey, count]) => ({ buildingKey, count }))
      .sort((a, b) => b.count - a.count || a.buildingKey.localeCompare(b.buildingKey)),
    spraysPerMin: round(spraysPerMin, 6),
    recipeTotals,
    warnings,
  };
}

/**
 * Pick the recipe that will produce `item`.
 *
 * Preference order:
 *  1. an explicit override,
 *  2. the default (non alternate) recipe that yields the most per second,
 *  3. the highest-yielding alternate recipe, when alternates are enabled.
 */
export function chooseRecipe(
  data: GameData,
  item: string,
  options: Pick<PlanOptions, 'recipeOverrides' | 'allowAlternates'> = {},
): RecipeDef | null {
  const override = options.recipeOverrides?.[item];
  if (override) {
    const recipe = data.recipe(override);
    if (recipe) return recipe;
  }
  const candidates = data.recipesProducing(item).filter((r) => {
    if (r.facility === 'None' || r.facility === 'MiningMachine') return false;
    if (!options.allowAlternates && r.isDefault === false) return false;
    return true;
  });
  if (candidates.length === 0) return null;
  const defaults = candidates.filter((r) => r.isDefault !== false);
  const pool = defaults.length > 0 ? defaults : candidates;
  const yieldRate = (r: RecipeDef): number => r.outputs.reduce((s, o) => (o.item === item ? s + o.count : s), 0) / r.craftTime;
  return pool.slice().sort((a, b) => {
    const d = yieldRate(b) - yieldRate(a);
    if (Math.abs(d) > 1e-9) return d;
    if (a.craftTime !== b.craftTime) return a.craftTime - b.craftTime;
    return a.key.localeCompare(b.key);
  })[0]!;
}

/** Convenience wrapper: machines needed for an item at a target rate. */
export function machinesForItem(data: GameData, item: string, perMin: number, options: PlanOptions): number {
  const recipe = chooseRecipe(data, item, options);
  if (!recipe) return 0;
  const { machines } = machinesForRate(data, {
    recipe,
    targetPerMin: perMin,
    targetItem: item,
    proliferator: options.proliferator,
    bonuses: options.bonuses,
  });
  return machines;
}

/**
 * Power accounting for a whole factory: generation vs consumption.
 * Generation values are supplied by the caller (wind, solar, fuel).
 */
export interface PowerReport {
  consumptionKW: number;
  generationKW: number;
  netKW: number;
  /** How many of each given generator are needed to cover the deficit. */
  generatorsNeeded: { buildingKey: string; count: number }[];
}

export function powerReport(
  consumptionKW: number,
  generators: { buildingKey: string; outputKW: number; count: number }[],
): PowerReport {
  const generationKW = generators.reduce((sum, g) => sum + g.outputKW * g.count, 0);
  const deficit = Math.max(0, consumptionKW - generationKW);
  return {
    consumptionKW: round(consumptionKW, 6),
    generationKW: round(generationKW, 6),
    netKW: round(generationKW - consumptionKW, 6),
    generatorsNeeded: generators
      .filter((g) => g.outputKW > 0)
      .map((g) => ({ buildingKey: g.buildingKey, count: deficit > 0 ? Math.ceil(deficit / g.outputKW - EPSILON) : 0 })),
  };
}
