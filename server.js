import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use((req, res, next) => {
  if (req.path === '/sw.js' || req.path === '/manifest.json') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
  if (req.path === '/sw.js') {
    res.setHeader('Service-Worker-Allowed', '/');
  }
  next();
});

app.use(express.static(publicDir, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.webmanifest') || filePath.endsWith('manifest.json')) {
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    }
  }
}));

app.use((_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`GRIMOIRE listening on http://0.0.0.0:${PORT}`);
});
