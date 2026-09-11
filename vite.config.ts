import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'

const root = fileURLToPath(new URL('.', import.meta.url))

/**
 * The prototype folders sit inside the Vite root as read-only inputs. Their dashboard.html files are rewritten
 * whenever a checklist box is ticked (addendum L), so the watcher ignores them and a tick never reloads this app.
 */
const PROTOTYPES = ['storefront', 'account', 'billing', 'pricing', 'portal', 'shared', 'prompts', 'trashlab', 'checkin']

export default defineConfig({
  /** '/' locally. The GitHub Pages build sets BASE_PATH=/trashlab-demo/ (scripts/deploy_pages.sh). */
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5200,
    strictPort: true,
    watch: { ignored: PROTOTYPES.map(dir => `${root}${dir}/**`) },
  },
  preview: { port: 5200, strictPort: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
