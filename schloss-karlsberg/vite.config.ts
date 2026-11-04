import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const ROOT = import.meta.dirname;

// One package, three entry points: the viewer (vite root), the generator (model/src, imported by
// the viewer and by the tsx scripts) and the plan generator (plans/src, tsx only).
export default defineConfig({
  root: resolve(ROOT, 'viewer'),
  publicDir: resolve(ROOT, 'viewer/public'),
  base: './',
  resolve: {
    alias: {
      '@model': resolve(ROOT, 'model/src'),
    },
  },
  server: {
    port: 5260,
    strictPort: true,
    // The viewer imports ../model/src and ../model/catalogue.json.
    fs: { allow: [ROOT] },
  },
  // 5250 belongs to the explorer's `serve:local`; the explorer dev server is 5240
  preview: { port: 5261, strictPort: true },
  build: {
    outDir: resolve(ROOT, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  test: {
    root: ROOT,
    include: ['model/tests/**/*.test.ts', 'plans/tests/**/*.test.ts', 'viewer/tests/**/*.test.ts'],
    environment: 'node',
    // Heavy geometry builds hit the 5 s default when the machine is loaded (parallel agents).
    testTimeout: 30_000,
  },
});
