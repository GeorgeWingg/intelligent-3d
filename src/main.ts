// Wiring: chat or voice -> /api/compose (NDJSON SpecLines) -> scene; hands -> scene gestures.
import './styles.css';
import type { HandEvent, SpecLine } from './contract';
import { createScene } from './scene';
import { bikeFixture } from './scene/bike-fixture';
import { createHands } from './hands';
import { createChat, setModeLine } from './chat';
import { createVoice } from './voice';
import { createOrb } from './orb';
import { createWindows } from './windows';
import { createFlatCard, type FlatCard } from './flat';
import * as THREE from 'three';

const params = new URLSearchParams(location.search);
const stage = document.getElementById('stage')!;
if (params.has('glasses')) {
  const label = document.createElement('div');
  label.className = 'glasses-label';
  label.textContent = 'Simulated AR glasses view';
  document.body.append(label);
  document.body.classList.add('glasses-on');
}
const chat = createChat(document.getElementById('chat')!);

const mode = { camera: 'no camera', hands: 'hands off', voice: 'voice off', replay: false };
const showMode = () =>
  setModeLine([mode.replay ? 'Replay: pre-built bike, no model' : null, mode.camera, mode.hands, mode.voice].filter(Boolean).join(' · '));

// Camera: prefer the iPhone (Continuity Camera). The feed is a simulated passthrough, not world-anchored AR.
async function openCamera(): Promise<HTMLVideoElement | null> {
  if (params.has('nocam') || !navigator.mediaDevices?.getUserMedia) return null;
  try {
    // Ask once so device labels become visible, then switch to the iPhone if it is listed.
    const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    console.info('[camera] devices:', devices.map(d => d.label));
    const want = params.get('cam');
    const pick = devices.find(d => want ? d.label.toLowerCase().includes(want.toLowerCase()) : /iphone/i.test(d.label));
    let stream = probe;
    if (pick && pick.deviceId !== probe.getVideoTracks()[0]?.getSettings().deviceId) {
      probe.getTracks().forEach(t => t.stop());
      stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: pick.deviceId } }, audio: false });
    }
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    const label = stream.getVideoTracks()[0]?.label || 'camera';
    mode.camera = `Simulated passthrough: ${/iphone/i.test(label) ? 'iPhone camera' : label}${pick ? '' : ` (no iPhone among ${devices.length} cameras)`}`;
    return video;
  } catch (err) {
    mode.camera = `Camera error: ${(err as Error).name} ${(err as Error).message}`;
    console.error('[camera]', err);
    return null;
  }
}

const video = await openCamera();
// POV: an outward-facing camera (iPhone held or mounted at eye level) is shown unmirrored, like looking
// through glasses. A selfie webcam is mirrored. ?pov=1 / ?pov=0 overrides.
const camLabel = (video?.srcObject as MediaStream | null)?.getVideoTracks()[0]?.label ?? '';
const pov = params.has('pov') ? params.get('pov') !== '0' : /iphone/i.test(camLabel);
const mirror = !pov;
if (video) mode.camera += pov ? ' (POV)' : ' (mirrored)';
showMode();
// ?room=virtual: the camera only drives hand tracking; the view is a virtual room, not passthrough.
const virtualRoom = params.get('room') === 'virtual';
if (virtualRoom && video) mode.camera = 'Virtual room · camera used for hand tracking only';
showMode();
const scene = createScene(stage, { video: virtualRoom ? undefined : video ?? undefined, mirror });

// The chat is the main window, floating front-left; everything the model makes spawns out of it.
const windows = createWindows(stage, scene);
// Look slightly left so the chat window sits in view and the object sits right of centre.
scene.home.position.x -= 0.32;
scene.home.target.x -= 0.32;
const CHAT_POS = new THREE.Vector3(params.has('glasses') ? -0.66 : -0.8, 1.31, 0.9);
const chatEl = document.getElementById('chat')!;
chatEl.classList.add('i3d-in-space');
windows.add(chatEl, { id: 'chat', position: CHAT_POS, yaw: 0.34, width: 440, height: 620 });

