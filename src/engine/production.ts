/**
 * Core production math: how many items per minute does a machine make?
 *
 * The chain implemented here is exactly the one the game uses:
 *
 *   craftTime            recipe TimeSpend in seconds at machine speed 1.0
 *   speedMultiplier      machine workSpeed × research bonuses × proliferator
 *   craftsPerMinute      = 60 / (craftTime / speedMultiplier)
 *   outputs              = amount × craftsPerMinute × outputMultiplier
 *   inputs               = amount × craftsPerMinute
 *   power                = machine power × machines
 *
 * The two proliferator modes are mutually exclusive and are applied at
 * different places: `speedup` divides the craft time, `extraProducts`
 * multiplies the produced counts. Neither changes the input consumption.
 */

import type {
  BuildingDef,
  FacilityKey,
  ProliferatorMode,
  RateResult,
  RecipeDef,
  RecipeIO,
} from './types.ts';
import { GameDataError, type GameData } from './registry.ts';
import {
  NEUTRAL_BONUSES,
  allowsExtraProducts,
  canProliferate,
  noProliferator,
  resolveProliferator,
  type ActiveBonuses,
  type ProliferatorResult,
} from './rules.ts';

export interface ProductionRequest {
  /** Recipe key, or a recipe object for ad-hoc simulation. */
  recipe: string | RecipeDef;
  /** How many machines are running this recipe. Default 1. */
  machines?: number;
  /** Building key of the crafting station (defaults to the recipe's facility). */
  building?: string;
  /** Proliferator applied to the machine's inputs. */
  proliferator?: { markKey?: string | null; mode?: ProliferatorMode };
  /** Active research bonuses. */
  bonuses?: ActiveBonuses;
  /** Scale every output (e.g. "simulate this line at 80% uptime"). */
  throughput?: number;
}

/** A synthetic machine spec, used when no building hosts the recipe. */
export interface MachineSpec {
  key: string | null;
  name: string;
  workSpeed: number;
  powerConsumptionKW: number;
  recipeFacility: FacilityKey | null;
}

/**
 * Work out which building runs a recipe.
 *
 * The recipe's `facility` is authoritative — a Matrix Lab and an Assembling
 * Machine can both host recipes, so matching by "first building that has a
 * workSpeed" would silently pick the wrong machine (and the wrong power draw and
 * speed multiplier). Resolution order:
 *   1. the explicitly requested building,
 *   2. a building whose `recipeFacility` equals the recipe's facility,
 *   3. a building whose *key* equals the recipe's facility,
 *   4. a fallback synthetic machine at speed 1× with no power draw.
 */
export function resolveMachine(data: GameData, recipe: RecipeDef, buildingKey?: string): MachineSpec {
  if (buildingKey) {
    const building = data.building(buildingKey);
    if (!building) throw new GameDataError(`unknown building "${buildingKey}"`);
    if (building.workSpeed == null) {
      throw new GameDataError(`building "${buildingKey}" cannot run recipes (workSpeed is null)`);
    }
    return toSpec(building);
  }
  const byFacility = data.buildings.find((b) => b.recipeFacility === recipe.facility && b.workSpeed != null);
  if (byFacility) return toSpec(byFacility);
  const byKey = data.building(recipe.facility);
  if (byKey && byKey.workSpeed != null) return toSpec(byKey);
  return {
    key: null,
    name: recipe.facility,
    workSpeed: 1,
    powerConsumptionKW: 0,
    recipeFacility: recipe.facility,
  };
}

function toSpec(building: BuildingDef): MachineSpec {
  return {
    key: building.key,
    name: building.name,
    workSpeed: building.workSpeed!,
    powerConsumptionKW: building.powerConsumptionKW,
    recipeFacility: building.recipeFacility ?? null,
  };
}

function scaleIO(list: readonly RecipeIO[], factor: number): RecipeIO[] {
  return list.map((io) => ({ item: io.item, count: round(io.count * factor, 6) }));
}

export function round(value: number, digits: number): number {
  const f = Math.pow(10, digits);
  const r = Math.round(value * f) / f;
  return r === 0 ? 0 : r; // normalise -0
}

/**
 * Compute the full rate picture for one recipe on N machines.
 */
