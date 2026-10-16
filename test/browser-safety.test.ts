import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The engine must stay browser-safe.
 *
 * `src/engine/**` is shared by the Node tooling and the web UI, but only the browser is a
 * hard constraint: `process` does not exist there. A leftover `process.env.DSP_TRACE_V1`
 * debug line inside the decoder's v1 fallback made every non-v1 blueprint fail to open in
 * the page while the entire Node test suite stayed green, because Node has `process`.
 *
 * A runtime test cannot catch this — vitest runs in Node, where the reference resolves. So
 * this asserts the property directly on the source.
 */

const ENGINE_DIR = resolve(import.meta.dirname, '../src/engine');

function engineSources(dir = ENGINE_DIR): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...engineSources(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('engine browser safety', () => {
  it('has engine sources to check', () => {
    // Guard against the walk silently finding nothing, which would make this a no-op.
    expect(engineSources().length).toBeGreaterThan(5);
  });

  it('never references Node-only globals, which do not exist in the browser', () => {
    const offenders: string[] = [];
    for (const file of engineSources()) {
      const text = readFileSync(file, 'utf8');
      text.split('\n').forEach((line, i) => {
        // Skip comments: a note explaining why `process` is banned is fine.
        const code = line.replace(/\/\/.*$/, '');
        for (const pattern of [/\bprocess\s*\./, /\brequire\s*\(/, /\b__dirname\b/, /\bBuffer\s*\./]) {
          if (pattern.test(code)) {
            offenders.push(`${file.replace(ENGINE_DIR, 'src/engine')}:${i + 1}: ${line.trim()}`);
            break;
          }
        }
      });
    }
    expect(offenders, `Node-only globals found in engine sources:\n${offenders.join('\n')}`).toEqual([]);
  });
});
