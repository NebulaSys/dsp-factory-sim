import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * The blueprint codec has two gzip backends: the browser's Compression Streams
 * API and, as a Node fallback, `node:zlib`. The fallback is dynamically imported
 * and wrapped in try/catch, but Vite still tries to resolve `node:zlib` for the
 * browser build and externalises it with a warning (plus a non-zero exit).
 *
 * This plugin resolves `node:zlib` to a tiny throwing stub *only* for the
 * browser build, so the bundle stays clean and the browser genuinely uses
 * DecompressionStream/CompressionStream. Node builds (tests, tools) keep the
 * real module.
 */
function nodeZlibBrowserStub() {
  const stubId = '\0node-zlib-browser-stub';
  return {
    name: 'dsp-node-zlib-browser-stub',
    enforce: 'pre' as const,
    resolveId(source: string, _importer: string | undefined, options?: { ssr?: boolean }) {
      if (source !== 'node:zlib') return null;
      if (options?.ssr) return null; // keep the real module for SSR/Node
      return stubId;
    },
    load(id: string) {
      if (id !== stubId) return null;
      return `
const unavailable = () => { throw new Error('node:zlib is not available in the browser; Compression Streams are used instead'); };
export const gzipSync = unavailable;
export const gunzipSync = unavailable;
export const deflateSync = unavailable;
export const inflateSync = unavailable;
export default { gzipSync, gunzipSync, deflateSync, inflateSync };
`;
    },
  };
}

export default defineConfig({
  /**
   * Deployment root.
   *
   * Dev and a root-hosted build use `/`. GitHub Pages serves a *project* site from
   * `https://<owner>.github.io/<repo>/`, so the Pages workflow builds with
   * `VITE_BASE=/dsp-factory-sim/`. Everything that loads a URL at runtime reads
   * `import.meta.env.BASE_URL`, which is this value, so no other code has to know.
   */
  base: process.env.VITE_BASE ?? '/',
  plugins: [nodeZlibBrowserStub()],
  server: {
    watch: {
      /**
       * Editors and tooling persist files by writing a sibling temp file and
       * renaming it. On Windows the watcher can hit that temp file while it is
       * still open and abort the whole dev server with EBUSY — which looks like a
       * random crash. These names are never sources, so ignore them.
       */
      ignored: [
        '**/*.tmp',
        '**/*.tmpdir/**',
        '**/*.~*',
        '**/.*.tmp',
        '**/node_modules/**',
        '**/dist/**',
        '**/docs/research/_raw/**',
      ],
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
  test: {
    include: ['test/**/*.test.ts'],
    // The UI test builds its own jsdom document per case (it must re-import the
    // entry module), so the global test environment stays 'node'.
    environment: 'node',
  },
});
