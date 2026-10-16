/**
 * The real-blueprint corpus is third-party data and is NOT vendored in this repository.
 *
 * `docs/research/_raw/realbp` and `realbp2` hold blueprint strings published by other people in
 * the `DSPBluePrints/FactoryBluePrints` repository. Several tools measure against them, so a
 * fresh clone has no corpus and those tools would otherwise crash with ENOENT.
 *
 * `requireCorpus` keeps that honest: when the directory is absent the tool says so and exits 0,
 * because "the corpus is not staged" is not a failure of this project's code. Fetch it with
 * `node tools/fetch-corpus.mjs` to run the measurements for real.
 */

import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

export const CORPUS_ROOT = resolve(import.meta.dirname, '..', '..', 'docs', 'research', '_raw');

/** Absolute path to one staged corpus folder. */
export const corpusDir = (name: 'realbp' | 'realbp2'): string => resolve(CORPUS_ROOT, name);

/**
 * Blueprint file names in a corpus folder, or exit 0 with an explanation when it is not staged.
 *
 * Returning exit 0 is deliberate: a missing third-party corpus is an environment condition, not
 * a code defect, and a red gate for it would train people to ignore red gates.
 */
export function requireCorpus(name: 'realbp' | 'realbp2', purpose: string): string[] {
  const dir = corpusDir(name);
  if (!existsSync(dir)) {
    console.log(`corpus not staged: ${dir}`);
    console.log(`  ${purpose} needs third-party blueprints that are not vendored here.`);
    console.log('  fetch them with: node tools/fetch-corpus.mjs');
    console.log('  skipped.');
    process.exit(0);
  }
  const files = readdirSync(dir).filter((f) => f.endsWith('.txt'));
  if (files.length === 0) {
    console.log(`corpus folder is empty: ${dir}`);
    console.log('  fetch them with: node tools/fetch-corpus.mjs');
    console.log('  skipped.');
    process.exit(0);
  }
  return files;
}
