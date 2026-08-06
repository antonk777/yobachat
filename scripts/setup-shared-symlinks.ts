import symlinkDir from 'symlink-dir';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { access } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

export async function setupSharedSymlinks(): Promise<void> {
  const sharedPath = join(rootDir, 'shared');
  const clientSharedPath = join(rootDir, 'client', 'shared');
  const serverSharedPath = join(rootDir, 'server', 'shared');

  try {
    await access(sharedPath);
  } catch {
    throw new Error(`Shared directory not found: ${sharedPath}`);
  }

  console.log('Setting up shared directory symlinks...');

  try {
    await symlinkDir(sharedPath, clientSharedPath);
    console.log(`✓ Created symlink: client/shared -> shared`);

    await symlinkDir(sharedPath, serverSharedPath);
    console.log(`✓ Created symlink: server/shared -> shared`);

    console.log('✓ All symlinks created successfully!');
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      console.log('⚠ Symlinks may already exist, skipping...');
      return;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create symlinks: ${errorMessage}`);
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  setupSharedSymlinks().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('✗ Failed to create symlinks:', message);
    process.exit(1);
  });
}
