import { access, copyFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const examplePath = join(rootDir, 'config.example.json');
const targetPath = join(rootDir, 'config.json');
const label = 'config.json';

async function ensureConfig(): Promise<void> {
  try {
    await access(targetPath);
    console.log(`✓ ${label} already exists`);
    return;
  } catch {
    // create from example
  }

  try {
    await access(examplePath);
  } catch {
    throw new Error(`Example config not found: ${examplePath}`);
  }

  await copyFile(examplePath, targetPath);
  console.log(`✓ Created ${label} from example`);
}

export async function setupDevConfig(): Promise<void> {
  console.log('Setting up config...');
  await ensureConfig();
  console.log('✓ Config ready. Edit config.json with your platform credentials.');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  setupDevConfig().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('✗ Failed to set up config:', message);
    process.exit(1);
  });
}