// Model panels become their own windows, parked in an arc to the right of the object.
const SLOTS = [
  { p: new THREE.Vector3(0.36, 1.48, 0.95), yaw: -0.3 },
  { p: new THREE.Vector3(0.42, 1.08, 1.0), yaw: -0.34 },
  { p: new THREE.Vector3(-0.15, 1.72, 0.4), yaw: 0 },
  { p: new THREE.Vector3(0.45, 0.7, 0.85), yaw: -0.34 },
];
const panelIds: string[] = [];
function spawnPanel(line: Extract<SpecLine, { t: 'panel' }>) {
  const id = `panel:${line.id}`;
  let i = panelIds.indexOf(id);
  if (i < 0) { panelIds.push(id); i = panelIds.length - 1; }
  const slot = SLOTS[i % SLOTS.length];
  const el = document.createElement('div');
  el.className = 'xr-panel';
  const h = document.createElement('h3');
  h.textContent = line.title;
  const p = document.createElement('p');
  p.textContent = line.body;
  el.append(h, p);
  windows.add(el, { id, position: slot.p, yaw: slot.yaw, width: 320, from: CHAT_POS.clone().add(new THREE.Vector3(0.1, 0.1, 0.05)) });
}
// Model controls become a small window of buttons under the object.
function spawnControls(line: Extract<SpecLine, { t: 'controls' }>) {
  const el = document.createElement('div');
  el.className = 'xr-controls';
  for (const b of line.buttons) {
    const btn = document.createElement('button');
    btn.textContent = b.label;
    btn.addEventListener('click', () => scene.act(b.action));
    el.appendChild(btn);
  }
  if (!panelIds.includes('controls')) panelIds.push('controls');
  windows.add(el, { id: 'controls', position: new THREE.Vector3(-0.2, 0.66, 0.9), yaw: 0.05, width: 560, from: CHAT_POS.clone() });
}
function clearPanels() { panelIds.splice(0).forEach(id => windows.remove(id)); }

// Voice orb floats above the chat window while voice is on.
const orb = createOrb(0.07);
orb.object.position.set(CHAT_POS.x + 0.04, CHAT_POS.y + 0.44, CHAT_POS.z);
scene.attach(orb.object, dt => orb.update(dt));
let level = 0;
setInterval(() => { level *= 0.8; orb.setLevel(level); }, 60);

// The hidden camera element still needs to be in the DOM for frame callbacks in some browsers.
if (video && virtualRoom) { video.style.cssText = 'position:fixed;width:2px;height:2px;opacity:0;pointer-events:none'; document.body.appendChild(video); }

// Hands: MediaPipe on the same camera feed, mapped through the same cover-fit as the background.
if (video) {
  const overlay = document.createElement('div');
  overlay.id = 'hands-overlay';
  overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:2';
  stage.appendChild(overlay);
  let grab: { x: number; y: number; moved: number; system: string | null } | null = null;
  let winGrab = false;
  const onHand = (e: HandEvent) => {
    if (winGrab && e.type === 'pinchmove') { windows.pinchMove(e.dx, e.dy); return; }
    if (winGrab && (e.type === 'pinchend' || e.type === 'lost')) { windows.pinchEnd(); winGrab = false; return; }
    switch (e.type) {
      case 'pinchstart':
        if (windows.pinchStart(e.x, e.y)) { winGrab = true; grab = null; break; }
        if (scene.press(e.x, e.y)) { grab = null; break; }
        grab = { x: e.x, y: e.y, moved: 0, system: scene.pick(e.x, e.y)?.systemId ?? null };
        break;
      case 'pinchmove':
        if (!grab) break;
        grab.moved += Math.abs(e.dx) + Math.abs(e.dy);
        scene.rotateBy(e.dx * 2.6, -e.dy * 1.4);
        break;
      case 'pinchend':
        if (grab && grab.moved < 0.04 && grab.system) scene.act({ op: 'focus', system: grab.system });
        grab = null;
        break;
      case 'twohand':
        scene.explodeBy(e.delta * 1.8);
        break;
      case 'point':
        scene.hover(e.x, e.y);
        windows.hoverAt(e.x, e.y);
        break;
      case 'lost':
        scene.hover(null);
        windows.hoverAt(null);
        grab = null;
        break;
    }
  };
  const hands = createHands(video, onHand, { mirror, overlay });
  hands.start().then(
    () => { mode.hands = 'Hand tracking: MediaPipe on camera'; showMode(); },
    () => { mode.hands = 'Hand tracking unavailable'; showMode(); },
  );
}

