/**
 * Blueprint wire formats used by Dyson Sphere Program.
 *
 * Two encodings exist in the wild and both are supported:
 *
 *  1. "text"  — the classic format copied to the clipboard:
 *
 *         BLUEPRINT:0,10,0,0,0,0,0,0,<csharpTicks>,<gameVersion>,<urlEncShortDesc>,
 *         "<urlEncLongDesc>,<base64Data>"<MD5F_HEX>
 *
 *     `base64Data` decodes to a gzip stream whose payload is the binary body
 *     described below. The MD5F hash is computed over the whole string up to
 *     (but excluding) the final `"` — i.e. the leading quote of the data field
 *     is inside the hashed region.
 *
 *  2. "binary" — the newer format used by the web/blueprint tooling:
 *
 *         "DYBP" | version(u8) | payloadLength(u32 LE) | payload
 *
 *     The exact sub-encoding of the payload is version dependent, so decoding
 *     tries gzip, zlib and stored (raw) in order and reports which one matched.
 *     Exporting always writes gzip, which the game accepts.
 *
 * See docs/BLUEPRINT-FORMAT.md for the byte-level body layout and sources.
 */

import { md5f } from './md5f.ts';
import { gunzipBytes, gzipBytes } from './gzip.ts';

// ---------------------------------------------------------------------------
// Binary body (payload) structures
// ---------------------------------------------------------------------------

/** 32-byte header of the decompressed body. */
export interface BlueprintHeader {
  version: number;
  cursorOffsetX: number;
  cursorOffsetY: number;
  cursorTargetArea: number;
  dragboxSizeX: number;
  dragboxSizeY: number;
  primaryAreaIndex: number;
  areaCount: number;
}

/** 16-byte area record; every blueprint has at least one (a sphere segment). */
export interface BlueprintArea {
  index: number;
  parentIndex: number;
  tropicAnchor: number;
  areaSegments: number;
  anchorLocalOffsetX: number;
  anchorLocalOffsetY: number;
  width: number;
  height: number;
}

/** One placed building. `parameters` length is `parameterCount`. */
export interface BlueprintBuilding {
  index: number;
  areaIndex: number;
  /** Absolute position inside the blueprint, in grid cells (1 cell = 1 m). */
  x: number;
  y: number;
  z: number;
  /** Secondary anchor (used by a few multi-part buildings), usually 0. */
  x2: number;
  y2: number;
  z2: number;
  /** Yaw rotation in radians; -1 means "not applicable" in some old writers. */
  yaw: number;
  yaw2: number;
  /**
   * Pitch/tilt are only serialised for belts and sorters (2000 < itemId < 2020).
   * Optional on write input; the encoder writes 0 for buildings that do not
   * carry them.
   */
  tilt?: number;
  pitch?: number;
  tilt2?: number;
  pitch2?: number;
  /** Building prototype id. */
  itemId: number;
  /** Recipe prototype id currently set on the machine, 0 = none. */
  recipeId: number;
  modelIndex: number;
  outputObjectIndex: number;
  inputObjectIndex: number;
  outputToSlot: number;
  inputFromSlot: number;
  outputFromSlot: number;
  inputToSlot: number;
  outputOffset: number;
  inputOffset: number;
  filterId: number;
  parameters: number[];
  /**
   * The trailing i32 array of a **v1** record, in file order.
   *
   * v1 has no `recipeId` / `filterId` / `parameters` fields at all — its fixed head is
   * `index, areaIndex, anchor, anchor2, yaw, yaw2, itemId, modelIndex` and then this array. So
   * anything a machine needs beyond its position and prototype has to live here. The length is
   * not stored as an integer in the head; it follows from the record boundary, and `n` is a
   * function of the prototype.
   *
   * Absent for `path102` records, which carry the named fields instead.
   */
  tail?: number[];
  /** 4-byte record trailer; always 0 in observed data, but part of the record. */
  trailer?: number;
}

export interface BlueprintBody {
  header: BlueprintHeader;
  areas: BlueprintArea[];
  buildings: BlueprintBuilding[];
  /**
   * Declared building count from the payload. Reading this (rather than
   * `buildings.length`) lets a caller notice a decode that found the count but
   * could not read the records — e.g. a payload wrapper this codec does not
   * support yet.
   */
  declaredBuildingCount?: number;
  /** Which building-record layout the body was decoded from (absent on encode input). */
  layout?: BodyLayout;
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export interface BlueprintIcon {
  layout: number;
  images: [number, number, number, number, number];
  /** Envelope v1 records a leading icon prototype id. */
  id?: number;
}

export interface BlueprintMeta {
  /** C# DateTime ticks (100 ns since 0001-01-01). */
  timestampTicks: number;
  gameVersion: string;
  shortDesc: string;
  longDesc: string;
  icon: BlueprintIcon;
  /** Envelope v1 only. */
  author?: string;
  /** Envelope v1 only: a user-defined blueprint revision string. */
  customVersion?: string;
  /** Envelope v1 only: `;`-separated attribute tags. */
  attributes?: string[];
}

export interface DecodedBlueprint {
  /** Which wire format was detected. */
  format: 'text' | 'binary';
  meta: BlueprintMeta;
  body: BlueprintBody;
  /**
   * Text envelope version: 0 = classic layout, 1 = newer layout (leading icon
   * id, icon layout in the next field). Real blueprints use both.
   */
  envelopeVersion?: number;
  /** For binary blueprints: the container version byte. */
  containerVersion?: number;
  /** Which payload codec was found inside a binary container. */
  payloadCodec?: 'gzip' | 'zlib' | 'stored';
  /** Present when the text envelope carried a hash and it did not match. */
  hashWarning?: string;
}

// ---------------------------------------------------------------------------
// base64 helpers (work in both browser and Node)
// ---------------------------------------------------------------------------

declare const Buffer:
  | { from(data: string, enc: string): { toString(enc: string): string } }
  | undefined;

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return (Buffer as NonNullable<typeof Buffer>).from(bytes as unknown as string, 'base64').toString('base64');
  }
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, '');
  if (typeof Buffer !== 'undefined') {
    const buf = (Buffer as NonNullable<typeof Buffer>).from(clean, 'base64');
    const out = new Uint8Array((buf as unknown as { length: number }).length);
    for (let i = 0; i < out.length; i++) out[i] = (buf as unknown as { [k: number]: number })[i]!;
    return out;
  }
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// Binary body codec
// ---------------------------------------------------------------------------
//
// Layout (all little endian), verified against real blueprints exported from the
// game and against the reference parser in LRFalk01/DSP-Blueprint-Parser:
//
//   header   32 bytes: version u32, cursor x/y i32, cursorTargetArea i32,
//                      dragbox x/y i32, primaryAreaIndex i32, areaCount u8
//   areas    areaCount × 16 bytes
//   count    u32 building count
//   records  `count` records, each beginning with a discriminated path number:
//
//     pathNum <= -102   newest layout (dominant in current game versions)
//     pathNum <= -101   previous layout
//     pathNum <= -100   older layout (no leading index/itemId order change)
//     otherwise         legacy layout where the record has no path number at all
//                       and `index` IS the number that was just read
//
// Only the newest layout is written back, because the game is forward
// compatible and accepts it.
//
// The pitch/tilt fields exist ONLY for belts and sorters: itemId in (2000,2010)
// stores one extra float, itemId in (2010,2020) stores seven. Everything else
// stores nothing and the secondary anchor mirrors the primary one.



/**
 * Body header/area variants observed in real blueprints:
 *
 *   body version 0/1 : 32-byte header, 16-byte area records
 *   body version 2   : 28-byte header (the 3 reserved bytes are gone), 14-byte
 *                      area records
 *
 * Verified against real game exports: with the wrong variant the very first
 * building path number lands mid-record, and with the right one every record
 * walks exactly to the end of the buffer.
 */
interface BodyVariant {
  name: string;
  headerSize: number;
  areaSize: number;
}

/** The layout verified against the ground-truth game blueprint. */
const VARIANT_V1: BodyVariant = { name: 'detected', headerSize: 29, areaSize: 14 };

