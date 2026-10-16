import { describe, expect, it } from 'vitest';
import { md5f } from '../src/engine/bp/md5f.ts';

/**
 * Vectors taken from the reference implementation of the game's MD5F variant
 * (dspbptk/MD5.py, `DysonSphereMD5.Variant.MD5F`). If these ever fail, blueprint
 * hashes produced by this project would be rejected by the game.
 */
describe('md5f (DSP blueprint hash variant)', () => {
  it('matches the reference vector for the empty string', () => {
    expect(md5f('')).toBe('84d1ce3bd68f49ab26eb0f96416617cf');
  });

  it('matches the reference vector for "a"', () => {
    expect(md5f('a')).toBe('f10bddaecb62e5a92433757867ee06db');
  });

  it('matches the reference vector for "abcd"', () => {
    expect(md5f('abcd')).toBe('fa27c78b6ec31559f0e760ce3f2b03f6');
  });

  it('matches the reference vector for the Youthcat Studio string', () => {
    expect(md5f('Why are you doing this, Youthcat Studio?')).toBe('13424e12890a3f50a1f8567c464fff8c');
  });

  it('is deterministic and hex shaped', () => {
    const a = md5f('BLUEPRINT:0,10,0,0,0,0,0,0,0,0.10.30.24610,,,abc');
    const b = md5f('BLUEPRINT:0,10,0,0,0,0,0,0,0,0.10.30.24610,,,abc');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it('differs from standard MD5 (proves the variant is implemented, not library MD5)', async () => {
    const { createHash } = await import('node:crypto');
    const standard = createHash('md5').update('abcd').digest('hex');
    expect(standard).toBe('e2fc714c4727ee9395f324cd2e7f331f');
    expect(md5f('abcd')).not.toBe(standard);
  });

  it('handles inputs spanning multiple blocks', () => {
    expect(md5f('x'.repeat(64))).toMatch(/^[0-9a-f]{32}$/);
    expect(md5f('x'.repeat(65))).not.toBe(md5f('x'.repeat(64)));
    expect(md5f('x'.repeat(128))).not.toBe(md5f('x'.repeat(127)));
  });

  it('hashes non-ASCII (CJK blueprint descriptions) as UTF-8', () => {
    expect(md5f('戴森球计划')).toMatch(/^[0-9a-f]{32}$/);
    expect(md5f('戴森球计划')).not.toBe(md5f('??????'));
  });
});
