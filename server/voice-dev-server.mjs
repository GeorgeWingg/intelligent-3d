// Standalone dev runner for voice: node server/voice-dev-server.mjs  ->  http://127.0.0.1:4330/voice-dev.html
// Mounts server/voice.mjs and serves the page + TS through Vite middleware.
import http from 'node:http';
import { createServer as createVite } from 'vite';
import { handle, shutdown } from './voice.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.VOICE_PORT || 4330);
const vite = await createVite({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'mpa', logLevel: 'warn' });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (await handle(req, res, url)) return;
  if (url.pathname === '/') { res.writeHead(302, { location: '/voice-dev.html' }); res.end(); return; }
  vite.middlewares(req, res, () => { res.writeHead(404); res.end('not found'); });
});
server.listen(PORT, '127.0.0.1', () => console.log(`voice dev on http://127.0.0.1:${PORT}/voice-dev.html`));
const quit = () => { shutdown(); vite.close(); server.close(); process.exit(0); };
process.on('SIGINT', quit); process.on('SIGTERM', quit);
