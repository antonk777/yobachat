import symlinkDir from 'symlink-dir';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { access } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

async function setupSymlinks(): Promise<void> {
  const sharedPath = join(rootDir, 'shared');
  const clientSharedPath = join(rootDir, 'client', 'shared');
  const serverSharedPath = join(rootDir, 'server', 'shared');

  // Check if shared directory exists
  try {
    await access(sharedPath);
  } catch (error) {
    console.error(`✗ Shared directory not found: ${sharedPath}`);
    process.exit(1);
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
    } else {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('✗ Failed to create symlinks:', errorMessage);
      process.exit(1);
    }
  }
}

setupSymlinks();

