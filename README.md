# mission-data-intake

**UNCLASSIFIED // DEMO ONLY**

A small Node.js service that accepts `.tar.gz` mission data packages from partner units, validates them, and stages the contents. It exists to demonstrate **software supply chain risk management** (SBOM generation, dependency scanning, remediation) and an automated build-and-release pipeline.

All data used by this project is **synthetic**. Nothing here is operational, classified, or derived from real missions.

## Intentional vulnerable dependency pin

> **DEMO PIN (intentional):** This project pins [`tar`](https://www.npmjs.com/package/tar) to exactly **`7.5.18`** in `package.json` (no `^` / `~`) and commits `package-lock.json` so the version is reproducible.
>
> **Do not upgrade it for the initial demo.** Do not add npm `overrides` that change it.
>
> **`tar@7.5.19` or later fixes [CVE-2026-59873](https://github.com/advisories).** The remediation step in the demo walkthrough is bumping to `>= 7.5.19` in a pull request so CI/`npm audit` and the SBOM show a clean result, then merging to publish the patched release.

## Overview

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Status, classification banner, and application version |
| `POST /ingest` | Multipart upload (`package` field) of a `.tar.gz` mission package |
| `GET /packages` | List staged packages and manifest metadata |

Behavior highlights:

- Compressed upload limit: **5 MB** (enforced by multer)
- Extract with `node-tar` into `./staging/<package-id>/`
- Path filter rejects absolute paths, `..`, and symlinks
- Requires root `manifest.json` with `packageId`, `originUnit`, `classification`, `createdAt`, and `files[{path, sha256}]`
- Verifies each listed file’s SHA-256; rejects on mismatch

## How to run

Requirements: **Node.js 22+**

```bash
npm ci
npm run sample          # writes samples/sample-package.tar.gz
npm start               # listens on PORT (default 3000)
```

Other scripts:

```bash
npm run smoke           # start app, ingest sample, assert success
npm run audit           # npm audit
npm run sbom            # CycloneDX SBOM -> sbom.cdx.json
```

Docker:

```bash
docker build -t mission-data-intake .
docker run --rm -p 3000:3000 mission-data-intake
```

## API example

```bash
# Health
curl -s http://127.0.0.1:3000/health | jq .

# Ingest the sample package
curl -s -F "package=@samples/sample-package.tar.gz" \
  http://127.0.0.1:3000/ingest | jq .

# List staged packages
curl -s http://127.0.0.1:3000/packages | jq .
```

Example successful ingest response:

```json
{
  "banner": "UNCLASSIFIED // DEMO ONLY",
  "ok": true,
  "packageId": "DEMO-PKG-001",
  "originUnit": "Partner Unit Alpha (synthetic)",
  "classification": "UNCLASSIFIED // DEMO ONLY",
  "createdAt": "2026-03-03T12:00:00.000Z",
  "fileCount": 3,
  "stagedPath": "staging/DEMO-PKG-001"
}
```

## Release process

Every merge (push) to `main` runs `.github/workflows/release.yml` and publishes a GitHub Release:

1. **Versioning** (`scripts/next-version.sh`): consider only tags matching `vMAJOR.MINOR.PATCH`. If none exist → **`1.0.0`**. Otherwise take the highest tag (numeric sort) and increment **PATCH** (`v1.0.0` → `1.0.1` → `1.0.2`).
2. The workflow stamps the version into `package.json` **on the runner only** (`npm version … --no-git-tag-version`). It does **not** commit back to the repo (avoids retrigger loops).
3. Production install (`npm ci --omit=dev`) stages a self-contained payload for disconnected / air-gapped deployment.
4. Release archives published as assets (plus SBOM + checksums):
   - `mission-data-intake-<version>.tar.gz`
   - `mission-data-intake-<version>.tar.bz2`
   - `mission-data-intake-<version>.tar.xz`
   - `mission-data-intake-<version>.tar.zst`
   - `mission-data-intake-<version>.zip`
   - `mission-data-intake-<version>.7z`
   - `sbom.cdx.json`
   - `SHA256SUMS`

**Recommendation:** Enable branch protection on `main` so it only changes via pull requests. That keeps the release cadence (one release per merge) predictable and reviewable.

CI on pull requests (`.github/workflows/ci.yml`) runs install, sample generation, smoke ingest, `npm audit`, and SBOM generation (SBOM uploaded as a workflow artifact). `npm audit` is **non-blocking by default** via `AUDIT_GATE` (default `"false"`). Set `AUDIT_GATE=true` to fail the job on high/critical findings.

## Demo walkthrough

1. **Run and ingest** — `npm ci && npm run sample && npm start`, then `curl` the sample package into `/ingest`. Confirm staging under `staging/DEMO-PKG-001/`.
2. **First release** — Open a PR, merge to `main`. The release workflow publishes **`v1.0.0`**. Inspect the release assets and attached CycloneDX SBOM.
3. **Show the finding** — Run `npm audit` (or open the SBOM) and highlight the intentional **`tar@7.5.18`** finding related to CVE-2026-59873.
4. **Remediate in a PR** — Bump `tar` to a patched release (`>= 7.5.19` for CVE-2026-59873; use whatever version `npm audit` currently reports as fixed), refresh the lockfile, open a PR. With `AUDIT_GATE=true` (or by inspecting audit output), show CI is clean.
5. **Patched release** — Merge to `main` to publish **`v1.0.1`**. Show the new SBOM lists the patched `tar`.
6. **Regression check** — Re-ingest `samples/sample-package.tar.gz` against the new build and confirm no functional regression.

## License / classification

**UNCLASSIFIED // DEMO ONLY** — synthetic data, intentional vulnerable pin for training, not for production use.
