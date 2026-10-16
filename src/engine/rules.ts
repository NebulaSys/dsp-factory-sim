/**
 * Game rules that modify production: player tech levels, repeatable upgrades,
 * proliferator marks and the mining formula.
 *
 * Every formula here is documented with the in-game quantity it reproduces so
 * that the numbers can be re-validated against dsp-wiki.com.
 */

import type { Effect, ProliferatorMode, ProliferatorMark, RecipeDef, UpgradeDef } from './types.ts';
import type { GameData } from './registry.ts';

// ---------------------------------------------------------------------------
// Player research state
// ---------------------------------------------------------------------------

export interface ResearchState {
  /** Researched technology keys (non-repeatable). */
  technologies: Set<string>;
  /** Repeatable upgrade levels, keyed by upgrade key. */
  upgradeLevels: Record<string, number>;
}

export function emptyResearch(): ResearchState {
  return { technologies: new Set(), upgradeLevels: {} };
}

/**
 * Aggregate of every multiplier/absolute effect currently active.
 * Built once per simulation from `ResearchState`.
 */
export interface ActiveBonuses {
  /** Multiplier applied to all mining machine output. */
  miningSpeedMultiplier: number;
  /** Multiplier applied to ore taken out of a vein. */
  veinAmountMultiplier: number;
  /**
   * Compounding per-level ore-consumption factor (0.94 for Veins Utilization).
   * Kept separate from `veinAmountMultiplier` because it compounds rather than
   * adding: consumption = 0.94 ^ level.
   */
  veinConsumptionMultiplier: number;
  /** Multiplier applied to assembling-machine (manufacturing) speed. */
  assemblerSpeedMultiplier: number;
  /** Multiplier applied to research lab speed. */
  labSpeedMultiplier: number;
  /** Multiplier applied to every belt's throughput. */
  beltSpeedMultiplier: number;
  /** Multiplier applied to every sorter's throughput. */
  sorterSpeedMultiplier: number;
  /** Multiplier applied to power plant output. */
  powerGenerationMultiplier: number;
  /** Multiplier applied to building power consumption. */
  powerConsumptionMultiplier: number;
  /** Multiplier applied to proliferator bonuses. */
  proliferatorBonusMultiplier: number;
  /** Multiplier applied to logistics station storage. */
  logisticsStationCapacityMultiplier: number;
  droneSpeedMultiplier: number;
  vesselSpeedMultiplier: number;
  /** Per-building speed overrides granted by non repeatable techs. */
  buildingSpeedMultiplier: Record<string, number>;
  /** Recipe keys unlocked by research. */
  unlockedRecipes: Set<string>;
  /** Building keys unlocked by research. */
  unlockedBuildings: Set<string>;
  /** Raw effects, for UI display. */
  raw: Effect[];
}

export const NEUTRAL_BONUSES: ActiveBonuses = {
  miningSpeedMultiplier: 1,
  veinAmountMultiplier: 1,
  veinConsumptionMultiplier: 0.94,
  assemblerSpeedMultiplier: 1,
  labSpeedMultiplier: 1,
  beltSpeedMultiplier: 1,
  sorterSpeedMultiplier: 1,
  powerGenerationMultiplier: 1,
  powerConsumptionMultiplier: 1,
  proliferatorBonusMultiplier: 1,
  logisticsStationCapacityMultiplier: 1,
  droneSpeedMultiplier: 1,
  vesselSpeedMultiplier: 1,
  buildingSpeedMultiplier: {},
  unlockedRecipes: new Set<string>(),
  unlockedBuildings: new Set<string>(),
  raw: [],
};

/**
 * Alternate spellings for the same upgrade, so a UI label or a data file that
 * uses the wiki's plural form cannot silently switch a bonus off. The first
 * entry is the key used by the shipped game data; the rest are accepted aliases.
 * Maps alias -> canonical key.
 */
export const UPGRADE_KEY_ALIASES: Readonly<Record<string, string>> = {
  // Game data uses the singular "VeinUtilization"; the wiki page is titled
  // "Vein Utilization (Upgrade)" and older tooling writes "VeinsUtilization".
  veinsutilization: 'VeinUtilization',
  veinutilization: 'VeinUtilization',
  // Assembling speed is sometimes written as two words / with a "Machine".
  assemblingspeed: 'AssemblingSpeed',
  assemblingmachinespeed: 'AssemblingSpeed',
  // Logistics belts / sorters.
  logisticssystem: 'LogisticsSystem',
  logisticslogisticssystem: 'LogisticsSystem',
  beltspeed: 'LogisticsSystem',
  sorterspeed: 'PilotSpeed',
  researchspeed: 'ResearchSpeed',
  labspeed: 'ResearchSpeed',
};

