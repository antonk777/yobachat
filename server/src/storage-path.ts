import { copyFileSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

/**
 * Chat settings, history, and the rest used to be written to
 * `<server cwd>/storage` (Docker: `/app/server/storage`, host `./data`).
 * The compose file later moved the mount to `/storage` (host `./storage`).
 * An image update then started empty and font settings looked wiped.
 * Use whichever directory already holds the data.
 */
const kDataFiles = [
  'settings.json',
  'message-history.json',
  'deleted-messages.json',
  'telegram-videos.json',
  'twitch-chat-oauth.json',
] as const;

let cachedDir: string | undefined;

function directoryKey(dir: string): string {
  const resolved = resolve(dir);

  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function candidateDirs(): string[] {
  const seen = new Set<string>();
  const dirs: string[] = [];

  for (const dir of [
    process.env.STORAGE_PATH,
    '/storage',
    resolve(process.cwd(), 'storage'),
    resolve(process.cwd(), '..', 'storage'),
  ]) {
    if (!dir) {
      continue;
    }

    const key = directoryKey(dir);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    dirs.push(resolve(dir));
  }

  return dirs;
}

function fileSize(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

function dataWeight(dir: string): number {
  let weight = 0;

  for (const name of kDataFiles) {
    weight += fileSize(join(dir, name));
  }

  return weight;
}

const kFontKeys = [
  'userFont',
  'adminFont',
  'usernameFont',
  'adminLineHeight',
  'userLineHeight',
  'chatScale',
  'adminScale',
] as const;

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function hasSavedFont(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const fonts = value as Record<string, unknown>;

  return fonts.userFont != null || fonts.adminFont != null || fonts.usernameFont != null;
}

function restoreFonts(targetDir: string, sourceDir: string): void {
  const sourceFile = join(sourceDir, 'settings.json');
  const targetFile = join(targetDir, 'settings.json');
  const sourceSize = fileSize(sourceFile);

  if (sourceSize === 0) {
    return;
  }

  let source: unknown;

  try {
    source = readJson(sourceFile);
  } catch {
    return;
  }

  if (!hasSavedFont(source)) {
    return;
  }

  if (fileSize(targetFile) === 0) {
    copyFileSync(sourceFile, targetFile);
    console.log(`[Storage] Restored settings.json into ${targetDir}`);
    return;
  }

  let target: unknown;

  try {
    target = readJson(targetFile);
  } catch {
    return;
  }

  if (!target || typeof target !== 'object' || hasSavedFont(target)) {
    return;
  }

  const merged = target as Record<string, unknown>;
  const saved = source as Record<string, unknown>;

  for (const key of kFontKeys) {
    if (saved[key] != null) {
      merged[key] = saved[key];
    }
  }

  writeFileSync(targetFile, JSON.stringify(merged, null, 2));
  console.log(`[Storage] Restored font settings into ${targetFile}`);
}

function keepMissingFiles(target: string, source: string): void {
  for (const name of kDataFiles) {
    const from = join(source, name);
    const to = join(target, name);
    const sourceSize = fileSize(from);
    const targetSize = fileSize(to);

    if (sourceSize === 0 || sourceSize <= targetSize) {
      continue;
    }

    if (targetSize > 32) {
      continue;
    }

    try {
      copyFileSync(from, to);
      console.log(`[Storage] Restored ${name} into ${target}`);
    } catch (error) {
      console.warn(`[Storage] Could not restore ${name}: ${error}`);
    }
  }
}

export function getStorageDir(): string {
  if (cachedDir) {
    return cachedDir;
  }

  const dirs = candidateDirs();
  let chosen = dirs[0] ?? resolve(process.cwd(), '..', 'storage');
  let chosenWeight = -1;

  for (const dir of dirs) {
    const weight = dataWeight(dir);

    if (weight > chosenWeight) {
      chosen = dir;
      chosenWeight = weight;
    }
  }

  for (const dir of dirs) {
    if (directoryKey(dir) === directoryKey(chosen)) {
      continue;
    }

    keepMissingFiles(chosen, dir);
    restoreFonts(chosen, dir);
  }

  cachedDir = chosen;

  if (chosenWeight > 0) {
    console.log(`[Storage] Keeping existing data in ${cachedDir}`);
  } else {
    console.log(`[Storage] No saved data yet, using ${cachedDir}`);
  }

  return cachedDir;
}

export function storageFile(name: string): string {
  return join(getStorageDir(), name);
}