const VARIANTS: BodyVariant[] = [
  { name: 'v2', headerSize: 28, areaSize: 14 },
  { name: 'v1', headerSize: 32, areaSize: 16 },
];

/** Which building-record layout a body uses. */
export type BodyLayout = 'path102' | 'path101' | 'path100' | 'v1fixed' | 'v1variable' | 'legacy';

const LAYOUT_ORDER: BodyLayout[] = ['path102', 'path101', 'path100', 'legacy'];

interface Reader {
  bytes: Uint8Array;
  view: DataView;
  offset: number;
}

function makeReader(bytes: Uint8Array): Reader {
  return { bytes, view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), offset: 0 };
}

function need(reader: Reader, count: number, what: string): void {
  if (reader.offset + count > reader.bytes.length) {
    throw new Error(`truncated blueprint body: need ${count} bytes for ${what} at offset ${reader.offset}, only ${reader.bytes.length - reader.offset} left`);
  }
}

function i8(reader: Reader, what: string): number {
  need(reader, 1, what);
  const v = reader.view.getInt8(reader.offset);
  reader.offset += 1;
  return v;
}
function u8(reader: Reader, what: string): number {
  need(reader, 1, what);
  const v = reader.view.getUint8(reader.offset);
  reader.offset += 1;
  return v;
}
function i16(reader: Reader, what: string): number {
  need(reader, 2, what);
  const v = reader.view.getInt16(reader.offset, true);
  reader.offset += 2;
  return v;
}
function u16(reader: Reader, what: string): number {
  need(reader, 2, what);
  const v = reader.view.getUint16(reader.offset, true);
  reader.offset += 2;
  return v;
}
function i32(reader: Reader, what: string): number {
  need(reader, 4, what);
  const v = reader.view.getInt32(reader.offset, true);
  reader.offset += 4;
  return v;
}
function u32(reader: Reader, what: string): number {
  need(reader, 4, what);
  const v = reader.view.getUint32(reader.offset, true);
  reader.offset += 4;
  return v;
}
function f32(reader: Reader, what: string): number {
  need(reader, 4, what);
  const v = reader.view.getFloat32(reader.offset, true);
  reader.offset += 4;
  return v;
}

/** Read the 14 data bytes shared by both area-record variants. */
function readAreaFields(reader: Reader, index: number): BlueprintArea {
  return {
    index: i8(reader, `area[${index}].index`),
    parentIndex: i8(reader, `area[${index}].parentIndex`),
    tropicAnchor: i16(reader, `area[${index}].tropicAnchor`),
    areaSegments: i16(reader, `area[${index}].areaSegments`),
    anchorLocalOffsetX: i16(reader, `area[${index}].anchorLocalOffsetX`),
    anchorLocalOffsetY: i16(reader, `area[${index}].anchorLocalOffsetY`),
    width: i16(reader, `area[${index}].width`),
    height: i16(reader, `area[${index}].height`),
  };
}

/** Header + areas for a specific body variant. */
function readPreamble(reader: Reader, variant: BodyVariant): { header: BlueprintHeader; areas: BlueprintArea[] } {
  const header: BlueprintHeader = {
    version: u32(reader, 'header.version'),
    cursorOffsetX: i32(reader, 'header.cursorOffsetX'),
    cursorOffsetY: i32(reader, 'header.cursorOffsetY'),
    cursorTargetArea: i32(reader, 'header.cursorTargetArea'),
    dragboxSizeX: i32(reader, 'header.dragboxSizeX'),
    dragboxSizeY: i32(reader, 'header.dragboxSizeY'),
    primaryAreaIndex: i32(reader, 'header.primaryAreaIndex'),
    areaCount: u8(reader, 'header.areaCount'),
  };
  if (header.areaCount > 64) throw new Error(`implausible area count ${header.areaCount}`);
  const areas: BlueprintArea[] = [];
  if (variant.areaSize === 14) {
    // body v2: 28-byte header, 14-byte area records, no padding.
    for (let i = 0; i < header.areaCount; i++) areas.push(readAreaFields(reader, i));
    return { header, areas };
  }
  // body v1: 32-byte header (3 reserved bytes) and each 14-byte area record is
  // padded with 2 zero bytes to 16.
  for (let i = 0; i < 3; i++) u8(reader, 'header.reserved');
  for (let i = 0; i < header.areaCount; i++) {
    areas.push(readAreaFields(reader, i));
    i8(reader, `area[${i}].pad0`);
    i8(reader, `area[${i}].pad1`);
  }
  return { header, areas };
}

function baseBuilding(index: number): BlueprintBuilding {
  return {
    index,
    areaIndex: 0,
    x: 0,
    y: 0,
    z: 0,
    x2: 0,
    y2: 0,
    z2: 0,
    yaw: 0,
    yaw2: 0,
    tilt: 0,
    pitch: 0,
    tilt2: 0,
    pitch2: 0,
    itemId: 0,
    recipeId: 0,
    modelIndex: 0,
    outputObjectIndex: -1,
    inputObjectIndex: -1,
    outputToSlot: 0,
    inputFromSlot: 0,
    outputFromSlot: 0,
    inputToSlot: 0,
    outputOffset: 0,
    inputOffset: 0,
    filterId: 0,
    parameters: [],
  };
}

/** Trailing block shared by every layout: object indices, slots, recipe, params. */
function readTail(reader: Reader, building: BlueprintBuilding): void {
  building.outputObjectIndex = i32(reader, 'outputObjectIndex');
  building.inputObjectIndex = i32(reader, 'inputObjectIndex');
  readSlotBlock(reader, building);
}

/**
 * Belts and sorters carry extra orientation floats. Returns how many were read
 * so the encoder can mirror the decision.
 */
/**
 * Belts and sorters carry extra orientation floats. Returns how many were read
 * so the encoder can mirror the decision.
 *
 * Belt block = 4 bytes, not 8. This was the last wrong field of the record layout,
 * and it was caught by geometry rather than by round-tripping: the ground-truth
 * fixture is a closed ring of 37 belts, and reading `outputObjectIndex` four bytes
 * earlier (`+33`, immediately after the belt block) makes 34 of 37 belts point at a
 * belt one cell away, forming the ring in order. With the previous 8-byte block the
 * field landed on `-1` and the value `2` — a real object id — was being read as the
 * tail. `tools/confirm-layout.ts` re-checks this; `tools/solve-endpoints.ts` is the
 * original probe.
 *
 * The 4 bytes freed by the shorter belt block are the record's trailer, which reads
 * as zero in every record of the fixture.
 */
function readBeltOrientation(reader: Reader, building: BlueprintBuilding, layout: BodyLayout): void {
  const id = building.itemId;
  if (layout !== 'path102' && layout !== 'path101') {
    // Older layouts always serialise one tilt float and no pitch.
    building.tilt = f32(reader, 'tilt');
    building.x2 = building.x;
    building.y2 = building.y;
    building.z2 = building.z;
    building.yaw2 = building.yaw;
    return;
  }
  if (id > 2000 && id < 2010) {
    // Belt: a single orientation float.
    building.tilt = f32(reader, 'belt.tilt');
    building.x2 = building.x;
    building.y2 = building.y;
    building.z2 = building.z;
    building.yaw2 = building.yaw;
  } else if (id > 2010 && id < 2020) {
    // Sorter: tilt, pitch, secondary anchor, secondary rotation.
    building.tilt = f32(reader, 'sorter.tilt');
    building.pitch = f32(reader, 'sorter.pitch');
    building.x2 = f32(reader, 'sorter.x2');
    building.y2 = f32(reader, 'sorter.y2');
    building.z2 = f32(reader, 'sorter.z2');
    building.yaw2 = f32(reader, 'sorter.yaw2');
    building.tilt2 = f32(reader, 'sorter.tilt2');
    building.pitch2 = f32(reader, 'sorter.pitch2');
  } else {
    building.x2 = building.x;
    building.y2 = building.y;
    building.z2 = building.z;
    building.yaw2 = building.yaw;
  }
}

