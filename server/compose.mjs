// The "compiler feed": turns a user request into a stream of validated SpecLines,
// produced by GPT on the ChatGPT subscription through one warm Codex app-server.
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexRPC } from './codex-rpc.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// gpt-6.1-sol is listed but rejected for ChatGPT-account Codex (400 model_not_found); gpt-5.6-sol works.
export const MODEL = process.env.I3D_MODEL || 'gpt-6.1-sol';
export const EFFORT = process.env.I3D_EFFORT || 'low';
export const SERVICE_TIER = process.env.I3D_TIER === 'none' ? null : (process.env.I3D_TIER || 'priority');
const PROMPT_PATH = join(here, 'prompt.md');
// Empty cwd so no AGENTS.md or project files get pulled into the context.
const WORKDIR = join(tmpdir(), 'intelligent-3d-codex');
mkdirSync(WORKDIR, { recursive: true });

let rpc = null;
let spare = null; // a pre-started thread, so a request skips thread/start latency
export let lastThreadInfo = null;

function loadPrompt() { return readFileSync(PROMPT_PATH, 'utf8'); } // re-read each thread so prompt edits apply live

export async function getRpc() {
  if (!rpc) {
    rpc = new CodexRPC(WORKDIR);
    rpc.on('disconnected', () => { spare = null; });
  }
  await rpc.connect();
  return rpc;
}

async function startThread() {
  const r = await getRpc();
  const params = {
    model: MODEL,
    modelProvider: 'openai',
    cwd: WORKDIR,
    approvalPolicy: 'never',
    sandbox: 'read-only',
    baseInstructions: loadPrompt(),
    ephemeral: true,
    environments: [],
  };
  if (SERVICE_TIER) params.serviceTier = SERVICE_TIER;
  let res;
  try {
    res = await r.call('thread/start', params);
  } catch (e) {
    // Retry without optional fields if the server rejects one of them.
    delete params.environments; delete params.serviceTier;
    res = await r.call('thread/start', params);
  }
  lastThreadInfo = { threadId: res.thread?.id, model: res.model, modelProvider: res.modelProvider, serviceTier: res.serviceTier ?? null, reasoningEffort: res.reasoningEffort ?? null, sandbox: res.sandbox?.type ?? res.sandbox };
  return res.thread.id;
}

// A new thread's first turn pays a one-off startup cost (~10-17 s, tool/plugin init).
// Run a tiny warm-up turn on the spare thread so the real request is its second turn (~1.5 s to first token).
async function warmThread(id) {
  const r = await getRpc();
  let done;
  const finished = new Promise(res => { done = res; });
  const onEvent = m => { if (m.params?.threadId === id && m.method === 'turn/completed') done(); };
  r.on('event', onEvent);
  try {
    await r.call('turn/start', { threadId: id, input: [{ type: 'text', text: 'Warm-up ping, no user yet. Reply with exactly {"t":"done"}', text_elements: [] }], effort: EFFORT, ...(SERVICE_TIER ? { serviceTier: SERVICE_TIER } : {}) });
    await Promise.race([finished, new Promise(res => setTimeout(res, 60000))]);
  } finally { r.off('event', onEvent); }
  return id;
}

function prestart() {
  if (spare) return;
  spare = startThread().then(warmThread).catch(() => null);
}

export async function warm() {
  await getRpc();
  prestart();
  return rpc.accountType;
}

export function accountType() { return rpc?.accountType || 'unknown'; }

// ---------- validation ----------
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isVec = v => Array.isArray(v) && v.length === 3 && v.every(isNum);
const isStr = v => typeof v === 'string' && v.length > 0;
const optVec = v => v === undefined || isVec(v);

function validShape(s) {
  if (!s || typeof s !== 'object') return false;
  switch (s.kind) {
    case 'tube': return isVec(s.from) && isVec(s.to) && isNum(s.radius) && s.radius > 0;
    case 'cylinder': return isVec(s.position) && optVec(s.rotation) && isNum(s.radius) && isNum(s.length);
    case 'torus': return isVec(s.position) && optVec(s.rotation) && isNum(s.radius) && isNum(s.tube);
    case 'box': return isVec(s.position) && optVec(s.rotation) && isVec(s.size);
    case 'sphere': return isVec(s.position) && isNum(s.radius);
    default: return false;
  }
}

function validAction(a) {
  if (!a || typeof a !== 'object') return false;
  switch (a.op) {
    case 'explode': return isNum(a.amount);
    case 'focus': return a.system === null || typeof a.system === 'string';
    case 'rotate': return isNum(a.y);
    case 'reset': return true;
    default: return false;
  }
}

