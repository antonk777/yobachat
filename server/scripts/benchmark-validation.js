#!/usr/bin/env node

/**
 * Benchmark validation performance
 * Run with: node scripts/benchmark-validation.js
 * Or: npm run benchmark:validation (if added to package.json)
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const serverDir = join(__dirname, '..');

// Run the TypeScript file with tsx
const scriptPath = join(serverDir, 'src', 'benchmark-validation.ts');

console.log('Running validation benchmark...\n');

const child = spawn('npx', ['tsx', scriptPath], {
  cwd: serverDir,
  stdio: 'inherit',
  shell: true
});

child.on('error', (error) => {
  console.error('Error running benchmark:', error);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code || 0);
});