/** The six int8 slot bytes plus recipe/filter/parameter count, then parameters. */
function readSlotBlock(reader: Reader, building: BlueprintBuilding): void {
  building.outputToSlot = i8(reader, 'outputToSlot');
  building.inputFromSlot = i8(reader, 'inputFromSlot');
  building.outputFromSlot = i8(reader, 'outputFromSlot');
  building.inputToSlot = i8(reader, 'inputToSlot');
  building.outputOffset = i8(reader, 'outputOffset');
  building.inputOffset = i8(reader, 'inputOffset');
  building.recipeId = i16(reader, 'recipeId');
  building.filterId = i16(reader, 'filterId');
  const parameterCount = u16(reader, 'parameterCount');
  if (parameterCount > 4096) throw new Error(`implausible parameterCount ${parameterCount}`);
  for (let p = 0; p < parameterCount; p++) building.parameters.push(i32(reader, `parameters[${p}]`));
  // 4-byte record trailer. Every record in the ground-truth body ends with it and it
  // reads as zero, but it must still be consumed: skipping it made the reader walk
  // 53-byte records and then land 4 bytes short of the next path marker, which is
  // what surfaced as "record 1 has path number 0".
  building.trailer = u32(reader, 'trailer');
}

/**
 * Read `count` records of the LEGACY layout (no path number on each record).
 * The newer layouts go through `readRecord` instead.
 */
function readBuildings(reader: Reader, count: number): BlueprintBuilding[] {
  const buildings: BlueprintBuilding[] = [];
  for (let i = 0; i < count; i++) {
    const building = baseBuilding(i);
    building.areaIndex = i8(reader, `building[${i}].areaIndex`);
    building.x = f32(reader, `building[${i}].x`);
    building.y = f32(reader, `building[${i}].y`);
    building.z = f32(reader, `building[${i}].z`);
    building.x2 = f32(reader, `building[${i}].x2`);
    building.y2 = f32(reader, `building[${i}].y2`);
    building.z2 = f32(reader, `building[${i}].z2`);
    building.yaw = f32(reader, `building[${i}].yaw`);
    building.yaw2 = f32(reader, `building[${i}].yaw2`);
    building.itemId = i16(reader, `building[${i}].itemId`);
    building.modelIndex = i16(reader, `building[${i}].modelIndex`);
    readTail(reader, building);
    buildings.push(building);
  }
  return buildings;
}

/** Layouts that carry a leading path discriminant on every record. */
const PATH_LAYOUTS: BodyLayout[] = ['path102', 'path101', 'path100'];

/**
 * The body-version-1 fixed record: **61 bytes, no path discriminant**.
 *
 * Read off the game's own data rather than guessed. The head is `index` then
 * `areaIndex` then two `Vector3` blocks, and the prototype id sits at +37:
 *
 *   +0   i32    index        (equals the record ordinal in every file examined)
 *   +4   u8     areaIndex
 *   +5   f32x8  two anchors  (x, y, z) and (x2, y2, z2) plus two more floats
 *   +37  i16    itemId
 *   +39  i16    modelIndex
 *   +41  i32    inputObjectIndex (reads -1 for whole files)
 *   +45  i32    link             (2, 4, 6, 8, 10 in the wind file)
 *   +49  u8 x12  reserved
 *
 * Evidence this is the real layout and not a coincidence:
 *  - `itemId` at +37 is a measured column, not an assumption: in the stacked-turbine
 *    file it reads 2203 (Wind Turbine) for six records and 1131 for five, and in the
 *    8687-building polar-solar file it reads 2205 (Solar Panel) for 8672 records and
 *    1131 for 15. `modelIndex` at +39 reads 53/37 and 55/37 respectively;
 *  - the three-float block at +5 steps in an exact 8-unit ladder
 *    (-0.0001, 8.0, 16.0, 24.0, 32.0, 40.0) in the turbine file — a vertically stacked
 *    turbine blueprint;
 *  - `inputObjectIndex` at +41 reads -1 for the turbines and 0 for the 1131 records,
 *    and `link` at +45 reads 2, 4, 6, 8, 10 — each turbine's successor;
 *  - 10 of the 27 cached v1 blueprints walk completely at this size over 30,480
 *    records, with `index` equal to the record ordinal in every single one, and the
 *    walk lands exactly on the buffer end.
 *
 * The record is a fixed 61 bytes with no parameter list, so nothing here can make the
 * walk overrun. Fields this layout does not carry keep their neutral defaults; the input
 * reference and the link are preserved because they are what makes a blueprint's
 * connectivity readable.
 *
 * Only the fixed-size subset is supported: some v1 files contain longer records (the
 * belt/sorter orientation rule for v1 is not yet pinned down) and those are reported as
 * undecodable rather than parsed with a wrong stride.
 */
const V1_PLAIN_SIZE = 61;

function readV1Record(reader: Reader, index: number): BlueprintBuilding {
  const building = baseBuilding(index);
  building.index = i32(reader, `building[${index}].index`);
  building.areaIndex = i8(reader, `building[${index}].areaIndex`);
  building.x = f32(reader, `building[${index}].x`);
  building.y = f32(reader, `building[${index}].y`);
  building.z = f32(reader, `building[${index}].z`);
  building.x2 = f32(reader, `building[${index}].x2`);
  building.y2 = f32(reader, `building[${index}].y2`);
  building.z2 = f32(reader, `building[${index}].z2`);
  // The two floats at +29 and +33 are the orientation pair. Measured on the real
  // blueprints they hold exact right angles bounded in [0, 360), i.e. degrees — see
  // `tools/probe-v1-angles.ts`. The decoder used to read and discard them.
  building.yaw = f32(reader, `building[${index}].yaw`);
  building.yaw2 = f32(reader, `building[${index}].yaw2`);
  building.itemId = i16(reader, `building[${index}].itemId`);
  building.modelIndex = i16(reader, `building[${index}].modelIndex`);
  // The fixed-stride family carries five i32 elements here. They are captured rather than
  // discarded because they are the only place a v1 record can hold anything beyond position
  // and prototype — see `BlueprintBuilding.tail`.
  const fixedTail: number[] = [];
  for (let i = 0; i < 5; i++) fixedTail.push(i32(reader, `building[${index}].tail[${i}]`));
  building.tail = fixedTail;
  building.recipeId = v1TailRecipeId(fixedTail);
  return building;
}

/**
 * The recipe id inside a v1 tail array, or -1 when the tail carries none.
 *
 * The v1 tail is **byte-packed**, not an array of meaningful i32s. The recipe sits at tail byte
 * offset 14 as an `i16`, which is the high half of `tail[3]` — so `(tail[3] << 16) >> 16` reads it
 * as a signed 16-bit value. Read as a float, the same four bytes look like 32.0 / 8.0 / 0.03125,
 * which is exactly the trap: `0x42000000` is 32.0f and recipe 66.
 *
 * Evidence this is the recipe and not a coincidence, over 41,875 tail-carrying buildings:
 *
 *   - every crafting machine yields a valid recipe — PlaneSmelter 504/504, ArcSmelter 26/26,
 *     AssemblingMachineMk2 16/16, AssemblingMachineMk1 14/14;
 *   - every belt, sorter, power, storage and logistics building yields `0`, never a recipe;
 *   - the values agree with the blueprints' own names: the three 星际熔炉 files are named
 *     钛合金 / 钛块 / 高效金刚石 and give 66 (TitaniumAlloy) / 65 (TitaniumIngot) /
 *     61 (DiamondAdvanced) respectively.
 *
 * `tools/verify-v1-recipe-offset.ts` re-checks all three properties.
 */
function v1TailRecipeId(tail: number[] | undefined): number {
  if (!tail || tail.length < 4) return -1;
  // Note: `(tail[3] << 16) >> 16` would be wrong here — `0x00420000 << 16` overflows 32-bit and
  // yields 0, silently losing every recipe. Shift down and sign-extend instead.
  const raw = (tail[3]! >> 16) & 0xffff;
  return raw >= 0x8000 ? raw - 0x10000 : raw;
}

