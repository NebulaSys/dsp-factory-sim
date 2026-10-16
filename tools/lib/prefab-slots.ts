/**
 * Maps dataset building keys to the game's prefab short names, and reads per-building
 * sorter attachment slot counts out of the prefab data.
 *
 * Why a hand-written map exists: the dataset uses the in-game camel-case key
 * (`AssemblingMachineMk1`) while `prefabs.json` uses the shipped kebab-case path
 * (`assembler-mk-1`). Neither is derivable from the other — "Assembling" becomes
 * "assembler", "MiniatureParticleCollider" becomes "hadron-collider" — so guessing
 * would silently mis-assign slot counts. An unknown key is reported, never skipped.
 *
 * `SlotConfig.insertPoses` is the list of sorter attachment points on a building. The
 * game's own `SlotConfig` type (Assembly-CSharp TypeDef 0x0200012b) declares
 * `insertPoses` and `slotPoses` as `Vector3[]`, and its constructor never assigns
 * them, so they are serialized data. The published `prefabs.json` carries the array
 * LENGTHS correctly but every element is `{}`, so counts are authoritative while
 * positions are not yet available (see docs/SLOT-DATA-REVERSING.md).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface PrefabSlotSource {
  version: string | null;
  /** prefab short name -> sorter attachment point count. */
  attachByShortName: Map<string, number>;
  /** prefab short name -> item slot count (logistics stations and similar). */
  itemByShortName: Map<string, number>;
}

/** Load per-building slot counts from the cached prefab data. */
export function loadPrefabSlots(prefabsPath: string): PrefabSlotSource {
  const parsed = JSON.parse(readFileSync(prefabsPath, 'utf8')) as {
    version?: string;
    prefabs: Record<string, { SlotConfig?: { insertPoses?: unknown[]; slotPoses?: unknown[] } }>;
  };
  const attachByShortName = new Map<string, number>();
  const itemByShortName = new Map<string, number>();
  for (const [key, value] of Object.entries(parsed.prefabs)) {
    const short = key.split('/').pop();
    if (!short) continue;
    const attach = value.SlotConfig?.insertPoses?.length ?? 0;
    const item = value.SlotConfig?.slotPoses?.length ?? 0;
    if (attach > 0) attachByShortName.set(short, attach);
    if (item > 0) itemByShortName.set(short, item);
  }
  return { version: parsed.version ?? null, attachByShortName, itemByShortName };
}

/**
 * dataset building key -> prefab short name.
 *
 * Only entries whose prefab declares sorter attachment points are listed; the rest
 * have no slots to record. Every key here is asserted to exist in the dataset and in
 * the prefab data where it is applied.
 */
export const BUILDING_TO_PREFAB: Record<string, string> = {
  // Production machines: a 3x3 footprint with attachment points on all four faces.
  AssemblingMachineMk1: 'assembler-mk-1',
  AssemblingMachineMk2: 'assembler-mk-2',
  AssemblingMachineMk3: 'assembler-mk-3',
  RecomposingAssembler: 'assembler-mk-4',
  ArcSmelter: 'smelter',
  PlaneSmelter: 'smelter-2',
  NegentropySmelter: 'smelter-3',
  ChemicalPlant: 'chemical-plant',
  QuantumChemicalPlant: 'chemical-plant-2',
  OilRefinery: 'oil-refinery',
  MiniatureParticleCollider: 'hadron-collider',
  MatrixLab: 'lab',
  SelfEvolutionLab: 'lab-2',
  // Storage and power
  DepotMk1: 'storage-1',
  DepotMk2: 'storage-2',
  ThermalPowerPlant: 'power-generator',
  MiniFusionPowerPlant: 'fusion-power-station',
  ArtificialStar: 'fusion-reactor',
  // Silos and combat
  EMRailEjector: 'em-rail-ejector',
  VerticalLaunchingSilo: 'vertical-launching-silo',
  BattlefieldAnalysisBase: 'battle-base',
};

/**
 * Apply `sorterAttachSlots` to a building list in place.
 *
 * Returns the names of dataset keys that are mapped but whose prefab declares no
 * attachment points, so a data refresh that changes the game's slot layout surfaces
 * as a reported problem instead of a silently missing field.
 */
export function applySorterAttachSlots(
  buildings: { key: string; sorterAttachSlots?: number }[],
  source: PrefabSlotSource,
): { applied: number; mismatched: string[] } {
  const present = new Set(buildings.map((b) => b.key));
  const missingKeys = Object.keys(BUILDING_TO_PREFAB).filter((k) => !present.has(k));
  if (missingKeys.length > 0) {
    throw new Error(`BUILDING_TO_PREFAB names keys absent from the dataset: ${missingKeys.join(', ')}`);
  }
  let applied = 0;
  const mismatched: string[] = [];
  for (const building of buildings) {
    const short = BUILDING_TO_PREFAB[building.key];
    if (!short) continue;
    const attach = source.attachByShortName.get(short);
    if (attach === undefined) {
      mismatched.push(`${building.key} -> ${short}`);
      continue;
    }
    building.sorterAttachSlots = attach;
    applied++;
  }
  return { applied, mismatched };
}

/** Absolute path to the cached prefab data used by the build scripts. */
export function prefabsPathFor(root: string): string {
  return resolve(root, 'docs/research/_raw/prefabs.json');
}
