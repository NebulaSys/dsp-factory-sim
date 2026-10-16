/**
 * Footprint calibration for the production-line view.
 *
 * The dataset's `footprint` comes from the game's prefab `SlotConfig.selectSize`,
 * which is the *interaction* box, not the tile footprint: it reads 4.2 x 4.2 for an
 * Assembling Machine (3x3 tiles in game) and exactly 1 x 1 for a belt (1x1 in game).
 *
 * Ground truth we can measure
 * ---------------------------
 * The reference blueprint is 37 conveyor belts laid out on a grid; decoding it shows
 * `min X spacing = min Y spacing = 1.000` world unit and the closest pair of distinct
 * building centres 1.000 apart. So one cell is one world unit and a belt is one cell
 * across — which fixes the scale the view draws at.
 *
 * What this table does
 * --------------------
 * For buildings whose in-game tile footprint is well known, it replaces the
 * interaction box with the tile count. Entries marked `estimated: true` are the
 * community-standard values (the same numbers calculator tools use); they are an
 * approximation, and the view renders them as such. Buildings absent from this table
 * keep using the interaction box, which is within about a cell for most of them.
 */

export interface FootprintEntry {
  /** Tile footprint: width (x) and height (y) in grid cells. */
  w: number;
  h: number;
  /** How confident we are. */
  source: 'measured' | 'documented' | 'estimated';
  note?: string;
}

export const FOOTPRINT_CALIBRATION: Record<string, FootprintEntry> = {
  // --- measured from the ground-truth blueprint ---
  ConveyorBeltMk1: { w: 1, h: 1, source: 'measured', note: 'prefab selectSize 1x1 matches; spacing between belts is exactly 1 cell' },
  ConveyorBeltMk2: { w: 1, h: 1, source: 'measured' },
  ConveyorBeltMk3: { w: 1, h: 1, source: 'measured' },
  SorterMk1: { w: 1, h: 1, source: 'measured' },
  SorterMk2: { w: 1, h: 1, source: 'measured' },
  SorterMk3: { w: 1, h: 1, source: 'measured' },
  Splitter: { w: 1, h: 1, source: 'measured' },
  AutomaticPiler: { w: 1, h: 1, source: 'measured' },
  SprayCoater: { w: 1, h: 1, source: 'documented', note: 'installs onto a belt' },

  // --- documented tile footprints (community-standard values) ---
  ArcSmelter: { w: 3, h: 3, source: 'documented' },
  PlaneSmelter: { w: 3, h: 3, source: 'documented' },
  AssemblingMachineMk1: { w: 3, h: 3, source: 'documented', note: 'prefab selectSize reads 4.2 (interaction box), tiles are 3x3' },
  AssemblingMachineMk2: { w: 3, h: 3, source: 'documented' },
  AssemblingMachineMk3: { w: 3, h: 3, source: 'documented' },
  RecomposingAssembler: { w: 3, h: 3, source: 'documented' },
  ChemicalPlant: { w: 3, h: 3, source: 'estimated' },
  QuantumChemicalPlant: { w: 3, h: 3, source: 'estimated' },
  TeslaTower: { w: 1, h: 1, source: 'documented' },
  WirelessPowerTower: { w: 1, h: 1, source: 'estimated' },
  WindTurbine: { w: 3, h: 3, source: 'estimated' },
  SolarPanel: { w: 4, h: 4, source: 'estimated' },
  ThermalPowerPlant: { w: 4, h: 4, source: 'estimated' },
  MiniFusionPowerPlant: { w: 4, h: 4, source: 'estimated' },
  ArtificialStar: { w: 5, h: 5, source: 'estimated' },
  GeothermalPowerStation: { w: 6, h: 8, source: 'estimated' },
  MatrixLab: { w: 5, h: 5, source: 'estimated', note: 'prefab selectSize 6.1' },
  SelfEvolutionLab: { w: 6, h: 6, source: 'estimated' },
  MiningMachine: { w: 4, h: 6, source: 'estimated', note: 'prefab selectSize 4x7' },
  AdvancedMiningMachine: { w: 5, h: 8, source: 'estimated' },
  WaterPump: { w: 3, h: 5, source: 'estimated' },
  OilExtractor: { w: 7, h: 12, source: 'estimated' },
  OilRefinery: { w: 4, h: 7, source: 'documented' },
  Fractionator: { w: 5, h: 5, source: 'estimated' },
  MiniatureParticleCollider: { w: 6, h: 11, source: 'estimated' },
  PlanetaryLogisticsStation: { w: 5, h: 5, source: 'estimated' },
  InterstellarLogisticsStation: { w: 8, h: 8, source: 'estimated' },
  LogisticsDistributor: { w: 3, h: 3, source: 'estimated' },
  OrbitalCollector: { w: 8, h: 8, source: 'estimated' },
  // The dataset uses the current in-game names (Depot Mk.I/II); the wiki's
  // "Storage Mk.I/II" and the icon filenames still use the older wording.
  DepotMk1: { w: 2, h: 2, source: 'estimated' },
  DepotMk2: { w: 2, h: 2, source: 'estimated' },
  StorageTank: { w: 4, h: 4, source: 'estimated' },
  Accumulator: { w: 1, h: 2, source: 'estimated' },
  EMRailEjector: { w: 5, h: 5, source: 'estimated' },
  RayReceiver: { w: 5, h: 7, source: 'estimated' },
  EnergyExchanger: { w: 4, h: 8, source: 'estimated' },
  VerticalLaunchingSilo: { w: 10, h: 18, source: 'estimated' },
  PlanetaryShieldGenerator: { w: 7, h: 7, source: 'estimated' },
  Foundation: { w: 1, h: 1, source: 'documented' },
};