/**
 * Body-version-1 record head, shared by every record length.
 *
 * The variable-length family satisfies `length = 41 + 4n` exactly (1649 of 1654 records
 * across the corpus), which reads as this 41-byte head plus an array of i32 elements:
 *
 *   +0   i32    index
 *   +4   u8     areaIndex
 *   +5   f32x3  first anchor  (x, y, z)
 *   +17  f32x3  second anchor (x2, y2, z2)
 *   +29  f32    yaw   (degrees)
 *   +33  f32    yaw2  (degrees)
 *   +37  i16    itemId
 *   +39  i16    modelIndex
 *   +41  ...    i32 array, length n
 *
 * The element count is **not stored as a plain integer anywhere in the head**, so the
 * record length cannot be computed from its contents. It is instead located by the
 * invariant that `index` equals the record's ordinal and `itemId` at +37 is a real
 * building id, with the walk required to consume the record area exactly.
 */
const V1_HEAD_SIZE = 41;
/**
 * Upper bound for a plausible single record, used only to bound the boundary search.
 *
 * Records in the corpus are mostly 41-89 bytes, but they are not bounded by that: the two
 * `火电` blueprints place their next record **exactly 8253 bytes** after the previous one, and
 * one cached blueprint's entire record area is 8253 bytes for a single building. That is
 * `41 + 4 x 2053`, so a record can carry a very long parameter array.
 *
 * The earlier value of 8192 was 61 bytes short of that, which is why raising it from 512 to
 * 8192 changed nothing and the two files kept stopping mid-walk.
 */
const V1_MAX_RECORD = 65536;

/**
 * Measured element count `n` per prototype id, so the record length is `41 + 4n`.
 *
 * `n` is not stored in the head, but it is a function of the prototype for every id the
 * corpus exercises except belts: buildings carry 5, sorters 6, and a belt carries 5 or 7
 * depending on whether something extra is attached to it (measured: `tools/solve-v1-n.ts`).
 * Having candidates per id makes the record length a short deterministic choice rather than
 * an open scan, which is what stops the walk from landing on a spurious boundary.
 *
 * Ids outside this table still fall back to the scan, so an unmeasured prototype degrades
 * to the previous behaviour instead of failing.
 */
const V1_ELEMENT_COUNTS = new Map<number, number[]>([
  [1131, [5]], // Foundation
  [2201, [5]], // Tesla Tower
  [2203, [5]], // Wind Turbine  — proven by the fixed 61-byte family
  [2204, [5]], // Thermal Power Plant
  [2205, [5]], // Solar Panel   — proven by the fixed 61-byte family
  [2211, [5]], // Mini Fusion Power Plant
  [2011, [6]], // Sorter Mk.I
  [2013, [6]], // Sorter Mk.III
  [2210, [6]], // Artificial Star
]);
/** Belts carry 5 elements, or 7 when the record holds the extra pair. */
const V1_BELT_SHORT = 5;
const V1_BELT_LONG = 7;

/** Candidate element counts for one record, most likely first. */
function v1ElementCandidates(itemId: number): number[] {
  const known = V1_ELEMENT_COUNTS.get(itemId);
  if (known) return known;
  if (itemId > 2000 && itemId < 2010) return [V1_BELT_SHORT, V1_BELT_LONG];
  return [];
}

/**
 * The prototype-id window a v1 record head must fall in to count as a record start.
 *
 * Derived from the shipped dataset, whose building ids run 1131 (Foundation) to 5003 —
 * `test/browser-safety.test.ts` and `test/dataset.test.ts` keep that range honest. It is
 * deliberately a range rather than an exact membership test, because the dataset lists only
 * the buildings the simulator models while the game defines more.
 *
 * This bound is what makes the variable-length walk safe: a first attempt using `id < 8000`
 * accepted spurious `index == ordinal` matches whose +37 read 3, 4, 11 or 131, producing 25
 * buildings with impossible `areaIndex` values. The narrower window rejects them.
 */
const V1_ITEM_ID_MIN = 1100;
const V1_ITEM_ID_MAX = 5100;

/** Does the 2-byte read at +37 look like a DSP building prototype id? */
function v1HeadLooksValid(view: DataView, at: number, limit: number, areaCount: number): boolean {
  if (at + V1_HEAD_SIZE > limit) return false;
  const id = view.getInt16(at + 37, true);
  if (id < V1_ITEM_ID_MIN || id > V1_ITEM_ID_MAX) return false;
  // `areaIndex` is a u8 at +4 and the header declares how many areas exist, so a record
  // start must point at a real one. This is the check that rejects the remaining spurious
  // boundaries, which read 0xFF (i.e. -1) there.
  return view.getUint8(at + 4) < Math.max(1, areaCount);
}

function readV1Head(reader: Reader, index: number): BlueprintBuilding {
  const building = baseBuilding(index);
  building.index = i32(reader, `building[${index}].index`);
  building.areaIndex = i8(reader, `building[${index}].areaIndex`);
  building.x = f32(reader, `building[${index}].x`);
  building.y = f32(reader, `building[${index}].y`);
  building.z = f32(reader, `building[${index}].z`);
  building.x2 = f32(reader, `building[${index}].x2`);
  building.y2 = f32(reader, `building[${index}].y2`);
  building.z2 = f32(reader, `building[${index}].z2`);
  building.yaw = f32(reader, `building[${index}].yaw`);
  building.yaw2 = f32(reader, `building[${index}].yaw2`);
  building.itemId = i16(reader, `building[${index}].itemId`);
  building.modelIndex = i16(reader, `building[${index}].modelIndex`);
  return building;
}

/** Read one record for a layout that uses path discriminants. */
function readRecord(reader: Reader, layout: BodyLayout, index: number, variant: BodyVariant): BlueprintBuilding {
  const building = baseBuilding(index);
  if (layout === 'path100') {
    // path100 has no leading itemId/modelIndex pair: index, areaIndex, 6 floats
    // (primary + secondary anchor), yaw, yaw2, tilt, then itemId/modelIndex.
    building.index = i32(reader, `building[${index}].index`);
    building.areaIndex = i8(reader, `building[${index}].areaIndex`);
    building.x = f32(reader, `building[${index}].x`);
    building.y = f32(reader, `building[${index}].y`);
    building.z = f32(reader, `building[${index}].z`);
    building.x2 = f32(reader, `building[${index}].x2`);
    building.y2 = f32(reader, `building[${index}].y2`);
    building.z2 = f32(reader, `building[${index}].z2`);
    building.yaw = f32(reader, `building[${index}].yaw`);
    building.yaw2 = f32(reader, `building[${index}].yaw2`);
    building.tilt = f32(reader, `building[${index}].tilt`);
    building.itemId = i16(reader, `building[${index}].itemId`);
    building.modelIndex = i16(reader, `building[${index}].modelIndex`);
    readTail(reader, building);
    return building;
  }
  // path102 / path101: index, itemId, modelIndex, areaIndex, x, y, z, yaw,
  // then belt/sorter orientation, then the shared tail.
  building.index = i32(reader, `building[${index}].index`);
  building.itemId = i16(reader, `building[${index}].itemId`);
  building.modelIndex = i16(reader, `building[${index}].modelIndex`);
  building.areaIndex = i8(reader, `building[${index}].areaIndex`);
  building.x = f32(reader, `building[${index}].x`);
  building.y = f32(reader, `building[${index}].y`);
  building.z = f32(reader, `building[${index}].z`);
  building.yaw = f32(reader, `building[${index}].yaw`);
  if (variant.areaSize === 14) {
    // body v2 records every building with the full orientation block; the game
    // simply mirrors the primary anchor when there is no independent second one.
  }
  readBeltOrientation(reader, building, layout);
  readTail(reader, building);
  return building;
}

/**
 * Decode the binary body, auto-detecting which layout was used.
 *
 * Detection: peek at the first u32 after the areas. A large negative value means
 * a path-discriminant layout (the newest is tried first); a small non-negative
 * value is the legacy building count.
 */
