import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import checker from 'vite-plugin-checker';
import path, { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import { SharedConfig } from '@shared/shared-types';
import { pickSharedConfig } from '@shared/shared-urls';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const kDefaultConfigPath = '../config.json';

const kIsDevelopment = process.env.NODE_ENV === 'development';

/**
 * Load public/shared fields from the unified config JSON file.
 * Configure via environment variable: CONFIG_PATH
 */
function loadSharedConfig(): SharedConfig {
  const configPath = process.env.CONFIG_PATH || kDefaultConfigPath;

  try {
    const resolvedPath = resolve(configPath);
    const fileContent = readFileSync(resolvedPath, 'utf-8');
    return pickSharedConfig(JSON.parse(fileContent));
  } catch (error) {
    if (error instanceof Error) {
      console.error(`[ViteConfig] Failed to load config from ${configPath}: ${error.message}`);

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
  publicDir: resolve(__dirname, 'public'),
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
        index: resolve(__dirname, 'index.html'),
        widget: resolve(__dirname, 'widget.html'),
        admin: resolve(__dirname, 'admin.html'),
        login: resolve(__dirname, 'login.html'),
      },
      output: {
        // Top-level entries: send each app's entry to its own folder, everything
        // else (like the shared index) stays under the generic assets folder.
        entryFileNames: (chunkInfo) => {
          const name = chunkInfo.name;

          if (name === 'admin') {
            return 'admin/[name].js';
          }

          if (name === 'widget') {
            return 'widget/[name].js';
          }

          if (name === 'login') {
            return 'login/[name].js';
          }

          return 'assets/[name].js';
        },

        // Chunks: infer whether they belong to the admin app, the widget app,
        // or are shared, based on the modules they contain.
        chunkFileNames: (chunkInfo) => {
          const moduleIds = chunkInfo.moduleIds ?? [];

          const belongsToAdmin = moduleIds.some(id =>
            id.includes('admin-main') ||
            id.includes('AdminPanel') ||
            id.includes('admin.html')
          );

          const belongsToWidget = moduleIds.some(id =>
            id.includes('widget-main') ||
            id.includes('widget.html')
          );

          const belongsToLogin = moduleIds.some(id =>
            id.includes('login-main') ||
            id.includes('Login') ||
            id.includes('login.html')
          );

          if (belongsToAdmin) {
            return 'admin/[name]-[hash].js';
          }

          if (belongsToWidget) {
            return 'widget/[name]-[hash].js';
          }

          if (belongsToLogin) {
            return 'login/[name]-[hash].js';
          }

          return 'assets/[name]-[hash].js';
        },

        // Assets: keep CSS next to its app when we can infer it, otherwise
        // fall back to shared assets. Non‑CSS assets are always shared.
        assetFileNames: (assetInfo) => {
          const
            names = assetInfo.names ?? [],
            primaryName = names[0] ?? assetInfo.name,
            isCss = primaryName?.endsWith('.css');

          if (isCss) {
            const identifiers = names.filter(Boolean);

            const belongsToAdminCss = identifiers.some(name =>
              name.includes('admin')
            );

            const belongsToWidgetCss = identifiers.some(name =>
              name.includes('widget')
            );

            const belongsToLoginCss = identifiers.some(name =>
              name.includes('login')
            );

            if (belongsToAdminCss) {
              return 'admin/[name]-[hash][extname]';
            }

            if (belongsToWidgetCss) {
              return 'widget/[name]-[hash][extname]';
            }

            if (belongsToLoginCss) {
              return 'login/[name]-[hash][extname]';
            }

            return 'assets/[name]-[hash][extname]'; // e.g., index or shared
          }

          // For other assets (images, etc.), put in shared assets folder.
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

