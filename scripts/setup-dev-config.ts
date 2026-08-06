import { access, copyFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const pairs = [
  {
    example: join(rootDir, 'shared', 'shared-config.example.json'),
    target: join(rootDir, 'shared', 'shared-config.dev.json'),
    label: 'shared/shared-config.dev.json',
  },
  {
    example: join(rootDir, 'server', 'server-config.example.json'),
    target: join(rootDir, 'server', 'server-config.dev.json'),
    label: 'server/server-config.dev.json',
  },
];

async function ensureConfig(examplePath: string, targetPath: string, label: string): Promise<void> {
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
  console.log('Setting up local development config files...');

  for (const pair of pairs) {
    await ensureConfig(pair.example, pair.target, pair.label);
  }

  console.log('✓ Development config ready. Edit the *.dev.json files with your platform credentials.');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  setupDevConfig().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('✗ Failed to set up development config:', message);
    process.exit(1);
  });
}
