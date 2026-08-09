import { join, resolve } from 'path';

/**
 * Persistent data directory for settings, message history, etc.
 *
 * Default: `<repo>/storage` (resolved as `../storage` from the server cwd).
 * Docker: set `STORAGE_PATH=/storage` and bind-mount host `./storage` there.
 */
export function getStorageDir(): string {
  if (process.env.STORAGE_PATH) {
    return resolve(process.env.STORAGE_PATH);
  }

  // `npm start` / entrypoint / dev-local use the server directory as cwd
  return resolve(process.cwd(), '..', 'storage');
}

export function storageFile(name: string): string {
  return join(getStorageDir(), name);
}
