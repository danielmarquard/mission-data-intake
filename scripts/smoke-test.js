#!/usr/bin/env node
/**
 * Starts the app, ingests samples/sample-package.tar.gz, asserts success.
 * UNCLASSIFIED // DEMO ONLY
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = Number(process.env.SMOKE_PORT) || 34567;
const BASE = `http://127.0.0.1:${PORT}`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHealth(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return await res.json();
    } catch {
      // retry
    }
    await sleep(200);
  }
  throw new Error('server did not become healthy in time');
}

async function main() {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), LOG_LEVEL: 'warn' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += d.toString();
  });

  try {
    const health = await waitForHealth();
    if (health.banner !== 'UNCLASSIFIED // DEMO ONLY') {
      throw new Error(`unexpected banner: ${health.banner}`);
    }

    const sample = await readFile(join(ROOT, 'samples', 'sample-package.tar.gz'));
    const form = new FormData();
    form.append('package', new Blob([sample], { type: 'application/gzip' }), 'sample-package.tar.gz');

    const ingestRes = await fetch(`${BASE}/ingest`, { method: 'POST', body: form });
    const ingestBody = await ingestRes.json();
    if (!ingestRes.ok || !ingestBody.ok) {
      throw new Error(`ingest failed: ${JSON.stringify(ingestBody)}`);
    }
    if (ingestBody.packageId !== 'DEMO-PKG-001') {
      throw new Error(`unexpected packageId: ${ingestBody.packageId}`);
    }

    const listRes = await fetch(`${BASE}/packages`);
    const listBody = await listRes.json();
    if (!listRes.ok || !listBody.packages?.some((p) => p.packageId === 'DEMO-PKG-001')) {
      throw new Error(`packages list missing DEMO-PKG-001: ${JSON.stringify(listBody)}`);
    }

    console.log('SMOKE OK', JSON.stringify({ health, ingest: ingestBody, count: listBody.count }));
  } finally {
    child.kill('SIGTERM');
    await sleep(300);
    if (!child.killed) child.kill('SIGKILL');
    if (stderr && process.env.SMOKE_VERBOSE) process.stderr.write(stderr);
  }
}

main().catch((err) => {
  console.error('SMOKE FAIL', err.message || err);
  process.exit(1);
});
