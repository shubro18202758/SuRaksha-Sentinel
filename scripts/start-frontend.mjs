import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(resolve(rootDir, '.env'));

if (!process.env.VITE_API_BASE) {
  process.env.VITE_API_BASE = process.env.BACKEND_ORIGIN ?? '';
}
if (!process.env.VITE_FRONTEND_HOST) {
  process.env.VITE_FRONTEND_HOST = process.env.FRONTEND_HOST ?? '';
}
if (!process.env.VITE_FRONTEND_PORT) {
  process.env.VITE_FRONTEND_PORT = process.env.FRONTEND_PORT ?? '';
}

const required = ['VITE_API_BASE', 'VITE_FRONTEND_HOST', 'VITE_FRONTEND_PORT'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  throw new Error(`Missing frontend runtime configuration: ${missing.join(', ')}`);
}

const npmCommand = 'npm';
const child = spawn(npmCommand, ['--prefix', 'frontend', 'run', 'dev'], {
  cwd: rootDir,
  env: process.env,
  shell: process.platform === 'win32',
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

function loadEnv(path) {
  let body = '';
  try {
    body = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const [key, ...rest] = line.split('=');
    if (process.env[key]) continue;
    process.env[key] = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
  }
}
