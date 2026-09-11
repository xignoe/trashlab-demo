/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// Files the build tooling rewrites while the demo is running. scripts/build_dashboard.py writes
// dashboard.html and progress.json inside the Vite root, and the docs are edited between scenarios.
// Vite treats any changed .html as a full page reload, which wipes the in-memory store mid-scenario,
// so the watcher never sees them. src/index.css carries the matching `@source not` rules for Tailwind.
const NOT_APP_FILES = ['**/dashboard.html', '**/progress.json', '**/*.md']

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Fixed port from shared/CONTRACT_ADDENDUM.md section G: `npm run dev` lands on 5199 and fails loudly if it is taken.
  server: {
    port: 5199,
    strictPort: true,
    watch: { ignored: NOT_APP_FILES },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
