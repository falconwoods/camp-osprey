#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const envFile = process.env.ENV_FILE || '.env.production';

function databaseHost(databaseUrl) {
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    const url = databaseUrl.replace(/^[^:]+:\/\//, '');
    const host = url.replace(/^[^@]+@/, '').split(/[/:?]/)[0];
    return host;
  }
}

export function loadProductionEnv(filePath = envFile) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing env file: ${filePath}`);
  }

  const parsed = dotenv.parse(fs.readFileSync(filePath));
  for (const [key, value] of Object.entries(parsed)) {
    process.env[key] = value;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(`DATABASE_URL is missing from ${filePath}`);
  }

  const host = databaseHost(databaseUrl);
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    throw new Error(
      'DATABASE_URL points at localhost. For production migrations, use the production Postgres host or private IP.',
    );
  }

  return parsed;
}

function run() {
  try {
    loadProductionEnv();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error('Run with ENV_FILE=/path/to/production.env npm run db:migrate:production.');
    process.exit(1);
  }

  const child = spawn('drizzle-kit', ['migrate'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
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
