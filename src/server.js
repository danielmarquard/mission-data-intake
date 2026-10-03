import express from 'express';
import multer from 'multer';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ingestPackage, listPackages, BANNER } from './ingest.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

const PORT = Number(process.env.PORT) || 3000;
const UPLOAD_LIMIT = 5 * 1024 * 1024; // 5 MB compressed
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const app = express();
app.use(pinoHttp({ logger }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_LIMIT },
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    banner: BANNER,
    version: pkg.version,
  });
});

app.post('/ingest', upload.single('package'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      banner: BANNER,
      ok: false,
      error: 'Missing multipart field "package"',
    });
  }

  try {
    const result = await ingestPackage(req.file.buffer, req.file.size, logger);
    const status = result.ok ? 200 : 400;
    return res.status(status).json({ banner: BANNER, ...result });
  } catch (err) {
    logger.error({ err }, 'ingest failed');
    return res.status(500).json({
      banner: BANNER,
      ok: false,
      error: err.message || 'Internal ingest error',
    });
  }
});

app.get('/packages', async (_req, res) => {
  try {
    const packages = await listPackages();
    res.json({ banner: BANNER, count: packages.length, packages });
  } catch (err) {
    logger.error({ err }, 'list packages failed');
    res.status(500).json({
      banner: BANNER,
      ok: false,
      error: err.message || 'Failed to list packages',
    });
  }
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        banner: BANNER,
        ok: false,
        error: `Compressed package exceeds ${UPLOAD_LIMIT} byte limit`,
      });
    }
    return res.status(400).json({ banner: BANNER, ok: false, error: err.message });
  }
  logger.error({ err }, 'unhandled error');
  return res.status(500).json({ banner: BANNER, ok: false, error: 'Internal server error' });
});

app.listen(PORT, () => {
  logger.info({ port: PORT, banner: BANNER, version: pkg.version }, 'mission-data-intake listening');
});
