import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// Phase 116 — ClawCode dashboard v2 SPA.
//
// Build output flows into the daemon's dist/dashboard/spa directory so the
// production bundle (built by the root `npm run build` script via
// `npm run build:spa`) ships alongside dist/cli/index.js. The daemon's
// server.ts serves these assets at `/dashboard/v2/*` (Plan 116-00 T05).
//
// Single-root-node_modules pattern: all dependencies (react, tailwind, shadcn
// primitives, recharts, etc.) live in the repo-root package.json. Vite resolves
// them via standard parent-directory module resolution. The client/package.json
// only carries scripts — no deps — so we don't fragment node_modules.
export default defineConfig({
  plugins: [react()],
  base: '/dashboard/v2/',
  build: {
    // Resolve relative to the client root (this file's directory).
    // ../../../dist/dashboard/spa lands at: workspace-root/dist/dashboard/spa
    outDir: path.resolve(__dirname, '../../../dist/dashboard/spa'),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
