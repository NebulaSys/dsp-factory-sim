/**
 * Minimal reader for Unity `SerializedFile` archives (the `.assets` / `globalgamemanagers` /
 * `level*` containers a player build ships).
 *
 * Why this exists: the per-building slot geometry is not in `Assembly-CSharp.dll` — that holds
 * code only — it is in the serialised prefab data. The wiki's `protosets.json` has the
 * `insertPoses` / `slotPoses` arrays but every element comes out as an empty object, so the
 * values were never published. Reading them from the shipped assets is the remaining
 * authoritative source that needs no running game.
 *
 * Format notes for the version this game uses (Unity 2022.3, serialized version 22):
 *
 *   - the header *begins* with the legacy 20-byte layout, whose size/offset words read as 0,
 *     and then repeats metadataSize / fileSize / dataOffset as 64-bit values. Reading only the
 *     legacy fields yields zeros, which is the trap this parser exists to avoid;
 *   - all header and metadata integers are big-endian;
 *   - the type table carries a name/type string buffer, so field *names* like `insertPoses` are
 *     directly searchable without any external schema.
 *
 * The type-tree node layout differs across Unity versions and this parser does not assume one:
 * it tries the known variants and accepts the first whose output is structurally valid (levels
 * form a tree, every string offset lands inside the buffer, sizes are positive). A wrong layout
 * produces garbage that fails those checks immediately.
 */

export interface SerializedHeader {
  metadataSize: number;
  fileSize: number;
  version: number;
  dataOffset: number;
  endianness: number;
  /** Offset where the metadata (type table + object table) starts. */
  metadataOffset: number;
  /** Every start offset that was tried, so a failure can report what was attempted. */
  metadataOffsetCandidates: number[];
}

export interface TypeNode {
  /** String-table offsets, kept while the buffer is being read. */
  typeStrOffset?: number;
  nameStrOffset?: number;
  level: number;
  typeFlags: number;
  type: string;
  name: string;
  byteSize: number;
  index: number;
  metaFlag: number;
}

export interface TypeInfo {
  classId: number;
  isStripped: boolean;
  scriptTypeIndex: number;
  /** Present for MonoBehaviour (114): the script's 16-byte identity hash. */
  scriptId: Buffer | null;
  nodes: TypeNode[];
  /** Index of this type in the file's type table. */
  typeIndex: number;
}

export interface ObjectInfo {
  pathId: bigint;
  byteStart: number;
  byteSize: number;
  typeId: number;
  classId: number;
}

export class ByteReader {
  private pos = 0;
  private readonly buf: Buffer;
  readonly endian: 'le' | 'be';

  constructor(buf: Buffer, endian: 'le' | 'be' = 'be') {
    this.buf = buf;
    this.endian = endian;
  }

