import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  base: '/LostArk-ArkGrid-Optimizer/',
  test: {
    // Vitest runs pure-logic unit tests only. OpenCV-dependent tests run via `tsx`
    // (see scripts/cv-tests.mts, wired into `npm test`), because the 10MB opencv.js
    // WASM bundle hangs under Vitest's worker/transform pipeline.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
  worker: {
    // 'es' bundles the worker as an ES module (import/export usable) — more efficient in
    // modern browsers and tree-shakeable. ('iife' is the legacy-browser fallback.)
    format: 'es',
  },
});
