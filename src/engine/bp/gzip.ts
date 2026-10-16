/**
 * gzip/zlib helpers that run both in Node and in the browser.
 * Uses the WHATWG Compression Streams API when present, otherwise node:zlib.
 */

interface NodeZlib {
  gzipSync(data: Uint8Array, opts?: { level?: number }): Uint8Array;
  gunzipSync(data: Uint8Array): Uint8Array;
  deflateSync(data: Uint8Array): Uint8Array;
  inflateSync(data: Uint8Array): Uint8Array;
}

let nodeZlib: NodeZlib | null | undefined;

async function getNodeZlib(): Promise<NodeZlib | null> {
  if (nodeZlib !== undefined) return nodeZlib;
  try {
    const mod = (await import('node:zlib')) as unknown as NodeZlib;
    nodeZlib = mod;
  } catch {
    nodeZlib = null;
  }
  return nodeZlib;
}

/**
 * Pump `bytes` through a Compression/DecompressionStream and collect the output.
 * The WHATWG streams are typed over `BufferSource` in lib.dom, so this helper is
 * deliberately typed loosely and casts at the boundary.
 */
async function streamThrough(
  bytes: Uint8Array,
  stream: { writable: WritableStream<Uint8Array>; readable: ReadableStream<Uint8Array> },
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  void writer.write(bytes);
  void writer.close();
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function asStream(stream: unknown): { writable: WritableStream<Uint8Array>; readable: ReadableStream<Uint8Array> } {
  return stream as { writable: WritableStream<Uint8Array>; readable: ReadableStream<Uint8Array> };
}

export async function gzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream !== 'undefined') {
    try {
      return await streamThrough(bytes, asStream(new CompressionStream('gzip')));
    } catch {
      /* fall through to zlib */
    }
  }
  const zlib = await getNodeZlib();
  if (zlib) return new Uint8Array(zlib.gzipSync(bytes, { level: 9 }));
  throw new Error('no gzip implementation available (need CompressionStream or node:zlib)');
}

/** Decompress gzip (default) or zlib (`deflate`) payloads. */
export async function gunzipBytes(bytes: Uint8Array, encoding: 'gzip' | 'deflate' = 'gzip'): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    try {
      return await streamThrough(bytes, asStream(new DecompressionStream(encoding)));
    } catch {
      /* fall through to zlib */
    }
  }
  const zlib = await getNodeZlib();
  if (zlib) {
    try {
      return new Uint8Array(encoding === 'deflate' ? zlib.inflateSync(bytes) : zlib.gunzipSync(bytes));
    } catch (err) {
      throw new Error((err as Error).message);
    }
  }
  throw new Error('no gunzip implementation available (need DecompressionStream or node:zlib)');
}
