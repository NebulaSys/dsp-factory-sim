/**
 * DSP Factory Simulator — core data model.
 *
 * Design rule: this file contains ONLY types and constants. Every game number
 * (craft time, machine speed, bonus) lives in `src/engine/data/*` so that the
 * numbers can be re-validated against dsp-wiki.com without touching engine math.
 */

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export type ItemCategory =
  | 'raw'
  | 'intermediate'
  | 'component'
  | 'fuel'
  | 'proliferator'
  | 'ammo'
  | 'building'
  | 'matrix'
  | 'other';

/** A craftable / transportable good. `key` is the internal prototype name. */
export interface ItemDef {
  /** Internal item prototype id (blueprint `item_id`). null when unconfirmed. */
  id: number | null;
  key: string;
  name: string;
  nameZh?: string;
  category: ItemCategory;
  stackSize: number;
  isRaw: boolean;
  isFluid: boolean;
  /** fuels only: energy in MJ per item */
  fuelEnergyMJ?: number;
}

// ---------------------------------------------------------------------------
// Facilities (machines that run recipes)
// ---------------------------------------------------------------------------

export type FacilityKey =
  | 'Replicator'
  | 'ArcSmelter'
  | 'PlaneSmelter'
  | 'AssemblingMachineMk1'
  | 'AssemblingMachineMk2'
  | 'AssemblingMachineMk3'
  | 'RecomposingAssembler'
  | 'ChemicalPlant'
  | 'QuantumChemicalPlant'
  | 'OilRefinery'
  | 'MiniatureParticleCollider'
  | 'Fractionator'
  | 'OrbitalCollector'
  | 'MiningMachine'
  | 'WaterPump'
  | 'OilExtractor'
  | 'MatrixLab'
  | 'SprayCoater'
  | 'None';

export type BuildingCategory =
  | 'production'
  | 'smelter'
  | 'chemical'
  | 'refinery'
  | 'collider'
  | 'fractionator'
  | 'mining'
  | 'pump'
  | 'extractor'
  | 'logistics'
  | 'power'
  | 'belt'
  | 'sorter'
  | 'storage'
  | 'research'
  | 'turret'
  | 'other';

