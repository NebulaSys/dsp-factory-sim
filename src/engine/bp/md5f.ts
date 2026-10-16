/**
 * MD5F — the MD5 variant Dyson Sphere Program uses to sign blueprint strings.
 *
 * MD5F is NOT standard MD5. Compared with RFC 1321 it differs in three places
 * (verified against the reference implementation in dspbptk/MD5.py):
 *
 *  1. different initial state words:
 *       A = 0x67452301, B = 0xefdcab89, C = 0x98badcfe, D = 0x10325746
 *  2. eight of the 64 round constants T[i] are patched (see MD5F_T_PATCH)
 *  3. finalisation appends 0x80, then zero padding, then the message length in
 *     bits as a little-endian uint64 — which is the same shape as RFC 1321 but
 *     paired with the patched constants above produces the game's digest.
 *
 * Known-good vectors (from the reference implementation):
 *   md5f("")                                        = 84d1ce3bd68f49ab26eb0f96416617cf
 *   md5f("a")                                       = f10bddaecb62e5a92433757867ee06db
 *   md5f("abcd")                                    = fa27c78b6ec31559f0e760ce3f2b03f6
 *   md5f("Why are you doing this, Youthcat Studio?") = 13424e12890a3f50a1f8567c464fff8c
 */

/** Per-round left-rotation amounts (standard RFC 1321 schedule). */
const S = new Uint8Array([
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11,
  16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
]);

/** Standard T[i] = floor(abs(sin(i + 1)) * 2^32), before MD5F patching. */
const T = new Uint32Array(64);
for (let i = 0; i < 64; i++) T[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;

/** Indices into T (0-based) whose constants the game patched, with the XOR delta. */
const MD5F_T_PATCH: ReadonlyMap<number, number> = new Map([
  [1, 0x00100000], // std e8c7b756 -> e8d7b756
  [6, 0x00000030], // std a8304613 -> a8304623
  [12, 0x000f0000], // std 6b901122 -> 6b9f1122
  [15, 0x70000000], // std 49b40821 -> 39b40821
  [19, 0x20000000], // std e9b6c7aa -> c9b6c7aa
  [21, 0x00002000], // std 02441453 -> 02443453
  [24, 0x00100000], // std 21e1cde6 -> 21f1cde6
  [27, 0x02000000], // std 455a14ed -> 475a14ed
]);

/** MD5F initial state words (little-endian interpretation of 67 45 23 01 / ef ab dc 89 / fe dc ba 98 / 46 57 32 10). */
const MD5F_INIT: readonly number[] = [0x67452301, 0xefdcab89, 0x98badcfe, 0x10325746];

function rotl(x: number, c: number): number {
  return ((x << c) | (x >>> (32 - c))) >>> 0;
}

/** UTF-8 encode (explicit, so the hash never depends on TextEncoder availability). */
export function utf8Bytes(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

/**
 * MD5F digest, returned as a lowercase 32 character hex string.
 * This is the digest the game appends to "BLUEPRINT:..." strings.
 */
export function md5f(input: string | Uint8Array): string {
  const msg = typeof input === 'string' ? utf8Bytes(input) : input;
  const len = msg.length;

  // blockCount = floor(len/64) + 1; the final block always exists and always
  // contains at least the 0x80 terminator plus the 8 byte length field.
  const blockCount = Math.floor(len / 64) + 1;
  const padded = new Uint8Array(blockCount * 64);
  padded.set(msg.subarray(0, Math.min(len, padded.length)));
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  const lengthBitsLo = (len * 8) >>> 0;
  const lengthBitsHi = Math.floor((len * 8) / 4294967296) >>> 0;
  dv.setUint32(padded.length - 8, lengthBitsLo, true);
  dv.setUint32(padded.length - 4, lengthBitsHi, true);

  let a0 = MD5F_INIT[0]!;
  let b0 = MD5F_INIT[1]!;
  let c0 = MD5F_INIT[2]!;
  let d0 = MD5F_INIT[3]!;

  const M = new Uint32Array(16);
  for (let block = 0; block < blockCount; block++) {
    const base = block * 64;
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(base + i * 4, true);

    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;

    for (let i = 0; i < 64; i++) {
      let F: number;
      let g: number;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      const patch = MD5F_T_PATCH.get(i);
      const k = patch === undefined ? T[i]! : (T[i]! ^ patch) >>> 0;
      F = (F + A + k + M[g]!) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + rotl(F, S[i]!)) >>> 0;
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  return [a0, b0, c0, d0].map(leHex).join('');
}

function leHex(word: number): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += ((word >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
  return s;
}
