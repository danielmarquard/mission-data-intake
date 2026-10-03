#!/usr/bin/env node
/**
 * Generates a small, valid, benign sample mission data package.
 * UNCLASSIFIED // DEMO ONLY — synthetic data only.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BUILD = join(ROOT, 'samples', '.build');
const OUT = join(ROOT, 'samples', 'sample-package.tar.gz');

const FILES = {
  'logs/alpha-maintenance.csv': [
    'timestamp,asset_id,action,technician',
    '2026-03-01T08:00:00Z,GEN-1001,oil_check,J. Rivera',
    '2026-03-01T09:15:00Z,GEN-1002,filter_replace,A. Chen',
    '2026-03-01T11:30:00Z,PUMP-220,pressure_test,M. Okonkwo',
  ].join('\n') + '\n',
  'logs/bravo-maintenance.csv': [
    'timestamp,asset_id,action,technician',
    '2026-03-02T07:45:00Z,RADAR-7,calibration,S. Patel',
    '2026-03-02T10:00:00Z,COMM-12,antenna_inspect,L. Nguyen',
  ].join('\n') + '\n',
  'logs/charlie-inventory.csv': [
    'sku,description,quantity,unit',
    'FLT-AA,synthetic filter AA,12,ea',
    'OIL-SW,synthetic oil 5W,6,qt',
    'SEAL-R2,gasket ring R2,24,ea',
  ].join('\n') + '\n',
};

function sha256Hex(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

async function main() {
  await rm(BUILD, { recursive: true, force: true });
  await mkdir(join(BUILD, 'logs'), { recursive: true });
  await mkdir(join(ROOT, 'samples'), { recursive: true });

  const fileEntries = [];
  for (const [rel, content] of Object.entries(FILES)) {
    await writeFile(join(BUILD, rel), content, 'utf8');
    fileEntries.push({ path: rel, sha256: sha256Hex(content) });
  }

  const manifest = {
    packageId: 'DEMO-PKG-001',
    originUnit: 'Partner Unit Alpha (synthetic)',
    classification: 'UNCLASSIFIED // DEMO ONLY',
    createdAt: '2026-03-03T12:00:00.000Z',
    files: fileEntries,
  };

  await writeFile(join(BUILD, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  await pipeline(
    tar.c(
      {
        gzip: true,
        cwd: BUILD,
        portable: true,
      },
      ['manifest.json', 'logs']
    ),
    createWriteStream(OUT)
  );

  await rm(BUILD, { recursive: true, force: true });
  console.log(`Wrote ${OUT}`);
  console.log(`packageId=${manifest.packageId} files=${fileEntries.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
