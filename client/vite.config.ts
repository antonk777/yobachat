import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import checker from 'vite-plugin-checker';
import path, { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import { SharedConfig } from '@shared/shared-types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const kDefaultSharedConfigPath = './shared/shared-config.json';

const kIsDevelopment = process.env.NODE_ENV === 'development';

/**
 * Load shared configuration from JSON file
 * Configure via environment variable: SHARED_CONFIG_PATH
 */
function loadSharedConfig(): SharedConfig {
  const configPath = process.env.SHARED_CONFIG_PATH ?? kDefaultSharedConfigPath;

  if (!configPath) {
    throw new Error(
      'Shared config path is required. Set SHARED_CONFIG_PATH environment variable.\n' +
      `Example: SHARED_CONFIG_PATH=${kDefaultSharedConfigPath} npm run build`
    );
  }

  try {
    const resolvedPath = resolve(configPath);
    const fileContent = readFileSync(resolvedPath, 'utf-8');
    const config = JSON.parse(fileContent);

    // Validate required fields
    if (
      typeof config !== 'object' ||
      typeof config.host !== 'string' ||
      typeof config.apiHost !== 'string' ||
      typeof config.basePath !== 'string' ||
      typeof config.wsPath !== 'string'
    ) {
      throw new Error('Invalid shared-config.json: missing or invalid required fields');
    }

    return config;
  } catch (error) {
    if (error instanceof Error) {
      console.error(`[ViteConfig] Failed to load shared config from ${configPath}: ${error.message}`);
      if ('code' in error && error.code === 'ENOENT') {
        console.error(`[ViteConfig] File not found: ${resolve(configPath)}`);
      }
    }
    throw error;
  }
}

const sharedConfig = loadSharedConfig();

export default defineConfig({
  base: sharedConfig.basePath,
  plugins: [
    vue(),
    checker({
      vueTsc: true,
      enableBuild: true,
    }),
  ],
  mode: kIsDevelopment ? 'development' : 'production',
  build: {
    sourcemap: kIsDevelopment ? 'inline' : false,
    minify: kIsDevelopment ? false : 'esbuild',
    cssCodeSplit: kIsDevelopment ? true : false,
    cssMinify: kIsDevelopment ? false : 'esbuild',
    rollupOptions: {
      input: {
        widget: resolve(__dirname, 'widget.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          return chunkInfo.name === 'admin' ? 'admin/[name].js' : 'widget/[name].js';
        },
        chunkFileNames: (chunkInfo) => {
          // Determine which app the chunk belongs to based on its modules
          const isAdminChunk = chunkInfo.moduleIds.some(id =>
            id.includes('admin-main') ||
            id.includes('AdminPanel') ||
            id.includes('admin.html')
          );
          return isAdminChunk ? 'admin/[name]-[hash].js' : 'widget/[name]-[hash].js';
        },
        assetFileNames: (assetInfo) => {
          // For CSS files, try to determine which app they belong to based on name
          if (assetInfo.name?.endsWith('.css')) {
            const isAdminCss = assetInfo.name.includes('admin') ||
                              (assetInfo.names && assetInfo.names.some(name => name.includes('admin')));
            return isAdminCss ? 'admin/[name]-[hash][extname]' : 'widget/[name]-[hash][extname]';
          }
          // For other assets (images, etc.), put in shared assets folder
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
  define: {
    // Inject shared config as a global constant at build time
    '__SHARED_CONFIG__': sharedConfig
  },
  // build: {
  //   rollupOptions: {
  //     external: ['fs', 'path'], // Externalize Node.js built-ins for browser builds
  //   },
  // },
  // optimizeDeps: {
  //   exclude: ['fs', 'path'], // Don't try to optimize Node.js built-ins
  // },
});