export function validateLine(l) {
  if (!l || typeof l !== 'object') return null;
  switch (l.t) {
    case 'say': return typeof l.text === 'string' ? { t: 'say', text: l.text } : null;
    case 'clear': return { t: 'clear' };
    case 'done': return { t: 'done' };
    case 'assembly': {
      if (!isStr(l.id) || typeof l.title !== 'string' || !Array.isArray(l.systems)) return null;
      const systems = l.systems.filter(s => s && isStr(s.id) && typeof s.label === 'string')
        .map(s => ({ id: s.id, label: s.label, summary: typeof s.summary === 'string' ? s.summary : '', explode: isVec(s.explode) ? s.explode : [0, 0, 0], ...(typeof s.color === 'string' ? { color: s.color } : {}) }));
      return systems.length ? { t: 'assembly', id: l.id, title: l.title, systems } : null;
    }
    case 'part': {
      if (!isStr(l.assembly) || !isStr(l.id) || !isStr(l.system) || !Array.isArray(l.shapes)) return null;
      const shapes = l.shapes.filter(validShape);
      if (!shapes.length) return null;
      return { t: 'part', assembly: l.assembly, id: l.id, label: typeof l.label === 'string' ? l.label : l.id, system: l.system, ...(typeof l.color === 'string' ? { color: l.color } : {}), shapes };
    }
    case 'panel':
      if (!isStr(l.id) || typeof l.title !== 'string' || typeof l.body !== 'string') return null;
      return { t: 'panel', id: l.id, title: l.title, body: l.body, ...(typeof l.anchor === 'string' ? { anchor: l.anchor } : {}), ...(isVec(l.position) ? { position: l.position } : {}) };
    case 'controls': {
      if (!isStr(l.id) || !Array.isArray(l.buttons)) return null;
      const buttons = l.buttons.filter(b => b && typeof b.label === 'string' && validAction(b.action)).map(b => ({ label: b.label, action: b.action }));
      return buttons.length ? { t: 'controls', id: l.id, ...(typeof l.anchor === 'string' ? { anchor: l.anchor } : {}), buttons } : null;
    }
    case 'action': return validAction(l.action) ? { t: 'action', action: l.action } : null;
    default: return null;
  }
}

function parseLine(raw, stats) {
  let s = raw.trim();
  if (!s || s.startsWith('```')) return null;
  s = s.replace(/,\s*$/, '');
  let obj;
  try { obj = JSON.parse(s); } catch { stats.dropped++; return null; }
  const v = validateLine(obj);
  if (!v) { stats.dropped++; return null; }
  stats.valid++;
  return v;
}

function buildInput({ prompt, scene, history }) {
  const parts = [];
  if (Array.isArray(history) && history.length) {
    parts.push('Conversation so far:');
    for (const h of history.slice(-8)) {
      if (h && typeof h.text === 'string') parts.push(`${h.role === 'assistant' ? 'Assistant' : 'User'}: ${h.text.slice(0, 600)}`);
    }
    parts.push('');
  }
  parts.push(`Current scene: ${scene && String(scene).trim() ? String(scene).slice(0, 4000) : 'empty'}`);
  parts.push('');
  parts.push(`User: ${prompt}`);
  parts.push('');
  parts.push('Reply with NDJSON SpecLines only.');
  return parts.join('\n');
}

// Streams validated SpecLines to onLine. Resolves with stats. Always ends with a done line.
export async function compose(req, onLine, signal) {
  const stats = { valid: 0, dropped: 0, model: MODEL, effort: EFFORT };
  let sentDone = false;
  const emit = l => { if (sentDone) return; if (l.t === 'done') sentDone = true; onLine(l); };

  const r = await getRpc();
  let threadId = spare ? await spare : null;
  spare = null;
  if (!threadId) threadId = await startThread();
  stats.thread = lastThreadInfo;

  let buf = '';
  let turnId = null;
  let finish;
  const finished = new Promise(res => { finish = res; });

  const feed = text => {
    buf += text;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      const v = parseLine(line, stats);
      if (v) emit(v);
    }
  };

  let sawDelta = false;
  const onEvent = m => {
    const p = m.params || {};
    if (p.threadId && p.threadId !== threadId) return;
    if (m.method === 'item/agentMessage/delta') { sawDelta = true; feed(p.delta || ''); }
    else if (m.method === 'item/completed' && p.item?.type === 'agentMessage' && !sawDelta && typeof p.item.text === 'string') feed(p.item.text + '\n');
    else if (m.method === 'turn/started') turnId = p.turn?.id || turnId;
    else if (m.method === 'turn/completed') {
      const t = p.turn || {};
      if (t.status === 'failed') stats.error = t.error?.message || 'The model turn failed.';
      finish();
    } else if (m.method === 'error') {
      if (!p.willRetry) { stats.error = p.error?.message || 'The model returned an error.'; }
    }
  };
  const onDisc = msg => { stats.error = msg || 'Codex stopped'; finish(); };
  r.on('event', onEvent);
  r.on('disconnected', onDisc);

  const onAbort = () => {
    stats.aborted = true;
    if (turnId) r.call('turn/interrupt', { threadId, turnId }).catch(() => {});
    finish();
  };
  if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }

  try {
    const params = { threadId, input: [{ type: 'text', text: buildInput(req), text_elements: [] }], effort: EFFORT };
    if (SERVICE_TIER) params.serviceTier = SERVICE_TIER;
    const res = await r.call('turn/start', params);
    turnId = res?.turn?.id || turnId;
    if (stats.aborted && turnId) r.call('turn/interrupt', { threadId, turnId }).catch(() => {});
    const timeout = setTimeout(() => { stats.error = stats.error || 'The model took too long.'; onAbort(); }, 120000);
    await finished;
    clearTimeout(timeout);
    if (!stats.aborted && buf.trim()) { const v = parseLine(buf, stats); if (v) emit(v); buf = ''; }
  } catch (e) {
    stats.error = e.message || String(e);
  } finally {
    r.off('event', onEvent);
    r.off('disconnected', onDisc);
    signal?.removeEventListener?.('abort', onAbort);
    prestart();
  }
  if (stats.error && !stats.aborted) emit({ t: 'say', text: `Sorry, the model hit a problem: ${String(stats.error).slice(0, 160)}` });
  emit({ t: 'done' });
  return stats;
}