/** Resolve an upgrade key through the alias table (case-insensitive). */
export function canonicalUpgradeKey(key: string): string {
  return UPGRADE_KEY_ALIASES[key.toLowerCase()] ?? key;
}

/**
 * Find an upgrade by key, trying in order:
 *   1. the key exactly as given,
 *   2. its canonical (alias-resolved) form,
 *   3. any key in the dataset whose canonical form matches.
 *
 * Step 3 matters because a dataset may legitimately ship the plural spelling
 * ("VeinsUtilization") while the game itself uses the singular one; without it, a
 * renamed upgrade would silently contribute no bonus at all.
 */
export function findUpgrade(data: GameData, key: string): UpgradeDef | undefined {
  const direct = data.upgrade(key);
  if (direct) return direct;
  const canonical = canonicalUpgradeKey(key);
  const byCanonical = data.upgrade(canonical);
  if (byCanonical) return byCanonical;
  const wanted = canonical.toLowerCase();
  return data.upgrades.find((u) => canonicalUpgradeKey(u.key).toLowerCase() === wanted);
}

/**
 * Compute the active state from researched techs + repeatable upgrade levels.
 *
 * Multiplicative effects (miningSpeedMultiplier, assemblerSpeed, …) stack
 * additively per level and then multiply the base, matching the game where
 * "Veins Utilisation V" (+50%) is a single +50% multiplier, not 1.1^5.
 */
export function computeBonuses(data: GameData, research: ResearchState): ActiveBonuses {
  const b: ActiveBonuses = {
    ...NEUTRAL_BONUSES,
    buildingSpeedMultiplier: {},
    unlockedRecipes: new Set<string>(),
    unlockedBuildings: new Set<string>(),
    raw: [],
  };

  const accumulated: Record<string, number> = {};
  /** Compounding effects: kind -> { factor per level, total levels }. */
  const compounding = new Map<string, { factorPerLevel: number; levels: number }>();
  const applyEffect = (effect: Effect, levels = 1): void => {
    b.raw.push(effect);
    if (effect.kind === 'recipe' && effect.recipes) {
      for (const r of effect.recipes) b.unlockedRecipes.add(r);
      return;
    }
    if (effect.kind === 'building' && effect.buildings) {
      for (const k of effect.buildings) b.unlockedBuildings.add(k);
      return;
    }
    // Veins Utilization's ore-consumption reduction is compounding (×0.94 per
    // level, i.e. 0.94^level), not additive, so it is tracked separately.
    if (effect.kind === 'veinConsumptionMultiplier') {
      const entry = compounding.get(effect.kind) ?? { factorPerLevel: effect.value ?? 0.94, levels: 0 };
      entry.factorPerLevel = effect.value ?? entry.factorPerLevel;
      entry.levels += levels;
      compounding.set(effect.kind, entry);
      return;
    }
    const value = (effect.value ?? 0) * levels;
    if (value === 0) return;
    accumulated[effect.kind] = (accumulated[effect.kind] ?? 0) + value;
  };
  // Non repeatable technologies grant their effects once.
  for (const key of research.technologies) {
    const tech = data.tech(key);
    if (!tech) continue;
    for (const effect of tech.effects ?? []) applyEffect(effect);
    for (const r of tech.unlocks?.recipes ?? []) b.unlockedRecipes.add(r);
    for (const k of tech.unlocks?.buildings ?? []) b.unlockedBuildings.add(k);
  }

  // Repeatable upgrades scale linearly with their level.
  for (const [rawKey, level] of Object.entries(research.upgradeLevels)) {
    if (!level) continue;
    const upgrade = findUpgrade(data, rawKey);
    if (!upgrade) continue;
    const clamped = Math.min(level, upgrade.maxLevel);
    // `effectsPerLevel`, when present, is the COMPLETE effect list for the
    // upgrade (data files use it when one upgrade grants several things at once,
    // e.g. Veins Utilization: +10% mining speed AND ×0.94 ore consumption).
    // Falling back to `effectPerLevel` keeps single-effect upgrades working.
    const effects = upgrade.effectsPerLevel && upgrade.effectsPerLevel.length > 0 ? upgrade.effectsPerLevel : [upgrade.effectPerLevel];
    for (const effect of effects) applyEffect(effect, clamped);
  }

  const multiplier = (kind: string): number => 1 + (accumulated[kind] ?? 0);
  b.miningSpeedMultiplier = multiplier('miningSpeedMultiplier');
  b.veinAmountMultiplier = multiplier('veinAmountMultiplier');
  const vein = compounding.get('veinConsumptionMultiplier');
  b.veinConsumptionMultiplier = vein ? Math.pow(vein.factorPerLevel, vein.levels) : 0.94;
  b.assemblerSpeedMultiplier = multiplier('assemblerSpeed');
  b.labSpeedMultiplier = multiplier('labSpeed');
  b.beltSpeedMultiplier = multiplier('beltSpeed');
  b.sorterSpeedMultiplier = multiplier('sorterSpeed');
  b.powerGenerationMultiplier = multiplier('powerGeneration');
  b.powerConsumptionMultiplier = multiplier('powerConsumption');
  b.proliferatorBonusMultiplier = multiplier('proliferatorBonus');
  b.logisticsStationCapacityMultiplier = multiplier('logisticsStationCapacity');
  b.droneSpeedMultiplier = multiplier('droneSpeed');
  b.vesselSpeedMultiplier = multiplier('vesselSpeed');
  return b;
}

