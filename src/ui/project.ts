/**
 * Project identity, in one place.
 *
 * The repository URL appears in three places — the topbar link in `index.html`, the About view,
 * and the README — and a stale link is the kind of thing nobody notices. The topbar copy has to
 * live in markup so it works before the module loads, so instead of duplicating the string the
 * two are cross-checked by a test.
 */

export const PROJECT = {
  /** Source repository. */
  repo: 'https://github.com/NebulaSys/dsp-factory-sim',
  /** Live demo, deployed by .github/workflows/pages.yml. */
  demo: 'https://nebulasys.github.io/dsp-factory-sim/',
  issues: 'https://github.com/NebulaSys/dsp-factory-sim/issues',
} as const;
