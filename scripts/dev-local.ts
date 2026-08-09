import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import { createRequire } from 'node:module';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import { setupDevConfig } from './setup-dev-config.js';
import { setupSharedSymlinks } from './setup-shared-symlinks.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const serverDir = join(rootDir, 'server');
const clientDir = join(rootDir, 'client');
const serverEntry = join(serverDir, 'dist', 'index.js');
const clientEntry = join(clientDir, 'dist', 'index.html');

const kServerExternals = [
  'uWebSockets.js',
  'tmi.js',
  'node-telegram-bot-api',
  'ws',
  'express',
  'youtubei.js',
  'jsonwebtoken',
  'http-proxy-middleware',
];

interface ServerConfigPorts {
  apiPort: number;
  wsPort: number;
}

interface SharedConfigPaths {
  host: string;
  basePath: string;
  wsPath: string;
}

interface DevProxyHandle {
  port: number;
  close: () => Promise<void>;
}

interface ChatServerHandle {
  shutdown: (exitProcess?: boolean) => Promise<void>;
}

// Minimal structural types for the esbuild/vite APIs we use (resolved from sub-packages).
interface EsbuildBuild {
  onEnd(callback: (result: { errors: unknown[] }) => void): void;
}

interface EsbuildPlugin {
  name: string;
  setup(build: EsbuildBuild): void;
}

interface EsbuildContext {
  watch(): Promise<void>;
  dispose(): Promise<void>;
}

interface EsbuildModule {
  context(options: Record<string, unknown>): Promise<EsbuildContext>;
}

interface ViteWatcher {
  close: () => Promise<void>;
}

interface ViteModule {
  build(options: Record<string, unknown>): Promise<unknown>;
}

let chatServer: ChatServerHandle | null = null;
let proxyHandle: DevProxyHandle | null = null;
let esbuildCtx: EsbuildContext | null = null;
let clientWatcher: ViteWatcher | null = null;
let shuttingDown = false;

// Server reload coordination
let serverLoadCounter = 0;
let serverReady = false;
let firstServerBuild = true;
let reloadingServer = false;
let reloadQueued = false;
let reloadDebounce: NodeJS.Timeout | null = null;

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

function normalizePath(...parts: string[]): string {
  const joined = parts
    .map(part => part.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');

  return `/${joined}`;
}

function loadEsbuild(): EsbuildModule {
  const requireFromRoot = createRequire(join(rootDir, 'package.json'));
  return requireFromRoot('esbuild') as EsbuildModule;
}

async function loadVite(): Promise<ViteModule> {
  const requireFromRoot = createRequire(join(rootDir, 'package.json'));
  const vitePath = requireFromRoot.resolve('vite');
  return (await import(pathToFileURL(vitePath).href)) as ViteModule;
}

function closeHttpServer(server: HttpServer): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.close(error => {
      if (error) {
        reject(error);
        return;
      }

      resolvePromise();
    });
  });
}

function startDevProxy(): Promise<DevProxyHandle> {
  const configPath = resolve(rootDir, 'config.json');
  const staticDir = resolve(clientDir, 'dist');

  const appConfig = loadJson<SharedConfigPaths & ServerConfigPorts>(configPath);
  const sharedConfig = appConfig;
  const serverConfig = appConfig;

  const devPort = Number.parseInt(process.env.DEV_PROXY_PORT ?? sharedConfig.host.split(':').pop() ?? '3000', 10);
  const apiTarget = `http://127.0.0.1:${serverConfig.apiPort}`;
  const wsTarget = `http://127.0.0.1:${serverConfig.wsPort}`;
  const wsProxyPath = normalizePath(sharedConfig.basePath, sharedConfig.wsPath);

  const wsProxy = createProxyMiddleware({
    target: wsTarget,
    changeOrigin: true,
    ws: true,
    pathFilter: (pathname) => pathname.startsWith(wsProxyPath),
  });

  const apiProxy = createProxyMiddleware({
    target: apiTarget,
    changeOrigin: true,
    pathFilter: (pathname) => pathname.startsWith('/auth') || pathname.startsWith('/fonts'),
  });

  const app = express();

  const sendHtml = (file: string) => (_req: express.Request, res: express.Response) => {
    res.sendFile(join(staticDir, file));
  };

  app.get(['/login', '/login/'], sendHtml('login.html'));
  app.get(['/admin', '/admin/'], sendHtml('admin.html'));
  app.get(['/widget', '/widget/'], sendHtml('widget.html'));

  app.use(wsProxy);
  app.use(apiProxy);
  app.use(express.static(staticDir));

  const server = createServer(app);
  server.on('upgrade', wsProxy.upgrade);

  return new Promise((resolvePromise, reject) => {
    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        reject(new Error(
          `[DevLocal] Port ${devPort} is already in use. Change host/apiHost in config.json or set DEV_PROXY_PORT.`,
        ));
        return;
      }

      reject(error);
    });

    server.listen(devPort, () => {
      console.log(`[DevLocal] Serving client from ${staticDir}`);
      console.log(`[DevLocal] Proxying API ${apiTarget} and WS ${wsTarget}${wsProxyPath}`);
      console.log(`[DevLocal] Widget: http://localhost:${devPort}/widget.html`);
      console.log(`[DevLocal] Admin: http://localhost:${devPort}/admin.html`);

      resolvePromise({
        port: devPort,
        close: () => closeHttpServer(server),
      });
    });
  });
}