// One answer, two forms: each new object first lands flat in the chat; pulling it out flies it into the room.
let card: FlatCard | null = null;
let pulledOut = true;
let deferred: SpecLine[] = [];
function pullOut() {
  if (pulledOut) return;
  pulledOut = true;
  card?.setPulled(true);
  scene.setPresent(true, CHAT_POS.clone().add(new THREE.Vector3(0.05, -0.05, 0.1)));
  const queued = deferred;
  deferred = [];
  setTimeout(() => queued.forEach(l => l.t === 'panel' ? spawnPanel(l) : l.t === 'controls' ? spawnControls(l) : null), 600);
  if (voice.mode === 'codex') voice.note('The user pulled the object out of the chat into the room.');
}
function newCard() {
  card = createFlatCard();
  card.onPull(pullOut);
  const turns = chatEl.querySelectorAll('.i3d-turn');
  (turns[turns.length - 1] ?? chatEl.querySelector('.i3d-log'))?.appendChild(card.el);
  pulledOut = false;
  deferred = [];
  scene.setPresent(false);
}

// Composition: stream SpecLines from the model and render each as it arrives.
const history: { role: 'user' | 'assistant'; text: string }[] = [];
let inflight: AbortController | null = null;

async function compose(prompt: string) {
  inflight?.abort();
  const ctrl = new AbortController();
  inflight = ctrl;
  chat.addUser(prompt);
  history.push({ role: 'user', text: prompt });
  const reply = chat.startAssistant();
  chat.setStatus('Thinking…');
  const started = performance.now();
  let said = '';
  let built = false;
  const handle = (line: SpecLine) => {
    if (ctrl.signal.aborted) return;
    if (line.t === 'say') {
      reply.append((said ? ' ' : '') + line.text);
      said += (said ? ' ' : '') + line.text;
      if (voice.mode === 'browser') voice.say(line.text);
      return;
    }
    if (line.t === 'done') return;
    if (line.t === 'assembly') { clearPanels(); newCard(); chat.setStatus(`Drawing ${line.title.toLowerCase()}…`); }
    if (line.t === 'clear') clearPanels();
    if (line.t === 'assembly' || line.t === 'part') card?.apply(line);
    if (line.t === 'panel' || line.t === 'controls') {
      if (!pulledOut) { deferred.push(line); return; }
      line.t === 'panel' ? spawnPanel(line) : spawnControls(line);
      return;
    }
    if (line.t === 'assembly' || line.t === 'part') built = true;
    scene.apply(line);
  };
  try {
    if (mode.replay) {
      for (const line of bikeFixture) { handle(line); await new Promise(r => setTimeout(r, 70)); }
    } else {
      const res = await fetch('/api/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, scene: scene.describe(), history: history.slice(-8) }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`compose failed (${res.status})`);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const raw = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!raw) continue;
          try { handle(JSON.parse(raw) as SpecLine); } catch { /* skip partial or invalid line */ }
        }
      }
    }
  } catch (err) {
    if (!ctrl.signal.aborted) reply.append(`\n\nSomething went wrong: ${(err as Error).message}`);
  } finally {
    if (inflight === ctrl) {
      inflight = null;
      chat.setStatus(null);
      const secs = ((performance.now() - started) / 1000).toFixed(1);
      reply.done();
      console.info(`[compose] ${secs}s${built ? ' (object)' : ''}${mode.replay ? ' replay' : ''}`);
      if (said) history.push({ role: 'assistant', text: said });
      if (voice.mode === 'codex') voice.note(`What is on screen now: ${scene.describe()}`);
    }
  }
}

chat.onSubmit(text => { if (text.trim()) compose(text.trim()); });

// Voice: Codex realtime on the ChatGPT subscription, falling back to browser speech (labelled).
let voiceOn = false;
const voice = createVoice({
  onPartial: text => { level = Math.max(level, 0.7); chat.setListening(true, text); },
  onFinal: text => { level = 0.9; chat.setListening(true); if (text.trim()) compose(text.trim()); },
  onAssistant: () => { level = Math.max(level, 0.8); },
  onState: (state, detail) => {
    if (state === 'listening') mode.voice = detail ?? (voice.mode === 'codex' ? 'Voice: Codex realtime (ChatGPT subscription)' : 'Voice: browser speech');
    else if (state === 'connecting') mode.voice = 'Voice: connecting…';
    else if (state === 'error') mode.voice = `Voice error${detail ? `: ${detail}` : ''}`;
    else mode.voice = 'voice off';
    showMode();
  },
});

chat.onVoiceToggle(async () => {
  voiceOn = !voiceOn;
  orb.setVisible(voiceOn);
  chat.setListening(voiceOn);
  if (voiceOn) {
    const used = await voice.start();
    mode.voice = used === 'codex' ? 'Voice: Codex realtime (ChatGPT subscription)' : 'Voice: browser speech';
    showMode();
  } else {
    voice.stop();
  }
});

if (params.get('replay') === 'bike') {
  mode.replay = true;
  showMode();
  compose('Break down the design of a 7-speed bike');
}
