/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Docs, the checklist dashboard, and seed-generation scripts are not part of the app.
    // Without this, writing any of them while the dev server runs triggers a full page
    // reload, which resets the in-memory store to seed mid-walkthrough (DECISIONS 65, 99).
    watch: {
      ignored: ['**/*.md', '**/dashboard.html', '**/progress.json', '**/scripts/**', '**/context/**'],
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
