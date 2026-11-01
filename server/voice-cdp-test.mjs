// Real end-to-end check of the realtime voice path without audible audio.
// Needs server/voice-dev-server.mjs running on 4330. Writes evidence/voice-realtime.json.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PAGE = process.env.VOICE_URL || 'http://127.0.0.1:4330/voice-dev.html';
const DBG = 9341;
const profile = mkdtempSync(path.join(process.env.TMPDIR || tmpdir(), 'voice-cdp-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${profile}`,
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const evidence = { at: new Date().toISOString(), page: PAGE, steps: [] };
const step = (name, data) => { evidence.steps.push({ name, ...data }); console.log(name, JSON.stringify(data)); };

try {
  let targets;
  for (let i = 0; i < 40; i++) { try { targets = await (await fetch(`http://127.0.0.1:${DBG}/json`)).json(); break; } catch { await sleep(250); } }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map(); const consoleLines = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled') consoleLines.push(m.params.args.map(a => a.value ?? a.description).join(' '));
  });
  const cdp = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async expr => { const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };

  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Page.navigate', { url: PAGE });
  for (let i = 0; i < 40 && !(await evaluate('!!window.__voice')); i++) await sleep(250);
  step('page-loaded', { voiceReady: await evaluate('!!window.__voice') });

  // Capture the RTCPeerConnection the client creates so we can read its state.
  await evaluate(`(() => { const O = window.RTCPeerConnection; window.__pcs = []; window.RTCPeerConnection = function(...a){ const pc = new O(...a); window.__pcs.push(pc); return pc; }; window.RTCPeerConnection.prototype = O.prototype; return true; })()`);

  const t0 = Date.now();
  const mode = await evaluate(`window.__voice.start('codex').catch(e => 'threw: ' + e.message)`);
  const states = await evaluate('window.__voiceStates');
  const pcInfo = await evaluate(`(window.__pcs||[]).map(pc => ({ connectionState: pc.connectionState, iceConnectionState: pc.iceConnectionState, signalingState: pc.signalingState, remoteHasAudio: /m=audio/.test(pc.remoteDescription?.sdp || '') }))`);
  step('start-codex', { mode, ms: Date.now() - t0, states, peerConnections: pcInfo });

  if (mode === 'codex') {
    const status = await (await fetch('http://127.0.0.1:4330/api/voice/status')).json();
    step('server-status', { threadIdPresent: !!status.threadId, accountType: status.accountType, lastError: status.lastError });
    const n = await fetch('http://127.0.0.1:4330/api/voice/note', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'The bike is now on screen, exploded into five systems. Say one short sentence about it.' }) });
    step('note', { status: n.status, body: await n.json() });
    await sleep(3000);
    const u = await fetch('http://127.0.0.1:4330/api/voice/note', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'user', text: 'Hello, can you hear me? Reply in one short sentence.' }) });
    step('user-text', { status: u.status, body: await u.json() });
    await sleep(10000);
    const log = await evaluate(`[...document.querySelectorAll('#log p')].map(p => p.className + ': ' + p.textContent)`);
    const pc2 = await evaluate(`(window.__pcs||[]).map(pc => pc.connectionState)`);
    step('after-note', { log, connectionStates: pc2 });
    await evaluate('window.__voice.stop(), true');
    await sleep(500);
  } else {
    const b = await evaluate(`window.__voice.start('browser').catch(e => 'threw: ' + e.message)`);
    step('start-browser', { mode: b, states: await evaluate('window.__voiceStates') });
  }
  evidence.consoleErrors = consoleLines.filter(l => /error/i.test(l)).slice(0, 10);
  evidence.result = evidence.steps.find(s => s.name === 'start-codex')?.mode === 'codex' ? 'realtime-connected' : 'realtime-failed';
  ws.close();
} catch (e) {
  evidence.result = 'test-error'; evidence.error = e.message;
} finally {
  chrome.kill();
  mkdirSync(path.join(ROOT, 'evidence'), { recursive: true });
  writeFileSync(path.join(ROOT, 'evidence/voice-realtime.json'), JSON.stringify(evidence, null, 2));
  console.log('result', evidence.result);
}