  get offset(): number {
    return this.pos;
  }
  seek(p: number): void {
    this.pos = p;
  }
  skip(n: number): void {
    this.pos += n;
  }
  get length(): number {
    return this.buf.length;
  }
  bytes(n: number): Buffer {
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  u8(): number {
    const v = this.buf.readUInt8(this.pos);
    this.pos += 1;
    return v;
  }
  i8(): number {
    const v = this.buf.readInt8(this.pos);
    this.pos += 1;
    return v;
  }
  i16(): number {
    const v = this.endian === 'le' ? this.buf.readInt16LE(this.pos) : this.buf.readInt16BE(this.pos);
    this.pos += 2;
    return v;
  }
  u16(): number {
    const v = this.endian === 'le' ? this.buf.readUInt16LE(this.pos) : this.buf.readUInt16BE(this.pos);
    this.pos += 2;
    return v;
  }
  i32(): number {
    const v = this.endian === 'le' ? this.buf.readInt32LE(this.pos) : this.buf.readInt32BE(this.pos);
    this.pos += 4;
    return v;
  }
  u32(): number {
    const v = this.endian === 'le' ? this.buf.readUInt32LE(this.pos) : this.buf.readUInt32BE(this.pos);
    this.pos += 4;
    return v;
  }
  i64(): bigint {
    const v = this.endian === 'le' ? this.buf.readBigInt64LE(this.pos) : this.buf.readBigInt64BE(this.pos);
    this.pos += 8;
    return v;
  }
  u64(): bigint {
    const v = this.endian === 'le' ? this.buf.readBigUInt64LE(this.pos) : this.buf.readBigUInt64BE(this.pos);
    this.pos += 8;
    return v;
  }
  f32(): number {
    const v = this.endian === 'le' ? this.buf.readFloatLE(this.pos) : this.buf.readFloatBE(this.pos);
    this.pos += 4;
    return v;
  }
  align(n: number): void {
    this.pos = Math.ceil(this.pos / n) * n;
  }
}

/**
 * Header.
 *
 * For serialized version 22 the legacy words are present but zeroed, and the real metadata
 * size, file size and data offset follow as 64-bit big-endian values. Read off the shipped
 * file rather than assumed: `globalgamemanagers` shows version=22 at +8, metadataSize=1164 at
 * +16, fileSize=8881092 at +24 (equal to the file's real length) and dataOffset=1216 at +32,
 * followed by the engine version string ("2022.3.62f3c1").
 *
 * The metadata does not start at a fixed offset because that string sits before it, so the
 * start is resolved by `parseSerializedFile` trying candidates and keeping the one whose type
 * and object tables validate.
 */
export function readSerializedHeader(buf: Buffer): SerializedHeader {
  const version = buf.readUInt32BE(8);
  if (version >= 22) {
    const metadataSize = Number(buf.readBigUInt64BE(16));
    const fileSize = Number(buf.readBigUInt64BE(24));
    const dataOffset = Number(buf.readBigUInt64BE(32));
    const endianness = buf.readUInt8(40);
    // The engine-version string and a platform word sit before the metadata, and their exact
    // lengths vary, so a range is tried and the strict structural validation decides. Reading
    // the offset out of `dataOffset - metadataSize` alone does not work here: it lands inside
    // the version string.
    const candidates: number[] = [];
    for (let o = 44; o <= 200; o++) candidates.push(o);
    return {
      metadataSize,
      fileSize,
      version,
      dataOffset,
      endianness,
      metadataOffset: candidates[0]!,
      metadataOffsetCandidates: candidates,
    };
  }
  const metadataSize = buf.readUInt32BE(0);
  const fileSize = buf.readUInt32BE(4);
  const dataOffset = buf.readUInt32BE(12);
  const endianness = buf.readUInt8(16);
  return { metadataSize, fileSize, version, dataOffset, endianness, metadataOffset: 20, metadataOffsetCandidates: [20] };
}

/** Try to read the type table starting at `start`; returns null when the layout does not fit. */
function tryTypeTable(
  buf: Buffer,
  start: number,
  nodeLayout: 'withMeta' | 'noMeta',
  classIdWidth: 'i16' | 'i32',
  hasHash128: boolean,
  hasDependencies: boolean,
): { types: TypeInfo[]; end: number } | null {
  const r = new ByteReader(buf, 'be');
  r.seek(start);
  const count = r.i32();
  if (count <= 0 || count > 20000) return null;
  const types: TypeInfo[] = [];
  for (let i = 0; i < count; i++) {
    const classId = classIdWidth === 'i32' ? r.i32() : r.i16();
    const isStripped = r.u8() !== 0;
    const scriptTypeIndex = r.i16();
    let scriptId: Buffer | null = null;
    if (classId === 114 && hasHash128) scriptId = Buffer.from(r.bytes(16));
    if (hasHash128) r.skip(16);
    // Newer container versions insert the referenced-type list before the node count.
    if (hasDependencies) {
      const depCount = r.i32();
      if (depCount < 0 || depCount > 10000) return null;
      r.skip(depCount * 4);
    }
    const nodeCount = r.i32();
    const stringBufferSize = r.i32();
    if (nodeCount <= 0 || nodeCount > 20000 || stringBufferSize <= 0 || stringBufferSize > 4_000_000) return null;
    const nodes: TypeNode[] = [];
    for (let n = 0; n < nodeCount; n++) {
      // version(u16) level(u8) typeFlags(u8) typeStrOff(u32) nameStrOff(u32) byteSize(i32) index(i32) [metaFlag(i32)]
      const _ver = r.u16();
      const level = r.u8();
      const typeFlags = r.u8();
      const typeStrOffset = r.u32();
      const nameStrOffset = r.u32();
      const byteSize = r.i32();
      const index = r.i32();
      const metaFlag = nodeLayout === 'withMeta' ? r.i32() : 0;
      nodes.push({ level, typeFlags, type: '', name: '', byteSize, index, metaFlag });
      nodes[n]!.typeStrOffset = typeStrOffset;
      nodes[n]!.nameStrOffset = nameStrOffset;
    }
    const bufferStart = r.offset;
    const strings = buf.subarray(bufferStart, bufferStart + stringBufferSize);
    for (const node of nodes) {
      const t = readCString(strings, node.typeStrOffset);
      const nm = readCString(strings, node.nameStrOffset);
      if (t === null || nm === null) return null;
      node.type = t;
      node.name = nm;
    }
    r.skip(stringBufferSize);
    // Structural validation: the first node is the root and levels may only step by one.
    if (nodes[0]!.level !== 0) return null;
    for (let n = 1; n < nodes.length; n++) {
      if (nodes[n]!.level > nodes[n - 1]!.level + 1) return null;
    }
    types.push({ classId, isStripped, scriptTypeIndex, scriptId, nodes, typeIndex: i });
  }
  return { types, end: r.offset };
}

function readCString(buf: Buffer, offset: number | undefined): string | null {
  if (offset === undefined || offset < 0 || offset >= buf.length) return null;
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end++;
  if (end >= buf.length) return null;
  return buf.toString('utf8', offset, end);
}

export interface ParsedFile {
  header: SerializedHeader;
  types: TypeInfo[];
  objects: ObjectInfo[];
  /** Layout variant that validated, for reporting. */
  layout: string;
  buf: Buffer;
}

export function parseSerializedFile(buf: Buffer): ParsedFile {
  const header = readSerializedHeader(buf);
  if (header.endianness !== 0) {
    throw new Error(`big-endian object data is not supported (endianness=${header.endianness})`);
  }
  // Every combination of the layouts that differ between Unity versions is tried; the strict
  // structural validation below is what picks the right one.
  const variants: {
    name: string;
    nodeLayout: 'withMeta' | 'noMeta';
    classIdWidth: 'i16' | 'i32';
    hasHash128: boolean;
    hasDependencies: boolean;
  }[] = [];
  for (const nodeLayout of ['withMeta', 'noMeta'] as const) {
    for (const classIdWidth of ['i32', 'i16'] as const) {
      for (const hasHash128 of [true, false]) {
        for (const hasDependencies of [true, false]) {
          variants.push({
            name: `${nodeLayout}/${classIdWidth}/hash${hasHash128 ? 1 : 0}/dep${hasDependencies ? 1 : 0}`,
            nodeLayout,
            classIdWidth,
            hasHash128,
            hasDependencies,
          });
        }
      }
    }
  }
  for (const start of header.metadataOffsetCandidates) {
    if (start + 4 > buf.length) continue;
    for (const v of variants) {
      const got = tryTypeTable(buf, start, v.nodeLayout, v.classIdWidth, v.hasHash128, v.hasDependencies);
      if (!got) continue;
      // Object table follows the type table directly.
      const r = new ByteReader(buf, 'be');
      r.seek(got.end);
      const objCount = r.i32();
      if (objCount <= 0 || objCount > 5_000_000) continue;
      const objects: ObjectInfo[] = [];
      let ok = true;
      for (let i = 0; i < objCount; i++) {
        r.align(4);
        const pathId = r.i64();
        const byteStart = Number(r.u64());
        const byteSize = r.u32();
        const typeId = r.i32();
        if (byteStart < 0 || byteSize < 0 || typeId < 0 || typeId >= got.types.length) {
          ok = false;
          break;
        }
        objects.push({ pathId, byteStart, byteSize, typeId, classId: got.types[typeId]!.classId });
      }
      if (!ok || objects.length !== objCount) continue;
      // The object data must live inside the file, and the last object must end by its end.
      const beyond = objects.filter((o) => o.byteStart < header.dataOffset - 8 || o.byteStart + o.byteSize > buf.length + 8);
      if (beyond.length > 0) continue;
      return {
        header: { ...header, metadataOffset: start },
        types: got.types,
        objects,
        layout: `${v.name}@${start}`,
        buf,
      };
    }
  }
  throw new Error(
    `could not parse the type/object table; tried metadata offsets ${header.metadataOffsetCandidates.join(', ')}`,
  );
}

/** Read a field by walking the type tree; returns the raw bytes for a named leaf. */
export function findNodeIndex(type: TypeInfo, name: string): number {
  return type.nodes.findIndex((n) => n.name === name);
}
