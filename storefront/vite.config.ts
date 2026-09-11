/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Addendum G: the storefront always runs on 5173. strictPort makes a busy port fail loudly
// instead of drifting to 5174, so every runbook and check-in link stays correct.
// watch.ignored: the checklist tooling (scripts/build_dashboard.py) rewrites dashboard.html,
// progress.json, and the root markdown files mid-session. None of them is imported by the app, but a
// change to index-adjacent files can still trigger a full reload, and a reload wipes the in-memory
// store (a signup on screen would vanish). Ignoring them keeps the page put.
const ROOT = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/dashboard.html', '**/progress.json', '**/CHECKLIST.md', `${ROOT}/*.md`],
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