export interface BuildingDef {
  key: string;
  name: string;
  nameZh?: string;
  id: number | null;
  category: BuildingCategory;
  /** Working power draw in kW. */
  powerConsumptionKW: number;
  powerIdleKW?: number;
  /**
   * The machine's crafting-speed multiplier (the game's speed table).
   * Recipe rate = recipeAmount / craftTime * workSpeed * bonuses.
   * null for buildings that do not run recipes.
   */
  workSpeed: number | null;
  /** Recipe facility this building hosts, when it is a crafting station. */
  recipeFacility?: FacilityKey;
  /** Number of simultaneous recipe workers (assemblers 1, labs 6, ...). */
  slots?: number;
  /**
   * Sorter attachment points on this building, from the game's
   * `SlotConfig.insertPoses` / `slotPoses`. A blueprint records which slot a
   * sorter used (`outputToSlot` / `inputFromSlot`), so this is what lets that
   * index be range-checked. Undefined for buildings a sorter cannot attach to.
   */
  sorterAttachSlots?: number;
  /**
   * The actual attachment points, index-aligned with the slot ids a blueprint
   * records. Prefab-local: `x`/`z` span the ground plane and `y` is height,
   * because the prefab is a Unity Y-up object while a blueprint stores x/y
   * horizontal and z vertical. Only present where the points were recovered
   * from the shipped assets; `sorterAttachSlots` may be known without it.
   */
  sorterSlotPoses?: { x: number; y: number; z: number }[];
  footprint?: { w: number; h: number };
  beltSpeedPerMin?: number | null;
  sorterSpeedPerSec?: number | null;
  /**
   * Extraction rate for gathering buildings, in items per minute per covered
   * vein/well at multiplier 1 (Mining Machine 30, Advanced Mining Machine 60,
   * Water Pump 50 — see docs/GAME-DATA.md).
   */
  extractPerMinPerVein?: number | null;
  station?: {
    maxItems?: number | null;
    slots?: number | null;
    drones?: number | null;
    vessels?: number | null;
  } | null;
  note?: string;
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

export interface RecipeIO {
  /** Item key. */
  item: string;
  count: number;
}

export interface RecipeDef {
  /** Internal recipe id (blueprint `recipe_id`). null when unconfirmed. */
  id: number | null;
  key: string;
  name?: string;
  nameZh?: string;
  outputs: RecipeIO[];
  inputs: RecipeIO[];
  /** Seconds for one craft at machine workSpeed 1.0 (game `TimeSpend`). */
  craftTime: number;
  facility: FacilityKey;
  /** Tech key that unlocks it; null = available from the start. */
  tech?: string | null;
  /** Can a proliferator be applied (extra-products / speedup)? */
  proliferatorBoost: boolean;
  /** Does the extra-products mode add output? (false for e.g. fractionation). */
  proliferatorOutput: boolean;
  isDefault: boolean;
  category?: 'default' | 'alternate' | 'special';
  /** Item keys that must arrive by pipe (liquid/gas). */
  fluidInputs?: string[];
  fluidOutputs?: string[];
  note?: string;
}

// ---------------------------------------------------------------------------
// Technology & repeatable upgrades
// ---------------------------------------------------------------------------

export type EffectKind =
  | 'recipe'
  | 'building'
  | 'miningSpeedMultiplier'
  | 'veinAmountMultiplier'
  /** Compounding ore-consumption factor per level (Veins Utilization: 0.94). */
  | 'veinConsumptionMultiplier'
  | 'beltSpeed'
  | 'sorterSpeed'
  | 'assemblerSpeed'
  | 'labSpeed'
  | 'powerGeneration'
  | 'powerConsumption'
  | 'logisticsStationCapacity'
  | 'droneSpeed'
  | 'vesselSpeed'
  | 'mechaSpeed'
  | 'inventoryCapacity'
  | 'proliferatorBonus'
  | 'shieldCapacity'
  | 'damage'
  | 'other';

export interface Effect {
  kind: EffectKind;
  /** Multiplier per level (0.1 => +10%/level) or absolute value for `*Value`. */
  value?: number;
  /** For `recipe` effect: which recipe keys are unlocked. */
  recipes?: string[];
  /** For `building` effect: which building keys are unlocked. */
  buildings?: string[];
  /** Optional selector (e.g. which belt Mk, which facility). */
  target?: string;
  note?: string;
}

export interface TechDef {
  key: string;
  name: string;
  nameZh?: string;
  prerequisites: string[];
  cost?: { hashes?: number; items?: RecipeIO[] };
  unlocks?: { recipes?: string[]; buildings?: string[]; upgrades?: string[] };
  effects?: Effect[];
  note?: string;
}

/** A repeatable research upgrade ("Upgrades" in the research panel). */
export interface UpgradeDef {
  key: string;
  name: string;
  nameZh?: string;
  maxLevel: number;
  /** Primary effect applied once per level. */
  effectPerLevel: Effect;
  /**
   * Additional effects applied once per level. Some upgrades grant two things at
   * once — Veins Utilization is +10% mining speed AND ×0.94 ore consumption —
   * and the game data only records one of them, so both are listed here.
   */
  effectsPerLevel?: Effect[];
  curve?: string;
  note?: string;
}

// ---------------------------------------------------------------------------
// Proliferator
// ---------------------------------------------------------------------------

export type ProliferatorMode = 'none' | 'extraProducts' | 'speedup';

export interface ProliferatorMark {
  key: string;
  /** Item key of the spray itself. */
  item: string;
  tier: number;
  /**
   * Extra-products mode: +12.5% / +20% / +25% output items for Mk.I/II/III.
   * Cannot be selected for recipes whose output is a building, for Antimatter,
   * Antimatter Fuel Rod and the X-Ray Cracking recipe.
   */
  extraProductsBonus: number;
  /**
   * Speedup mode: +25% / +50% / +100% craft speed for Mk.I/II/III.
   * Multiplicative with the machine's own crafting speed.
   */
  speedBonus: number;
  /**
   * Sprays stored by a Spray Coater per Proliferator item:
   * 12 / 24 / 60 for Mk.I/II/III (self-sprayed: 13 / 28 / 72).
   */
  spraysPerItem: number;
  /** Sprays per item when the Proliferator itself was sprayed. */
  spraysWhenSelfSprayed: number;
  /**
   * Energy consumption penalty applied to the building that processes sprayed
   * items: +30% / +70% / +150%.
   */
  energyPenalty: number;
  /**
   * Human-readable record of an unresolved source conflict for this mark, so a
   * disagreement between sources stays visible in the shipped data instead of
   * being silently resolved.
   */
  conflictNote?: string;
}

// ---------------------------------------------------------------------------
// Logistics throughput
// ---------------------------------------------------------------------------

export interface BeltDef {
  key: string;
  name: string;
  nameZh?: string;
  id: number | null;
  speedPerSec: number;
  speedPerMin: number;
  /** Items per belt slot when stacking (Stacking tech). */
  stackSize?: number;
}

export interface SorterDef {
  key: string;
  name: string;
  nameZh?: string;
  id: number | null;
  speedPerSec: number;
  powerConsumptionKW: number;
}

// ---------------------------------------------------------------------------
// Resolved production math
// ---------------------------------------------------------------------------

export interface ProliferatorSetting {
  mode: ProliferatorMode;
  markKey: string;
}

export interface ProductionOptions {
  /** Building key (e.g. "AssemblingMachineMk3") or a synthetic machine spec. */
  building?: string;
  /** Proliferator applied to THIS machine's inputs. */
  proliferator?: ProliferatorSetting;
  /** Player tech/upgrade levels, keyed by upgrade key. */
  upgrades?: Record<string, number>;
  /** Manual extra multiplier (e.g. veins utilisation applied to a miner). */
  extraSpeedMultiplier?: number;
}

export interface RateResult {
  recipeKey: string;
  buildingKey: string | null;
  /** Crafts per minute for ONE machine. */
  craftsPerMinPerMachine: number;
  machines: number;
  /** Effective multiplier applied to craft speed. */
  speedMultiplier: number;
  /** Effective multiplier applied to output counts. */
  outputMultiplier: number;
  /** Outputs per minute across `machines`. */
  outputsPerMin: RecipeIO[];
  /** Inputs per minute across `machines`. */
  inputsPerMin: RecipeIO[];
  powerConsumptionKW: number;
  /** Power drawn by all machines (working). */
  totalPowerKW: number;
  proliferator: {
    mode: ProliferatorMode;
    markKey: string | null;
    /** Spray items consumed per minute by all machines. */
    spraysPerMin: number;
  };
  warnings: string[];
}
