// Voice for Intelligent 3D: ChatGPT-subscription realtime voice through `codex app-server`
// (experimental thread/realtime over WebRTC). The browser makes the SDP offer; we relay it to
// Codex and hand back the answer SDP. Transcripts stream to the browser over SSE.
//
// Routes (all under /api/voice):
//   POST /session {sdp}  -> {sdp, threadId}
//   GET  /events         -> SSE: {method, params} for thread/realtime/* (audio deltas excluded)
//   POST /note {text}    -> thread/realtime/appendText (developer role, falls back to user)
//   POST /stop           -> thread/realtime/stop
//   GET  /status         -> {ready, threadId, accountType, lastError}
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const VOICE_PROMPT = [
  'You are the voice of Intelligent 3D, a spatial assistant that builds 3D explanations (for example an exploded bike) over the camera view.',
  'Be warm, brief and conversational: one or two short sentences per reply.',
  'You do not need to describe geometry; the scene is composed separately from what the user says.',
  'When a developer note tells you what appeared on screen, you may refer to it naturally, but do not read notes aloud verbatim.',
  'Speak British English.',
].join(' ');

class CodexRPC extends EventEmitter {
  constructor(cwd) { super(); this.cwd = cwd; this.pending = new Map(); this.id = 0; this.ready = null; }
  connect() { if (!this.ready) this.ready = this.open().catch(e => { this.ready = null; throw e; }); return this.ready; }
  async open() {
    const env = { ...process.env }; delete env.OPENAI_API_KEY;
    const args = ['app-server', '-c', 'model_provider="openai"', '-c', 'features.realtime_conversation=true'];
    this.child = spawn(process.env.CODEX_BIN || 'codex', args, { cwd: this.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.on('data', () => {}); // never surface codex stderr (may contain local config)
    this.child.on('error', e => this.fail(e));
    this.child.on('exit', () => this.fail(new Error('Codex app-server stopped')));
    createInterface({ input: this.child.stdout }).on('line', line => {
      let m; try { m = JSON.parse(line); } catch { return; }
      if (m.id !== undefined && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id); clearTimeout(p.timer);
        if (m.error) { const e = new Error(m.error.message || 'Codex error'); e.code = m.error.code; p.reject(e); } else p.resolve(m.result);
      } else if (m.id !== undefined && m.method) {
        this.child.stdin.write(JSON.stringify({ id: m.id, error: { code: -32603, message: 'Voice session does not grant approvals.' } }) + '\n');
      } else if (m.method) this.emit('notification', m);
    });
    await this.call('initialize', { clientInfo: { name: 'intelligent-3d-voice', title: 'Intelligent 3D voice', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    this.child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    let accountType = 'unknown';
    try { const a = await this.call('account/read', { refreshToken: false }); accountType = a?.account?.type || 'unknown'; } catch {}
    return { accountType };
  }
  call(method, params, ms = 30000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex ${method} timed out`)); }, ms);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  fail(error) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear(); this.ready = null; this.emit('disconnected', error.message);
  }
  close() { try { this.child?.kill(); } catch {} this.ready = null; }
}

const state = { rpc: null, threadId: null, accountType: null, lastError: null, clients: new Set() };

function rpc() {
  if (!state.rpc) {
    state.rpc = new CodexRPC(ROOT);
    state.rpc.on('notification', m => {
      if (!m.method.startsWith('thread/realtime/')) return;
      if (m.method === 'thread/realtime/outputAudio/delta') return; // audio arrives over WebRTC
      if (m.params?.threadId && state.threadId && m.params.threadId !== state.threadId) return;
      if (m.method === 'thread/realtime/error') state.lastError = m.params?.message || 'realtime error';
      broadcast({ method: m.method, params: m.params });
    });
    state.rpc.on('disconnected', msg => { state.threadId = null; broadcast({ method: 'voice/disconnected', params: { message: msg } }); });
  }
  return state.rpc;
}

function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of state.clients) { try { res.write(data); } catch {} }
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 2e6) throw new Error('body too large'); }
  return body ? JSON.parse(body) : {};
}

function send(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function waitFor(client, predicate, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { client.off('notification', on); reject(new Error('Timed out waiting for realtime answer SDP')); }, ms);
    function on(m) {
      const r = predicate(m);
      if (r === undefined) return;
      clearTimeout(timer); client.off('notification', on);
      r instanceof Error ? reject(r) : resolve(r);
    }
    client.on('notification', on);
  });
}

export async function startSession(offerSdp, opts = {}) {
  const client = rpc();
  const info = await client.connect();
  state.accountType = info.accountType;
  if (state.threadId) { try { await client.call('thread/realtime/stop', { threadId: state.threadId }, 5000); } catch {} }
  const t0 = Date.now();
  const started = await client.call('thread/start', { ephemeral: true, cwd: ROOT, modelProvider: 'openai' });
  const threadId = started.thread.id;
  state.threadId = threadId; state.lastError = null;
  const answer = waitFor(client, m => {
    if (m.params?.threadId !== threadId) return undefined;
    if (m.method === 'thread/realtime/sdp') return m.params.sdp;
    if (m.method === 'thread/realtime/error') return new Error(m.params.message || 'realtime error');
    if (m.method === 'thread/realtime/closed') return new Error('realtime closed: ' + (m.params.reason || 'no reason'));
    return undefined;
  }, opts.timeoutMs || 45000);
  answer.catch(() => {});
  await client.call('thread/realtime/start', {
    threadId,
    outputModality: 'audio',
    prompt: VOICE_PROMPT,
    ...(opts.voice ? { voice: opts.voice } : {}),
    ...(process.env.VOICE_REALTIME_VERSION !== 'default' ? { version: process.env.VOICE_REALTIME_VERSION || 'v3' } : {}),
    transport: { type: 'webrtc', sdp: offerSdp },
  });
  const tStart = Date.now();
  const sdp = await answer;
  if (process.env.VOICE_DEBUG) console.log(`[voice] thread ${tStart - t0}ms, sdp ${Date.now() - tStart}ms`);
  return { sdp, threadId };
}

export async function note(text, role = 'developer') {
  if (!state.threadId) throw new Error('No voice session');
  if (role === 'user') { await state.rpc.call('thread/realtime/appendText', { threadId: state.threadId, text, role: 'user' }, 10000); return 'user'; }
  try { await state.rpc.call('thread/realtime/appendText', { threadId: state.threadId, text, role: 'developer' }, 10000); return 'developer'; }
  catch { await state.rpc.call('thread/realtime/appendText', { threadId: state.threadId, text, role: 'user' }, 10000); return 'user'; }
}

export async function stop() {
  const threadId = state.threadId; state.threadId = null;
  if (threadId && state.rpc) { try { await state.rpc.call('thread/realtime/stop', { threadId }, 5000); } catch {} }
}

export function shutdown() { state.rpc?.close(); state.rpc = null; state.threadId = null; }

export async function handle(req, res, url) {
  if (!url.pathname.startsWith('/api/voice/')) return false;
  const route = url.pathname.slice('/api/voice/'.length);
  try {
    if (route === 'events' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(': ok\n\n');
      state.clients.add(res);
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 15000);
      req.on('close', () => { clearInterval(ping); state.clients.delete(res); });
      return true;
    }
    if (route === 'status' && req.method === 'GET') {
      send(res, 200, { ready: !!state.rpc?.ready, threadId: state.threadId, accountType: state.accountType, lastError: state.lastError });
      return true;
    }
    if (route === 'session' && req.method === 'POST') {
      const body = await readJson(req);
      if (typeof body.sdp !== 'string' || !body.sdp.startsWith('v=')) { send(res, 400, { error: 'sdp offer required' }); return true; }
      const out = await startSession(body.sdp, { voice: body.voice });
      send(res, 200, out);
      return true;
    }
    if (route === 'note' && req.method === 'POST') {
      const body = await readJson(req);
      if (typeof body.text !== 'string' || !body.text.trim()) { send(res, 400, { error: 'text required' }); return true; }
      const role = await note(body.text.trim(), body.role === 'user' ? 'user' : 'developer');
      send(res, 200, { ok: true, role });
      return true;
    }
    if (route === 'stop' && req.method === 'POST') {
      await stop();
      send(res, 200, { ok: true });
      return true;
    }
    send(res, 404, { error: 'unknown voice route' });
    return true;
  } catch (e) {
    state.lastError = e.message;
    send(res, 502, { error: e.message, code: e.code ?? null });
    return true;
  }
}