export function decodeBody(bytes: Uint8Array): BlueprintBody {
  if (bytes.length < 32) throw new Error(`blueprint body too short: ${bytes.length} bytes`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const areaCount = bytes[28] ?? 0;
  if (areaCount > 64) throw new Error(`implausible area count ${areaCount}`);

  const header: BlueprintHeader = {
    version: view.getUint32(0, true),
    cursorOffsetX: view.getInt32(4, true),
    cursorOffsetY: view.getInt32(8, true),
    cursorTargetArea: view.getInt32(12, true),
    dragboxSizeX: view.getInt32(16, true),
    dragboxSizeY: view.getInt32(20, true),
    primaryAreaIndex: view.getInt32(24, true),
    areaCount,
  };

  const failures: string[] = [];

  // Verified layout: 29-byte header, then one 14-byte area record each, then a u32
  // building count, then that many records each prefixed by an i32 path number.
  // The 29-byte header length is confirmed by blueprints whose area index/parent
  // pair (-1, -1) and width/height land exactly there.
  for (const areaStart of [29, 28, 32]) {
    const areasEnd = areaStart + areaCount * 14;
    if (areasEnd + 4 > bytes.length) continue;
    try {
      const areas: BlueprintArea[] = [];
      for (let i = 0; i < areaCount; i++) {
        const base = areaStart + i * 14;
        const area: BlueprintArea = {
          index: view.getInt8(base),
          parentIndex: view.getInt8(base + 1),
          tropicAnchor: view.getInt16(base + 2, true),
          areaSegments: view.getInt16(base + 4, true),
          anchorLocalOffsetX: view.getInt16(base + 6, true),
          anchorLocalOffsetY: view.getInt16(base + 8, true),
          width: view.getInt16(base + 10, true),
          height: view.getInt16(base + 12, true),
        };
        if (area.width <= 0 || area.height <= 0 || area.areaSegments <= 0 || area.parentIndex < -1 || area.index < 0) {
          throw new Error(`implausible area ${i} at areaStart ${areaStart}`);
        }
        // Sphere segment counts are in the low hundreds; a wildly different value
        // means we are reading at the wrong offset (this guard is what keeps a
        // mis-detected layout from silently producing nonsense geometry).
        if (area.areaSegments > 4096) {
          throw new Error(`area ${i} has implausible segment count ${area.areaSegments} at areaStart ${areaStart}`);
        }
        areas.push(area);
      }

      // Shape 1: explicit count then path-prefixed records.
      const count = view.getUint32(areasEnd, true);
      const firstPath = areasEnd + 8 <= bytes.length ? view.getInt32(areasEnd + 4, true) : 0;
      if (count > 0 && count < 1_000_000 && firstPath <= -100 && firstPath >= -199) {
        const reader: Reader = { bytes, view, offset: areasEnd + 4 };
        const buildings: BlueprintBuilding[] = [];
        for (let i = 0; i < count; i++) {
          const recordStart = reader.offset;
          const pathNumber = i32(reader, `record[${i}].path`);
          if (pathNumber > -100 || pathNumber < -199) {
            throw new Error(`record ${i} has path number ${pathNumber} (started at ${recordStart}, after ${recordStart - (areasEnd + 4)} bytes)`);
          }
          buildings.push(readRecord(reader, layoutForPath(pathNumber), i, VARIANT_V1));
        }
        assertPlausibleIds(buildings);
        return { header, areas, buildings, layout: layoutForPath(firstPath), declaredBuildingCount: count };
      }

      // Shape 2: records start immediately (no count word).
      const pathHere = view.getInt32(areasEnd, true);
      if (pathHere <= -100 && pathHere >= -199) {
        const reader: Reader = { bytes, view, offset: areasEnd };
        const buildings: BlueprintBuilding[] = [];
        while (reader.offset + 4 <= bytes.length) {
          const pathNumber = i32(reader, 'path');
          if (pathNumber > -100 || pathNumber < -199) break;
          buildings.push(readRecord(reader, layoutForPath(pathNumber), buildings.length, VARIANT_V1));
        }
        if (buildings.length > 0) {
          assertPlausibleIds(buildings);
          return { header, areas, buildings, layout: layoutForPath(pathHere), declaredBuildingCount: buildings.length };
        }
      }
      // Shape 3: body version 1 — a count word, then fixed 61-byte records with no
      // path discriminant. Detected last because it has the weakest framing signal,
      // and accepted only if every record validates AND the walk lands exactly on the
      // buffer end, so a wrong stride cannot silently produce a plausible-looking list.
      if (bytes[0] === 1) {
        const count = view.getUint32(areasEnd, true);
        if (count > 0 && count < 1_000_000 && areasEnd + 4 + count * V1_PLAIN_SIZE === bytes.length) {
          try {
            const reader: Reader = { bytes, view, offset: areasEnd + 4 };
            const buildings: BlueprintBuilding[] = [];
            for (let i = 0; i < count; i++) {
              const building = readV1Record(reader, i);
              if (building.index !== i) throw new Error(`v1 record ${i} has index ${building.index}`);
              buildings.push(building);
            }
            assertPlausibleIds(buildings);
            return { header, areas, buildings, layout: 'v1fixed', declaredBuildingCount: count };
          } catch {
            // Not a fixed-stride v1 body; fall through to the remaining candidates. A
            // rejection here is expected for every other layout, so it is silent — and no
            // `process.env` probe may live in this path, because the engine also runs in
            // the browser where `process` does not exist.
          }
        }
      }

      // Shape 4: body version 1 with variable-length records.
      //
      // The record length is `41 + 4n` but `n` is not stored in the head, so the length
      // cannot be computed. Instead each record start is located by the two invariants the
      // data satisfies: `index` at +0 equals the record's ordinal, and the prototype id at
      // +37 is a real building id. The walk must consume the record area exactly, so a
      // wrong boundary cannot silently produce a plausible list.
      if (bytes[0] === 1) {
        const count = view.getUint32(areasEnd, true);
        if (count > 0 && count < 1_000_000 && bytes.length - (areasEnd + 4) > count * V1_HEAD_SIZE) {
          try {
            const areaStart = areasEnd + 4;
            const areaEnd = bytes.length;
            const bounds: number[] = [];
            for (let wanted = 0; wanted < count; wanted++) {
              // Start after the previous record's head, never at or inside it: a record is
              // at least V1_HEAD_SIZE bytes, so scanning from the previous boundary would
              // let a 4-byte value inside that record masquerade as the next record start.
              const prev = bounds.length > 0 ? bounds[bounds.length - 1]! : 0;
              const from = areaStart + prev + (bounds.length > 0 ? V1_HEAD_SIZE : 0);
              let found = -1;

              // First try the measured length for this prototype, which is exact when it
              // applies and cannot land on a spurious boundary.
              //
              // `wanted` is the ordinal of the record whose start is being located, and
              // `next` is that start, so the value there must be `wanted`. An earlier
              // version compared against `wanted + 1`, which never matched and silently
              // disabled this path — leaving the weaker scan to accept a wrong boundary.
              if (bounds.length > 0) {
                const itemId = view.getInt16(areaStart + prev + 37, true);
                for (const n of v1ElementCandidates(itemId)) {
                  const next = areaStart + prev + V1_HEAD_SIZE + 4 * n;
                  if (next + V1_HEAD_SIZE > areaEnd) continue;
                  // The guards are re-checked even here: a computed length is only a
                  // candidate, and the boundary it points at must still look like a record.
                  if (view.getInt32(next, true) !== wanted) continue;
                  if (!v1HeadLooksValid(view, next, areaEnd, areaCount)) continue;
                  found = next - areaStart;
                  break;
                }
              }

              // Fall back to locating the boundary from the invariants.
              if (found < 0) {
                for (let at = from; at + V1_HEAD_SIZE <= areaEnd; at++) {
                  const len = at - areaStart - prev;
                  if (bounds.length > 0 && len > V1_MAX_RECORD) break;
                  if (view.getInt32(at, true) !== wanted) continue;
                  if (!v1HeadLooksValid(view, at, areaEnd, areaCount)) continue;
                  found = at - areaStart;
                  break;
                }
              }

              if (found < 0) throw new Error(`v1 record ${wanted} boundary not found`);
              bounds.push(found);
            }
            if (areaStart + bounds[bounds.length - 1]! + V1_HEAD_SIZE > areaEnd) {
              throw new Error('v1 last record runs past the buffer');
            }
            // Every record length must be `41 + 4n`. The boundary guards are not
            // infallible — one blueprint in the corpus walks to completion with lengths of
            // 52 and 70, which are not on the lattice — so the lattice is checked for every
            // record rather than assumed. A file that fails this is rejected instead of
            // yielding buildings at made-up offsets.
            for (let i = 0; i < bounds.length; i++) {
              const to = i + 1 < bounds.length ? bounds[i + 1]! : areaEnd - areaStart;
              const len = to - bounds[i]!;
              if (len < V1_HEAD_SIZE || (len - V1_HEAD_SIZE) % 4 !== 0) {
                throw new Error(`v1 record ${i} has length ${len}, which is not 41 + 4n`);
              }
            }
            const buildings: BlueprintBuilding[] = [];
            for (let i = 0; i < bounds.length; i++) {
              const from = areaStart + bounds[i]!;
              const to = i + 1 < bounds.length ? areaStart + bounds[i + 1]! : areaEnd;
              const reader: Reader = { bytes, view, offset: from };
              buildings.push(readV1Head(reader, i));
              // The trailing i32 array is captured rather than discarded. v1 has no
              // recipeId/filterId/parameters fields, so a machine's recipe has nowhere else to
              // live; keeping the raw values is what makes that question answerable.
              const tail = to - reader.offset;
              if (tail < 0 || tail % 4 !== 0) throw new Error(`v1 record ${i} has a ragged tail of ${tail} bytes`);
              const values: number[] = [];
              for (let e = 0; e < tail / 4; e++) values.push(i32(reader, `building[${i}].tail[${e}]`));
              buildings[i]!.tail = values;
              buildings[i]!.recipeId = v1TailRecipeId(values);
            }
            assertPlausibleIds(buildings);
            return { header, areas, buildings, layout: 'v1variable', declaredBuildingCount: count };
          } catch {
            // Not a variable-length v1 body either.
          }
        }
      }

      failures.push(`areaStart ${areaStart}: no recognisable record section`);
    } catch (err) {
      failures.push(`areaStart ${areaStart}: ${(err as Error).message}`);
    }
  }

  // Fallback: the oldest bodies put a count first with no per-record path number.
  for (const areaStart of [29, 28, 32]) {
    try {
      const areasEnd = areaStart + areaCount * 14;
      // Re-read the areas for this candidate offset so the returned model is
      // complete (an empty `areas` array would break the blueprint's dimensions).
      const areas: BlueprintArea[] = [];
      for (let i = 0; i < areaCount; i++) {
        const base = areaStart + i * 14;
        areas.push({
          index: view.getInt8(base),
          parentIndex: view.getInt8(base + 1),
          tropicAnchor: view.getInt16(base + 2, true),
          areaSegments: view.getInt16(base + 4, true),
          anchorLocalOffsetX: view.getInt16(base + 6, true),
          anchorLocalOffsetY: view.getInt16(base + 8, true),
          width: view.getInt16(base + 10, true),
          height: view.getInt16(base + 12, true),
        });
      }
      const reader: Reader = { bytes, view, offset: areasEnd };
      const count = u32(reader, 'buildingCount');
      if (count > 1_000_000) throw new Error(`implausible count ${count}`);
      const buildings = readBuildings(reader, count);
      assertPlausibleIds(buildings);
      return { header, areas, buildings, layout: 'legacy', declaredBuildingCount: count };
    } catch (err) {
      failures.push(`legacy areaStart ${areaStart}: ${(err as Error).message}`);
    }
  }

  throw new Error(`could not decode blueprint body — ${failures.slice(0, 4).join(' | ')}`);
}

function layoutForPath(pathNumber: number): BodyLayout {
  if (pathNumber <= -102) return 'path102';
  if (pathNumber <= -101) return 'path101';
  return 'path100';
}

/**
 * A parse that yields nonsense values is a misinterpretation, not a parse.
 *
 * Prototype ids are the strongest signal, but they are not enough on their own:
 * `test/writer-bytes.test.ts` showed the encoder reproduces a ground-truth body
 * byte-for-byte while a field was still being read at the wrong offset, because
 * garbage round-trips through the same wrong offset. These checks catch the
 * remaining value-level nonsense — a position that is not a finite cell
 * coordinate, an orientation that cannot be an angle, or an index that cannot be
 * an object reference.
 */
function assertPlausibleIds(buildings: readonly BlueprintBuilding[]): void {
  for (const b of buildings) {
    if (b.itemId <= 0 || b.itemId > 8000) {
      throw new Error(`implausible prototype id ${b.itemId} for building #${b.index}`);
    }
    for (const [name, value] of [
      ['x', b.x],
      ['y', b.y],
      ['z', b.z],
    ] as const) {
      if (!Number.isFinite(value) || Math.abs(value) > 1e5) {
        throw new Error(`implausible ${name} ${value} for building #${b.index}`);
      }
    }
    // Rotation is in radians but NOT normalised: the ground-truth body stores a
    // 90-degree turn as ~316 rad and 180-degree turns as ~15470 rad, so the raw
    // angle is whatever the game accumulated. Only values that cannot be an angle
    // at all (garbage floats, NaN) are rejected.
    if (!Number.isFinite(b.yaw) || Math.abs(b.yaw) > 1e6) {
      throw new Error(`implausible yaw ${b.yaw} for building #${b.index}`);
    }
    for (const [name, value] of [
      ['outputObjectIndex', b.outputObjectIndex],
      ['inputObjectIndex', b.inputObjectIndex],
    ] as const) {
      // -1 means "no endpoint" (a belt); anything else must be an object id.
      if (value !== -1 && (value < 0 || value > 200_000)) {
        throw new Error(`implausible ${name} ${value} for building #${b.index}`);
      }
    }
  }
}


/**
 * Byte size of one `path102` building record including its path number.
 * Exported so streaming writers and tests can size a buffer without duplicating
 * the layout arithmetic (a mismatch here silently truncates blueprints).
 */
export function buildingRecordSize(itemId: number, parameterCount: number): number {
  // path(4) + index(4) + itemId(2) + model(2) + area(1) + x/y/z/yaw(16)
  // + outputObject/inputObject(8) + 6 slot bytes + recipe(2) + filter(2)
  // + parameterCount(2) = 49, plus parameters, the orientation block and a 4-byte
  // record trailer. A belt therefore measures 49 + 4 + 4 = 57, matching the
  // 57-byte spacing between path markers in the ground-truth body.
  let n = 49 + parameterCount * 4 + 4;
  if (itemId > 2000 && itemId < 2010) n += 4; // belt orientation
  else if (itemId > 2010 && itemId < 2020) n += 32; // sorter orientation
  return n;
}

/**
 * Encode a body. Defaults to the `v1` container (32-byte header, 16-byte area
 * records) because that is the variant verified against a ground-truth blueprint
 * whose expected parse is known; pass `{ bodyVersion: 2 }` for the 28-byte
 * header / 14-byte area variant.
 *
 * Building records use the newest (`path102`) layout, which the game accepts.
 */
/**
 * Encode a body in the format the game itself writes, verified byte for byte
 * against a ground-truth game blueprint: 29-byte header, 14-byte area records,
 * u32 building count, then path-prefixed records.
 */
export function encodeBody(body: BlueprintBody, options: { bodyVersion?: 1 | 2 } = {}): Uint8Array {
  // Version 2 is the newest layout and the one real game bodies carry; nothing in
  // the body layout depends on this value, so a caller may override it.
  const bodyVersion = options.bodyVersion ?? 2;
  const outVariant = bodyVersion === 2 ? VARIANTS[0]! : VARIANTS[1]!;

  // Growable byte buffer: the writer appends, so the encoded length can never
  // disagree with what was written (an earlier fixed-size implementation drifted
  // by a few bytes per record and silently truncated bodies).
  const out: number[] = [];
  const u8 = (v: number): void => void out.push(v & 0xff);
  const i16 = (v: number): void => {
    out.push(v & 0xff, (v >> 8) & 0xff);
  };
  const u16 = (v: number): void => {
    out.push(v & 0xff, (v >> 8) & 0xff);
  };
  const i32 = (v: number): void => {
    out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
  };
  const u32 = (v: number): void => {
    out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  };
  const f32 = (v: number): void => {
    const scratch = new DataView(new ArrayBuffer(4));
    scratch.setFloat32(0, v, true);
    for (let i = 0; i < 4; i++) out.push(scratch.getUint8(i));
  };

  // ---- header ----------------------------------------------------------
  i32(bodyVersion);
  i32(body.header.cursorOffsetX);
  i32(body.header.cursorOffsetY);
  i32(body.header.cursorTargetArea);
  i32(body.header.dragboxSizeX);
  i32(body.header.dragboxSizeY);
  i32(body.header.primaryAreaIndex);
  // The area count is ONE byte, immediately followed by the area records: the
  // real header is 28 bytes + this byte = 29, with the areas starting at offset
  // 29. (Verified against a ground-truth game body byte for byte.)
  u8(body.areas.length);

  // ---- areas -----------------------------------------------------------
  for (const a of body.areas) {
    u8(a.index);
    u8(a.parentIndex);
    i16(a.tropicAnchor);
    i16(a.areaSegments);
    i16(a.anchorLocalOffsetX);
    i16(a.anchorLocalOffsetY);
    i16(a.width);
    i16(a.height);
  }

  // ---- buildings -------------------------------------------------------
  // Layout verified byte for byte against a ground-truth game blueprint: a u32
  // building count followed by that many records, each prefixed by its i32 path
  // number. The body version written is 2, matching the newest layout.
  u32(body.buildings.length);
  for (const b of body.buildings) {
    i32(-102); // newest (path102) record layout
    i32(b.index);
    i16(b.itemId);
    i16(b.modelIndex);
    u8(b.areaIndex);
    f32(b.x);
    f32(b.y);
    f32(b.z);
    f32(b.yaw);
    if (b.itemId > 2000 && b.itemId < 2010) {
      // Belt: a single orientation float. The block is 4 bytes, which is what puts
      // `outputObjectIndex` at +33 — the offset confirmed by belt-ring geometry.
      f32(b.tilt ?? 0);
    } else if (b.itemId > 2010 && b.itemId < 2020) {
      // Sorter: tilt, pitch, secondary anchor, secondary rotation (32 bytes).
      f32(b.tilt ?? 0);
      f32(b.pitch ?? 0);
      f32(b.x2 ?? b.x);
      f32(b.y2 ?? b.y);
      f32(b.z2 ?? b.z);
      f32(b.yaw2 ?? b.yaw);
      f32(b.tilt2 ?? 0);
      f32(b.pitch2 ?? 0);
    }
    i32(b.outputObjectIndex);
    i32(b.inputObjectIndex);
    u8(b.outputToSlot);
    u8(b.inputFromSlot);
    u8(b.outputFromSlot);
    u8(b.inputToSlot);
    u8(b.outputOffset);
    u8(b.inputOffset);
    i16(b.recipeId);
    i16(b.filterId);
    u16(b.parameters.length);
    for (const p of b.parameters) i32(p);
    // 4-byte record trailer. Every record in the ground-truth body carries it and
    // reads as zero; the record size check in `buildingRecordSize` accounts for it.
    u32(b.trailer ?? 0);
  }

  return Uint8Array.from(out);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

const TEXT_PREFIX = 'BLUEPRINT:';
const BINARY_MAGIC = 'DYBP';

export function looksLikeBlueprint(text: string): boolean {
  const t = text.trim();
  return t.startsWith(TEXT_PREFIX) || t.startsWith(BINARY_MAGIC);
}

/** Decode either wire format. `text` may include surrounding whitespace/newlines. */
export async function decodeBlueprint(text: string, opts: { verifyHash?: boolean } = {}): Promise<DecodedBlueprint> {
  const trimmed = text.trim();
  if (trimmed.startsWith(TEXT_PREFIX)) return decodeTextBlueprint(trimmed, opts.verifyHash !== false);
  if (trimmed.startsWith(BINARY_MAGIC)) return decodeBinaryBlueprint(trimmed);
  // Tolerate a bare payload (no header) — some tools export just the container.
  try {
    return await decodeBinaryBlueprint(BINARY_MAGIC + trimmed);
  } catch {
    throw new Error('unrecognized blueprint string: expected a "BLUEPRINT:" or "DYBP" prefix');
  }
}

async function decodeTextBlueprint(s: string, verifyHash: boolean): Promise<DecodedBlueprint> {
  const body = s.slice(TEXT_PREFIX.length);
  // Two envelope shapes exist and they quote differently:
  //
  //   v0 (classic)  ...,<shortDesc>,"<longDesc>,<base64>"<HASH>
  //   v1 (current)  ...,<shortDesc>,<author>,<customVersion>,<attrs>,<longDesc>"<base64>"<HASH>
  //
  // Both end with a closing quote followed by the hash, so anchor on that. In v0
  // the base64 sits inside the quotes after the long description's comma; in v1
  // the base64 is the only thing inside the quotes. Descriptions are NOT
  // reliably percent-encoded and may contain commas, so the split is structural.
  const closeQuote = body.lastIndexOf('"');
  if (closeQuote < 0) throw new Error('malformed BLUEPRINT: missing closing data quote');
  const hash = body.slice(closeQuote + 1).trim();
  // The hashed region STARTS AT THE `BLUEPRINT:` PREFIX: the game signs the whole
  // string it writes, so work from `s` rather than the stripped payload. Getting
  // this wrong makes every single valid blueprint look tampered with.
  const prefix = s.slice(0, TEXT_PREFIX.length + closeQuote);
  const payloadPrefix = body.slice(0, closeQuote);

  let b64: string;
  let longDesc: string;
  let headText: string;
  let v1Shape: boolean;
  const lastComma = payloadPrefix.lastIndexOf(',');
  const tailToken = lastComma >= 0 ? payloadPrefix.slice(lastComma + 1) : '';
  // The two envelope shapes put the base64 in different places, and their
  // quoting is ambiguous, so BOTH candidate payloads are extracted and the one
  // that actually carries the gzip magic bytes wins. That makes shape detection
  // self-validating instead of heuristic.
  const candidates: Array<{ v1: boolean; b64: string; longDesc: string; headText: string }> = [];
  const quotedTail = tailToken.indexOf('"');
  if (quotedTail >= 0 && quotedTail + 1 < tailToken.length) {
    candidates.push({
      v1: true,
      b64: tailToken.slice(quotedTail + 1),
      longDesc: safeDecodeURIComponent(tailToken.slice(0, quotedTail)),
      headText: payloadPrefix.slice(0, lastComma),
    });
  }
  const dataStart = payloadPrefix.lastIndexOf('"');
  if (dataStart >= 0 && dataStart + 1 < prefix.length) {
    const dataField = payloadPrefix.slice(dataStart + 1);
    const payloadComma = dataField.lastIndexOf(',');
    if (payloadComma >= 0) {
      candidates.push({
        v1: false,
        b64: dataField.slice(payloadComma + 1),
        longDesc: safeDecodeURIComponent(dataField.slice(0, payloadComma)),
        headText: payloadPrefix.slice(0, dataStart),
      });
    }
  }
  const gzipMagic = (bytes: Uint8Array): boolean => bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  const chosen = candidates.find((c) => gzipMagic(base64ToBytes(c.b64.slice(0, 8)))) ?? candidates[0];
  if (!chosen) throw new Error('malformed BLUEPRINT: could not locate the base64 payload');
  b64 = chosen.b64;
  longDesc = chosen.longDesc;
  headText = chosen.headText;
  v1Shape = chosen.v1;
  if (!b64) throw new Error('malformed BLUEPRINT: empty base64 payload');

  // Fields before the payload: 0..9 numeric header, 10 shortDesc, then any
  // envelope-version specific fields (11 = longDesc / author, 12 = author /
  // customVersion, 13 = customVersion / attributes, 14 = attributes).
  const fields: string[] = [];
  let cursor = 0;
  for (;;) {
    const next = headText.indexOf(',', cursor);
    if (next < 0) break;
    fields.push(headText.slice(cursor, next));
    cursor = next + 1;
  }
  fields.push(headText.slice(cursor));
  if (fields.length < 11) {
    throw new Error(`malformed BLUEPRINT: header — expected at least 11 fields before the payload, got ${fields.length}`);
  }
  const nums = fields.slice(0, 9).map((p) => Number.parseInt(p, 10));
  if (nums.some((n) => !Number.isFinite(n))) throw new Error('malformed BLUEPRINT: non numeric header field');
  const [
    envelopeVersion,
    layout,
    icon0 = 0,
    icon1 = 0,
    icon2 = 0,
    icon3 = 0,
    icon4 = 0,
    reserved0,
    timestampTicks = 0,
  ] = nums as number[];
  // Field 0 is the ENVELOPE VERSION, not a reserved zero: 0 = the classic
  // layout (icon layout in field 1), 1 = the newer layout where a leading icon
  // id is recorded and the icon layout moves into field 2. Real blueprints in
  // the wild use both, so neither may be rejected outright.
  const ver = envelopeVersion ?? 0;
  const iconId = ver >= 1 ? layout : 0;
  const iconLayout = ver >= 1 ? (icon0 ?? 10) : (layout ?? 10);
  const images = ver >= 1 ? [icon1, icon2, icon3, icon4, reserved0] : [icon0, icon1, icon2, icon3, icon4];
  const gameVersion = fields[9] ?? '0.0.0.0';
  const shortDesc = safeDecodeURIComponent(fields[10] ?? '');
  // Envelope v1: field 11 = author, 12 = customVersion, 13 = attributes.
  const author = ver >= 1 && fields[11] != null ? safeDecodeURIComponent(fields[11]) : undefined;
  const customVersion = ver >= 1 && fields[12] != null ? safeDecodeURIComponent(fields[12]) : undefined;
  const attributesRaw = ver >= 1 && fields[13] != null ? safeDecodeURIComponent(fields[13]) : undefined;
  const attributes = attributesRaw ? attributesRaw.split(';').filter(Boolean) : undefined;

  const compressed = base64ToBytes(b64);
  let payload: Uint8Array;
  try {
    payload = await gunzipBytes(compressed);
  } catch (err) {
    throw new Error(`failed to gunzip blueprint payload: ${(err as Error).message}`);
  }
  const decodedBody = decodeBody(payload);
  const result: DecodedBlueprint = {
    format: 'text',
    envelopeVersion: ver,
    meta: {
      timestampTicks,
      gameVersion,
      shortDesc,
      longDesc,
      icon: {
        layout: iconLayout,
        images: [images[0] ?? 0, images[1] ?? 0, images[2] ?? 0, images[3] ?? 0, images[4] ?? 0],
        ...(iconId ? { id: iconId } : {}),
      },
      ...(author ? { author } : {}),
      ...(customVersion ? { customVersion } : {}),
      ...(attributes ? { attributes } : {}),
    },
    body: decodedBody,
  };
  // Re-verify the hash. The hashed region is everything up to and INCLUDING the
  // opening quote of the data field, so:
  //   v0: hash covers `…,"<longDesc>,<base64>` minus the trailing quote  => prefix
  //   v1: the base64 is not preceded by a comma, so the quote that opens the data
  //       field sits one character before the close quote => prefix + '"'
  // Descriptions are not consistently percent-encoded in the wild, so both the
  // raw and the percent-encoded form of each candidate are tried; otherwise a
  // blueprint with an unencoded description would be reported as tampered with.
  if (verifyHash && hash) {
    const rawCandidates = [prefix, `${prefix}"`];
    const candidates = [...rawCandidates];
    for (const c of rawCandidates) candidates.push(percentEncodeDescriptions(c));
    const actual = candidates.map((c) => md5f(c));
    if (!actual.includes(hash.toLowerCase())) {
      result.hashWarning = `blueprint hash mismatch: payload declares ${hash.slice(0, 16)}… but MD5F is ${actual[0]!.slice(0, 16)}…`;
    }
  }
  return result;
}

/**
 * Percent-encode the description fields inside a `BLUEPRINT:` payload so a
 * blueprint whose writer left them raw still hashes like the game's writer did.
 */
function percentEncodeDescriptions(payload: string): string {
  const closeQuote = payload.lastIndexOf('"');
  const prefix = closeQuote >= 0 ? payload.slice(0, closeQuote) : payload;
  const suffix = closeQuote >= 0 ? payload.slice(closeQuote) : '';
  // Walk fields; only the description-ish fields (index >= 10) are encoded, and
  // base64 segments are left untouched.
  const parts = prefix.split(',');
  for (let i = 10; i < parts.length; i++) {
    const part = parts[i]!;
    if (part.length > 40 && /^[A-Za-z0-9+/=]+$/.test(part)) continue; // base64
    parts[i] = encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  }
  return parts.join(',') + suffix;
}

async function decodeBinaryBlueprint(s: string): Promise<DecodedBlueprint> {
  const bytes = base64ToBytes(s.slice(BINARY_MAGIC.length));
  if (bytes.length < 5) throw new Error('malformed DYBP container: too short');
  const containerVersion = bytes[0]!;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declaredLength = dv.getUint32(1, true);
  let payload = bytes.subarray(5);
  if (declaredLength > 0 && declaredLength <= payload.length) {
    payload = payload.subarray(0, declaredLength);
  }

  const attempts: Array<{ codec: 'gzip' | 'zlib' | 'stored'; fn: () => Promise<Uint8Array> }> = [
    { codec: 'gzip', fn: () => gunzipBytes(payload) },
    { codec: 'zlib', fn: () => gunzipBytes(payload, 'deflate') },
    { codec: 'stored', fn: async () => payload },
  ];
  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      const raw = await attempt.fn();
      const decodedBody = decodeBody(raw);
      return {
        format: 'binary',
        containerVersion,
        payloadCodec: attempt.codec,
        meta: {
          timestampTicks: 0,
          gameVersion: 'unknown',
          shortDesc: '',
          longDesc: '',
          icon: { layout: 10, images: [0, 0, 0, 0, 0] },
        },
        body: decodedBody,
      };
    } catch (err) {
      errors.push(`${attempt.codec}: ${(err as Error).message}`);
    }
  }
  throw new Error(`failed to decode DYBP container (tried gzip/zlib/stored): ${errors.join(' | ')}`);
}