async function waitForFile(path: string, timeoutMs = 60000): Promise<void> {
  const start = Date.now();

  while (!existsSync(path)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for build output: ${path}`);
    }

    await delay(200);
  }
}

function configureServerEnv(): void {
  process.env.NODE_ENV = 'development';
  process.env.CONFIG_PATH = resolve(rootDir, 'config.json');
  process.env.STORAGE_PATH = resolve(rootDir, 'storage');
  // Match production: run with the server dir as cwd
  process.chdir(serverDir);
}

async function loadServer(): Promise<ChatServerHandle> {
  // Cache-bust the dynamic import so each reload re-evaluates the rebuilt bundle.
  const url = `${pathToFileURL(serverEntry).href}?v=${++serverLoadCounter}`;
  const { startChatServer } = await import(url);
  return startChatServer({ registerSignalHandlers: false });
}

async function reloadServer(): Promise<void> {
  if (shuttingDown || !serverReady) {
    return;
  }

  if (reloadingServer) {
    reloadQueued = true;
    return;
  }

  reloadingServer = true;

  try {
    console.log('[DevLocal] Server bundle changed, restarting...');

    if (chatServer) {
      await chatServer.shutdown(false);
      chatServer = null;
    }

    chatServer = await loadServer();
    console.log('[DevLocal] Server restarted');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[DevLocal] Server restart failed (will retry on next change): ${message}`);
  } finally {
    reloadingServer = false;

    if (reloadQueued) {
      reloadQueued = false;
      void reloadServer();
    }
  }
}

function scheduleServerReload(): void {
  if (!serverReady) {
    return;
  }

  if (reloadDebounce) {
    clearTimeout(reloadDebounce);
  }

  reloadDebounce = setTimeout(() => {
    void reloadServer();
  }, 300);
}

/**
 * Build the server bundle with esbuild and keep watching. Resolves once the
 * initial build finishes. Subsequent rebuilds trigger an in-process reload.
 */
async function startServerWatch(esbuild: EsbuildModule): Promise<void> {
  let resolveFirst!: () => void;
  let rejectFirst!: (error: unknown) => void;
  const firstBuild = new Promise<void>((res, rej) => {
    resolveFirst = res;
    rejectFirst = rej;
  });

  const reloadPlugin: EsbuildPlugin = {
    name: 'devlocal-server-reload',
    setup(build) {
      build.onEnd(result => {
        const failed = result.errors.length > 0;

        if (firstServerBuild) {
          firstServerBuild = false;

          if (failed) {
            rejectFirst(new Error('initial server build failed'));
          } else {
            resolveFirst();
          }

          return;
        }

        if (!failed) {
          scheduleServerReload();
        }
      });
    },
  };

  esbuildCtx = await esbuild.context({
    entryPoints: [join(serverDir, 'src', 'index.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: serverEntry,
    sourcemap: true,
    external: kServerExternals,
    absWorkingDir: serverDir,
    tsconfig: join(serverDir, 'tsconfig.json'),
    logLevel: 'info',
    plugins: [reloadPlugin],
  });

  await esbuildCtx.watch();
  await firstBuild;
}

/**
 * Build the client with Vite and keep watching. Rebuilt files are picked up by
 * the static proxy on the next request (refresh the browser).
 */
async function startClientWatch(vite: ViteModule): Promise<ViteWatcher> {
  const result = await vite.build({
    root: clientDir,
    configFile: join(clientDir, 'vite.config.ts'),
    mode: 'development',
    logLevel: 'info',
    build: { watch: {} },
  });

  return result as ViteWatcher;
}

async function shutdown(exitCode = 0): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  if (reloadDebounce) {
    clearTimeout(reloadDebounce);
    reloadDebounce = null;
  }

  if (clientWatcher) {
    try {
      await clientWatcher.close();
    } catch {
      // ignore shutdown errors
    }
    clientWatcher = null;
  }

  if (esbuildCtx) {
    try {
      await esbuildCtx.dispose();
    } catch {
      // ignore shutdown errors
    }
    esbuildCtx = null;
  }

  if (proxyHandle) {
    try {
      await proxyHandle.close();
    } catch {
      // ignore shutdown errors
    }
    proxyHandle = null;
  }

  if (chatServer) {
    try {
      await chatServer.shutdown(false);
    } catch {
      // ignore shutdown errors
    }
    chatServer = null;
  }

  process.exit(exitCode);
}

async function main(): Promise<void> {
  console.log('[DevLocal] Setting up development environment...');
  await setupDevConfig();
  await setupSharedSymlinks();
  configureServerEnv();

  const esbuild = loadEsbuild();
  const vite = await loadVite();

  console.log('[DevLocal] Building server (esbuild --watch)...');
  await startServerWatch(esbuild);

  console.log('[DevLocal] Building client (vite build --watch)...');
  clientWatcher = await startClientWatch(vite);
  await waitForFile(clientEntry);

  console.log('[DevLocal] Starting chat server...');
  try {
    chatServer = await loadServer();
    serverReady = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to start chat server: ${message}`);
  }

  console.log('[DevLocal] Starting dev proxy...');
  proxyHandle = await startDevProxy();

  process.on('SIGINT', () => {
    console.log('\n[DevLocal] Shutting down...');
    void shutdown(0);
  });

  process.on('SIGTERM', () => {
    void shutdown(0);
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[DevLocal] ${message}`);
  void shutdown(1);
});
