import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const demo = process.env.APIDOCK_DEV_TARGET ?? 'http://localhost:3000/apidock';

export default defineConfig({
  // Relative asset URLs: the UI is served under whatever path the user mounts ApiDock on.
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: fileURLToPath(new URL('../apidock/ui-dist', import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
  },
  server: {
    proxy: {
      '/api': { target: demo, changeOrigin: true },
    },
  },
});
