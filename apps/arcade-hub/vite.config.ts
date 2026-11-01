import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const root = import.meta.dirname;

export default defineConfig({
  root,
  base: '/',
  build: {
    outDir: resolve(root, '../../dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        hub: resolve(root, 'index.html'),
        football: resolve(root, 'football/index.html'),
        hockey: resolve(root, 'hockey/index.html'),
      },
    },
  },
  server: { port: 5173 },
});
