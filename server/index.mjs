// Intelligent 3D server: static dist/ + /api/health + streaming /api/compose (NDJSON SpecLines).
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compose, warm, accountType, MODEL, EFFORT, SERVICE_TIER, lastThreadInfo } from './compose.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const DIST = join(here, '..', 'dist');
const PORT = Number(process.env.PORT || 4320);
const HOST = process.env.HOST || '127.0.0.1';

let voice = null;
try { voice = await import('./voice.mjs'); } catch {}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.task': 'application/octet-stream', '.tflite': 'application/octet-stream', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };

function sendJson(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveStatic(req, res, url) {
  if (!existsSync(DIST)) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('dist/ not built. Run vite build, or use the vite dev server.'); return; }
  let p = decodeURIComponent(url.pathname);
  let file = normalize(join(DIST, p));
  if (!file.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    const idx = join(file, 'index.html');
    file = existsSync(idx) ? idx : (extname(p) ? null : join(DIST, 'index.html'));
  }
  if (!file || !existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

async function handleCompose(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req) || '{}'); } catch { return sendJson(res, 400, { error: 'Invalid JSON body' }); }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return sendJson(res, 400, { error: 'prompt required' });
  res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
  res.flushHeaders?.();
  req.socket.setNoDelay?.(true);
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableFinished) ac.abort(); });
  const t0 = Date.now();
  let first = null;
  const stats = await compose(
    { prompt, scene: typeof body.scene === 'string' ? body.scene : '', history: Array.isArray(body.history) ? body.history : [] },
    line => { if (first === null) first = Date.now() - t0; if (!res.destroyed) res.write(JSON.stringify(line) + '\n'); },
    ac.signal,
  ).catch(e => ({ error: e.message }));
  if (!res.destroyed) res.end();
  console.log(`[compose] ${JSON.stringify(prompt.slice(0, 60))} first=${first}ms total=${Date.now() - t0}ms valid=${stats.valid} dropped=${stats.dropped}${stats.aborted ? ' aborted' : ''}${stats.error ? ' error' : ''}`);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (voice?.handle && await voice.handle(req, res, url)) return;
    if (url.pathname === '/api/health') {
      let codex = accountType();
      if (codex === 'unknown') { try { codex = await warm(); } catch { codex = 'unavailable'; } }
      return sendJson(res, 200, { ok: codex !== 'unavailable', codex, model: MODEL, effort: EFFORT, serviceTier: SERVICE_TIER, provider: lastThreadInfo?.modelProvider ?? null });
    }
    if (url.pathname === '/api/compose' && req.method === 'POST') return await handleCompose(req, res);
    if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, url);
    res.writeHead(405); res.end();
  } catch (e) {
    if (!res.headersSent) sendJson(res, 500, { error: 'Server error' });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Intelligent 3D server on http://${HOST}:${PORT} (model ${MODEL}, effort ${EFFORT})`);
  warm().then(a => console.log(`[codex] account ${a}`)).catch(() => console.log('[codex] app-server unavailable'));
});

const shutdown = () => { server.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
