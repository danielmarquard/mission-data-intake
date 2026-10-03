import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, rename, stat } from 'node:fs/promises';
import { join, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar';

export const BANNER = 'UNCLASSIFIED // DEMO ONLY';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STAGING_ROOT = join(__dirname, '..', 'staging');

function isUnsafePath(entryPath) {
  if (!entryPath || typeof entryPath !== 'string') return true;
  if (entryPath.startsWith('/') || entryPath.startsWith('\\')) return true;
  if (/^[A-Za-z]:[\\/]/.test(entryPath)) return true;
  const parts = entryPath.replace(/\\/g, '/').split('/');
  if (parts.some((p) => p === '..')) return true;
  return false;
}

function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    return 'manifest.json must be a JSON object';
  }
  for (const key of ['packageId', 'originUnit', 'classification', 'createdAt']) {
    if (typeof manifest[key] !== 'string' || !manifest[key].trim()) {
      return `manifest missing or invalid string field: ${key}`;
    }
  }
  if (!/^[A-Za-z0-9._-]+$/.test(manifest.packageId)) {
    return 'packageId must match [A-Za-z0-9._-]+';
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    return 'manifest.files must be a non-empty array';
  }
  for (const f of manifest.files) {
    if (!f || typeof f.path !== 'string' || typeof f.sha256 !== 'string') {
      return 'each files[] entry needs path and sha256 strings';
    }
    if (!/^[a-f0-9]{64}$/i.test(f.sha256)) {
      return `invalid sha256 for ${f.path}`;
    }
    if (isUnsafePath(f.path)) {
      return `unsafe path in manifest: ${f.path}`;
    }
  }
  return null;
}

export async function ingestPackage(buffer, size, logger) {
  const tempId = `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tempDir = join(STAGING_ROOT, tempId);
  await mkdir(tempDir, { recursive: true });

  let packageId = null;
  try {
    await pipeline(
      Readable.from(buffer),
      tar.x({
        cwd: tempDir,
        filter(path, entry) {
          if (entry.type === 'SymbolicLink' || entry.type === 'Link') {
            throw new Error(`symlinks are not allowed: ${path}`);
          }
          if (isUnsafePath(path)) {
            throw new Error(`unsafe archive path rejected: ${path}`);
          }
          return true;
        },
      })
    );

    const manifestPath = join(tempDir, 'manifest.json');
    let manifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    } catch {
      throw new Error('package must contain a valid manifest.json at the archive root');
    }

    const schemaError = validateManifest(manifest);
    if (schemaError) throw new Error(schemaError);

    packageId = manifest.packageId;
    const finalDir = join(STAGING_ROOT, packageId);
    const resolvedFinal = resolve(finalDir);
    if (!resolvedFinal.startsWith(resolve(STAGING_ROOT) + sep) && resolvedFinal !== resolve(STAGING_ROOT)) {
      throw new Error('resolved package path escapes staging root');
    }

    for (const file of manifest.files) {
      const abs = join(tempDir, file.path);
      const resolved = resolve(abs);
      if (!resolved.startsWith(resolve(tempDir) + sep)) {
        throw new Error(`file path escapes extract root: ${file.path}`);
      }
      let content;
      try {
        content = await readFile(abs);
      } catch {
        throw new Error(`manifest lists missing file: ${file.path}`);
      }
      const digest = sha256Hex(content);
      if (digest.toLowerCase() !== file.sha256.toLowerCase()) {
        throw new Error(`SHA-256 mismatch for ${file.path}`);
      }
    }

    await rm(finalDir, { recursive: true, force: true });
    await mkdir(STAGING_ROOT, { recursive: true });
    await rename(tempDir, finalDir);

    const result = {
      ok: true,
      packageId,
      originUnit: manifest.originUnit,
      classification: manifest.classification,
      createdAt: manifest.createdAt,
      fileCount: manifest.files.length,
      stagedPath: `staging/${packageId}`,
    };

    logger.info({ packageId, size, result: 'accepted' }, 'ingest');
    return result;
  } catch (err) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    const message = err.message || String(err);
    logger.info({ packageId, size, result: 'rejected', error: message }, 'ingest');
    return { ok: false, error: message, packageId };
  }
}

export async function listPackages() {
  await mkdir(STAGING_ROOT, { recursive: true });
  const entries = await readdir(STAGING_ROOT, { withFileTypes: true });
  const packages = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('tmp-')) continue;
    const manifestPath = join(STAGING_ROOT, entry.name, 'manifest.json');
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      const st = await stat(join(STAGING_ROOT, entry.name));
      packages.push({
        packageId: manifest.packageId,
        originUnit: manifest.originUnit,
        classification: manifest.classification,
        createdAt: manifest.createdAt,
        fileCount: Array.isArray(manifest.files) ? manifest.files.length : 0,
        stagedAt: st.mtime.toISOString(),
      });
    } catch {
      // skip incomplete staging dirs
    }
  }

  packages.sort((a, b) => a.packageId.localeCompare(b.packageId));
  return packages;
}