// ---------------------------------------------------------------------------
// Proliferator
// ---------------------------------------------------------------------------

export interface ProliferatorResult {
  mode: ProliferatorMode;
  /** Divisor applied to craft time (1 when unsprayed or in extra-products mode). */
  speedFactor: number;
  /** Multiplier applied to produced item counts (1 when unsprayed or speedup). */
  outputFactor: number;
  mark: ProliferatorMark | null;
  /** Sprays consumed per manufactured item. */
  spraysPerInputItem: number;
  /** Multiplier applied to the processing building's power draw. */
  energyMultiplier: number;
}

export function noProliferator(): ProliferatorResult {
  return { mode: 'none', speedFactor: 1, outputFactor: 1, mark: null, spraysPerInputItem: 0, energyMultiplier: 1 };
}

/**
 * Resolve a proliferator setting into craft-time / output / power multipliers.
 *
 * Source: dsp-wiki.com/Spray_Coater ("Proliferator Bonuses"), which specifies
 *  - `speedup`       Production Speedup, multiplicative with machine speed
 *  - `extraProducts` Extra Products, applies to produced counts and to research
 *                    hashes; NOT available for buildings-as-products, Antimatter,
 *                    Antimatter Fuel Rod or X-Ray Cracking
 *  - the lowest mark among all ingredients is the one that applies
 *  - "no mark on any ingredient" => no bonus at all
 *  - an energy consumption penalty applies to the processing building
 */
export function resolveProliferator(
  data: GameData,
  options: { markKey?: string | null; mode?: ProliferatorMode },
  bonuses: ActiveBonuses = NEUTRAL_BONUSES,
): ProliferatorResult {
  const mode = options.mode ?? 'none';
  if (mode === 'none' || !options.markKey) return noProliferator();
  const mark = data.proliferatorMark(options.markKey);
  if (!mark) return noProliferator();

  const bonusScale = bonuses.proliferatorBonusMultiplier;
  const base = {
    mode,
    mark,
    spraysPerInputItem: 1,
    energyMultiplier: 1 + mark.energyPenalty,
  } satisfies Partial<ProliferatorResult> as ProliferatorResult;

  if (mode === 'speedup') {
    return { ...base, speedFactor: 1 + mark.speedBonus * bonusScale, outputFactor: 1 };
  }
  return { ...base, speedFactor: 1, outputFactor: 1 + mark.extraProductsBonus * bonusScale };
}

/**
 * Whether a recipe may use the Extra Products mode.
 *
 * Source: dsp-wiki.com/Spray_Coater — "The production of Antimatter, Antimatter
 * Fuel Rod, the X-Ray Cracking recipe, and recipes that use other buildings as
 * material (such as Mk.II and Mk.III Conveyor Belts, Sorters or Assembling
 * Machines) cannot receive the Extra Products bonus."
 */
export function allowsExtraProducts(data: GameData, recipe: RecipeDef): boolean {
  if (recipe.proliferatorOutput === false) return false;
  if (recipe.key === 'XRayCracking') return false;
  const excludedItems = new Set(['Antimatter', 'AntimatterFuelRod']);
  for (const out of recipe.outputs) {
    if (excludedItems.has(out.item)) return false;
    if (data.item(out.item)?.category === 'building') return false;
  }
  return true;
}

/**
 * The mark that actually applies to a craft: the LOWEST tier among every
 * ingredient, or none when any ingredient is unsprayed.
 */