export function computeProduction(data: GameData, request: ProductionRequest): RateResult {
  const recipe = typeof request.recipe === 'string' ? data.requireRecipe(request.recipe) : request.recipe;
  const machines = request.machines ?? 1;
  const bonuses = request.bonuses ?? NEUTRAL_BONUSES;
  const throughput = request.throughput ?? 1;
  const warnings: string[] = [];

  if (machines < 0) warnings.push(`negative machine count ${machines} clamped to 0`);
  const machineCount = Math.max(0, machines);

  const machine = resolveMachine(data, recipe, request.building);

  // --- proliferator ------------------------------------------------------
  let proliferator: ProliferatorResult = noProliferator();
  const wantsProliferator = (request.proliferator?.mode ?? 'none') !== 'none';
  if (wantsProliferator && !canProliferate(recipe)) {
    warnings.push(`recipe ${recipe.key} cannot be proliferated — ignoring the spray`);
  } else if (wantsProliferator) {
    proliferator = resolveProliferator(data, request.proliferator ?? {}, bonuses);
    if (proliferator.mode === 'none') {
      warnings.push(`proliferator mark "${request.proliferator?.markKey}" not found — running unsprayed`);
    } else if (proliferator.mode === 'extraProducts' && !allowsExtraProducts(data, recipe)) {
      warnings.push(
        `recipe ${recipe.key} cannot use the Extra Products bonus (building output / antimatter / X-Ray Cracking) — only Production Speedup applies`,
      );
      proliferator = resolveProliferator(data, { ...request.proliferator, mode: 'speedup' }, bonuses);
    }
  }

  // --- speed -------------------------------------------------------------
  // Research "assembler speed" applies to manufacturing machines only, which is
  // what the game's Assembling Speed / Re-composing upgrades do.
  const isManufacturing = isAssemblingFacility(recipe.facility);
  const assemblerBonus = isManufacturing ? bonuses.assemblerSpeedMultiplier : 1;
  const buildingBonus = machine.key ? (bonuses.buildingSpeedMultiplier[machine.key] ?? 1) : 1;
  const labBonus = recipe.facility === 'None' && recipe.key.toLowerCase().includes('research') ? bonuses.labSpeedMultiplier : 1;

  const speedMultiplier = machine.workSpeed * assemblerBonus * buildingBonus * labBonus * proliferator.speedFactor;
  const effectiveCraftTime = recipe.craftTime / speedMultiplier;
  const craftsPerMinPerMachine = effectiveCraftTime > 0 ? 60 / effectiveCraftTime : 0;
  const craftsPerMin = craftsPerMinPerMachine * machineCount * throughput;

  // --- items -------------------------------------------------------------
  const outputMultiplier = proliferator.outputFactor;
  const outputsPerMin = scaleIO(
    recipe.outputs.map((o) => ({ item: o.item, count: o.count * outputMultiplier })),
    craftsPerMin,
  );
  const inputsPerMin = scaleIO(recipe.inputs, craftsPerMin);

  // --- power -------------------------------------------------------------
  // A sprayed item applies an energy consumption penalty to the machine that
  // processes it (Spray Coater: +30% / +70% / +150% for Mk.I/II/III).
  const powerPerMachine =
    machine.powerConsumptionKW * bonuses.powerConsumptionMultiplier * proliferator.energyMultiplier;
  const totalPowerKW = powerPerMachine * machineCount;

  // --- proliferator upkeep ----------------------------------------------
  // A Spray Coater consumes one spray per *physical item* passing through it and
  // stores `spraysPerItem` sprays per Proliferator item (12/24/60 for
  // Mk.I/II/III). A machine running a sprayed recipe handles its recipe inputs
  // plus its recipe outputs, so upkeep is the item movement of the craft.
  let spraysPerMin = 0;
  if (proliferator.mode !== 'none' && proliferator.mark) {
    const itemsPerCraft = recipe.outputs.reduce((sum, o) => sum + o.count, 0) + recipe.inputs.reduce((sum, i) => sum + i.count, 0);
    spraysPerMin = (craftsPerMin * itemsPerCraft) / Math.max(1, proliferator.mark.spraysPerItem);
  }

  if (!Number.isFinite(craftsPerMin)) warnings.push('non finite rate computed');

  return {
    recipeKey: recipe.key,
    buildingKey: machine.key,
    craftsPerMinPerMachine: round(craftsPerMinPerMachine, 6),
    machines: machineCount,
    speedMultiplier: round(speedMultiplier, 9),
    outputMultiplier: round(outputMultiplier, 9),
    outputsPerMin,
    inputsPerMin,
    powerConsumptionKW: round(powerPerMachine, 6),
    totalPowerKW: round(totalPowerKW, 6),
    proliferator: {
      mode: proliferator.mode,
      markKey: proliferator.mark?.key ?? null,
      spraysPerMin: round(spraysPerMin, 6),
    },
    warnings,
  };
}

/** Machines that the "assembler speed" line of research applies to. */
export function isAssemblingFacility(facility: FacilityKey): boolean {
  return (
    facility === 'AssemblingMachineMk1' ||
    facility === 'AssemblingMachineMk2' ||
    facility === 'AssemblingMachineMk3' ||
    facility === 'RecomposingAssembler' ||
    facility === 'Replicator'
  );
}

/**
 * How many machines are needed to produce `targetPerMin` of `itemKey`
 * (or to run `craftsPerMin` crafts) at the given configuration.
 */
export function machinesForRate(
  data: GameData,
  request: ProductionRequest & { targetPerMin: number; targetItem?: string },
): { machines: number; achievedPerMin: number } {
  const single = computeProduction(data, { ...request, machines: 1 });
  const perMachine = request.targetItem
    ? (single.outputsPerMin.find((o) => o.item === request.targetItem)?.count ?? 0)
    : single.craftsPerMinPerMachine;
  if (perMachine <= 0) return { machines: 0, achievedPerMin: 0 };
  const machines = request.targetPerMin / perMachine;
  return { machines, achievedPerMin: perMachine * machines };
}

/**
 * Balance a machine count against a single input constraint, e.g. "how many
 * Assembling Machine Mk.I can one Mk.I belt of iron ingots feed?".
 */
export function maxMachinesForInput(
  data: GameData,
  request: ProductionRequest,
  inputItem: string,
  availablePerMin: number,
): number {
  const single = computeProduction(data, { ...request, machines: 1 });
  const perMachine = single.inputsPerMin.find((i) => i.item === inputItem)?.count ?? 0;
  if (perMachine <= 0) return Number.POSITIVE_INFINITY;
  return availablePerMin / perMachine;
}

/** Convenience: a recipe's total input count for one craft. */
export function inputCount(recipe: RecipeDef, itemKey: string): number {
  return recipe.inputs.find((i) => i.item === itemKey)?.count ?? 0;
}

/** Convenience: a recipe's total output count for one craft. */
export function outputCount(recipe: RecipeDef, itemKey: string): number {
  return recipe.outputs.find((o) => o.item === itemKey)?.count ?? 0;
}

/** A building definition with a guaranteed non-null workSpeed. */
export type CraftingBuilding = BuildingDef & { workSpeed: number };
