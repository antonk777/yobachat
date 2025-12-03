import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharedConfig from '../shared/shared-config.json';


const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: sharedConfig.basePath,
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  build: {
    rollupOptions: {
      external: ['fs', 'path'], // Externalize Node.js built-ins for browser builds
    },
  },
  optimizeDeps: {
    exclude: ['fs', 'path'], // Don't try to optimize Node.js built-ins
  },
});