export function effectiveMark(marks: readonly (string | null | undefined)[], data: GameData): ProliferatorMark | null {
  if (marks.length === 0) return null;
  let lowest: ProliferatorMark | null = null;
  for (const key of marks) {
    if (!key) return null; // one unsprayed ingredient disables the bonus entirely
    const mark = data.proliferatorMark(key);
    if (!mark) return null;
    if (!lowest || mark.tier < lowest.tier) lowest = mark;
  }
  return lowest;
}

/** Whether a proliferator may be applied to a recipe at all. */
export function canProliferate(recipe: RecipeDef): boolean {
  return recipe.proliferatorBoost !== false;
}

// ---------------------------------------------------------------------------
// Mining
// ---------------------------------------------------------------------------

/**
 * Ore per minute for ONE mining machine.
 *
 * Wiki (dsp-wiki.com/Mining_Machine): "The mining machine harvests each vein
 * covered by its harvest area at a base rate of 30 items per minute. This rate
 * is the same for all material veins."
 *
 * Each *additional* mining machine covering the same vein still adds output, but
 * that vein's remaining reserves deplete faster; `computeVeinDepletion` below
 * models the reserve side, which is what Veins Utilisation's −6%/level affects.
 */
export interface MiningInput {
  /** Veins covered by this miner's drill area. */
  coveredVeins: number;
  /** Base ore/min contributed by a single covered vein at multiplier 1 (30). */
  baseRatePerVeinPerMin: number;
  bonuses?: ActiveBonuses;
  /** Proliferator applied to the mining machine itself (speedup mode). */
  proliferator?: ProliferatorResult;
  /** Flat extra multiplier from world settings (resource richness 0.5×–∞). */
  resourceMultiplier?: number;
  /** Multiplier of the specific machine (Advanced Mining Machine is faster). */
  machineSpeedMultiplier?: number;
}

export function computeMiningRate(input: MiningInput): number {
  const bonuses = input.bonuses ?? NEUTRAL_BONUSES;
  const proliferator = input.proliferator ?? noProliferator();
  const resource = input.resourceMultiplier ?? 1;
  const machine = input.machineSpeedMultiplier ?? 1;
  return (
    input.coveredVeins *
    input.baseRatePerVeinPerMin *
    bonuses.miningSpeedMultiplier *
    proliferator.speedFactor *
    resource *
    machine
  );
}

/**
 * Vein reserves consumed per minute for a given extraction rate.
 *
 * Wiki (Vein Utilization (Upgrade)): each level applies a compounding −6% ore
 * consumption, i.e. consumption = rate × 0.94^(level − 1) for the level index
 * starting at 1 being the first researched level.
 */
export function computeVeinDepletion(extractionPerMin: number, veinUtilizationLevel = 0, bonuses?: ActiveBonuses): number {
  // The game stores the ore-consumption multiplier directly (0.94 per level), so
  // prefer it when the dataset provides it; otherwise use 0.94^level, which is
  // what dsp-wiki.com/Vein_Utilization_(Upgrade) documents.
  const perLevel = bonuses?.veinConsumptionMultiplier ?? 0.94;
  return extractionPerMin * Math.pow(perLevel, Math.max(0, veinUtilizationLevel));
}

/**
 * Total ore a vein yields before it is exhausted, given its base amount and the
 * *effective* consumption rate. With level L the same reserves last
 * 0.94^-L times longer (and mining is 1+0.1L times faster).
 */
export function veinTotalAmount(baseAmount: number, veinUtilizationLevel = 0): number {
  return baseAmount / Math.pow(0.94, Math.max(0, veinUtilizationLevel));
}

/**
 * Mining speed multiplier for a given Veins Utilisation level.
 * Level 0 = 1.0×, level 1 = 1.1×, level n = 1 + 0.1n (capped at 60× in game).
 */
export function veinsUtilizationSpeedMultiplier(level: number): number {
  return Math.min(60, 1 + 0.1 * Math.max(0, level));
}

// ---------------------------------------------------------------------------
// Logistics
// ---------------------------------------------------------------------------

export function beltThroughputPerMin(data: GameData, beltKey: string, bonuses = NEUTRAL_BONUSES): number {
  const belt = data.belt(beltKey);
  if (!belt) return 0;
  return belt.speedPerMin * bonuses.beltSpeedMultiplier;
}

export function sorterThroughputPerSec(data: GameData, sorterKey: string, bonuses = NEUTRAL_BONUSES): number {
  const sorter = data.sorter(sorterKey);
  if (!sorter) return 0;
  return sorter.speedPerSec * bonuses.sorterSpeedMultiplier;
}
