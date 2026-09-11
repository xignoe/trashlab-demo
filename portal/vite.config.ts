import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const port = Number(process.env.PORT) || 5175;

export default defineConfig({
  plugins: [react()],
  server: { port, strictPort: true },
  test: { environment: 'node' },
} as any);