function safeDecodeURIComponent(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

export const DEFAULT_META: BlueprintMeta = {
  timestampTicks: 0,
  gameVersion: '0.10.30.24610',
  shortDesc: '',
  longDesc: '',
  icon: { layout: 10, images: [0, 0, 0, 0, 0] },
};

export interface EncodeOptions {
  format?: 'text' | 'binary';
  meta?: Partial<BlueprintMeta>;
  /** Compute and append the MD5F hash. Default true (text format only). */
  appendHash?: boolean;
  /** Produce base64 without the "BLUEPRINT:"/"DYBP" prefix (browser tools use this). */
  bare?: boolean;
}

export async function encodeBlueprint(body: BlueprintBody, opts: EncodeOptions = {}): Promise<string> {
  const format = opts.format ?? 'text';
  const meta: BlueprintMeta = {
    ...DEFAULT_META,
    ...opts.meta,
    icon: { ...DEFAULT_META.icon, ...(opts.meta?.icon ?? {}) },
  };
  const raw = encodeBody(body);
  const gz = await gzipBytes(raw);

  if (format === 'binary') {
    const out = new Uint8Array(5 + gz.length);
    out[0] = 1; // container version
    new DataView(out.buffer).setUint32(1, gz.length, true);
    out.set(gz, 5);
    const b64 = bytesToBase64(out);
    return opts.bare ? b64 : BINARY_MAGIC + b64;
  }

  const b64 = bytesToBase64(gz);
  const fields = [
    '0',
    String(meta.icon.layout),
    ...meta.icon.images.map(String),
    '0',
    String(Math.trunc(meta.timestampTicks)),
    meta.gameVersion,
    encodeURIComponent(meta.shortDesc),
  ];
  const head = TEXT_PREFIX + fields.join(',');
  const hashed = `${head},"${encodeURIComponent(meta.longDesc)},${b64}`;
  if (opts.bare) return hashed.slice(TEXT_PREFIX.length);
  if (opts.appendHash === false) return `${hashed}"`;
  return `${hashed}"${md5f(hashed).toUpperCase()}`;
}
