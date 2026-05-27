#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const DEFAULT_PORT = '3001';

export function resolvePort(env = process.env) {
  const port = env.PORT?.trim() || DEFAULT_PORT;
  const numeric = Number(port);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 65_535) {
    throw new Error('PORT must be a number between 1 and 65535');
  }
  return port;
}

function run() {
  const command = process.argv[2];
  if (command !== 'dev' && command !== 'start') {
    console.error('Usage: node scripts/next-with-env.mjs <dev|start>');
    process.exit(1);
  }

  let port;
  try {
    port = resolvePort();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const child = spawn('next', [command, '-p', port], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run();
}
