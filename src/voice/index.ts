// Voice input/output for Intelligent 3D.
// 'codex' mode: WebRTC to the ChatGPT realtime model via server/voice.mjs (codex app-server).
// 'browser' mode: Chrome Web Speech recognition + speechSynthesis, used when codex fails.

export type VoiceMode = 'codex' | 'browser';
export type VoiceState = 'idle' | 'connecting' | 'listening' | 'error';

export interface VoiceCallbacks {
  onPartial(text: string): void;
  onFinal(text: string): void;
  onAssistant(text: string): void;
  onState(state: VoiceState, detail?: string): void;
}

export interface Voice {
  start(mode?: VoiceMode): Promise<VoiceMode>;
  stop(): void;
  note(text: string): void;
  say(text: string): void;
  readonly mode: VoiceMode | null;
}

interface RealtimeEvent { method: string; params?: Record<string, unknown> }

// Minimal Web Speech typings (not in lib.dom).
interface SpeechAlt { transcript: string }
interface SpeechResult { isFinal: boolean; length: number; [i: number]: SpeechAlt }
interface SpeechEvent { resultIndex: number; results: { length: number; [i: number]: SpeechResult } }
interface Recognition {
  continuous: boolean; interimResults: boolean; lang: string;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type RecognitionCtor = new () => Recognition;

const API = '/api/voice';

function isUserRole(role: unknown): boolean { return role === 'user' || role === 'input'; }

export function createVoice(cb: VoiceCallbacks): Voice {
  let mode: VoiceMode | null = null;
  let pc: RTCPeerConnection | null = null;
  let mic: MediaStream | null = null;
  let audioEl: HTMLAudioElement | null = null;
  let events: EventSource | null = null;
  let recog: Recognition | null = null;
  let wantRecog = false;
  let userPartial = '';
  let assistantPartial = '';

  function teardownCodex(): void {
    events?.close(); events = null;
    pc?.close(); pc = null;
    mic?.getTracks().forEach(t => t.stop()); mic = null;
    if (audioEl) { audioEl.srcObject = null; audioEl.remove(); audioEl = null; }
    userPartial = ''; assistantPartial = '';
  }

  function onRealtime(ev: RealtimeEvent): void {
    const p = ev.params ?? {};
    switch (ev.method) {
      case 'thread/realtime/transcript/delta': {
        const delta = String(p.delta ?? '');
        if (isUserRole(p.role)) { userPartial += delta; cb.onPartial(userPartial); }
        else assistantPartial += delta;
        break;
      }
      case 'thread/realtime/transcript/done': {
        const text = String(p.text ?? '').trim();
        if (isUserRole(p.role)) { userPartial = ''; if (text) cb.onFinal(text); }
        else { assistantPartial = ''; if (text) cb.onAssistant(text); }
        break;
      }
      case 'thread/realtime/error':
        if (mode === 'codex') cb.onState('error', 'Realtime voice error: ' + String(p.message ?? 'unknown'));
        break;
      case 'thread/realtime/closed':
      case 'voice/disconnected':
        if (mode === 'codex') { teardownCodex(); mode = null; cb.onState('idle', 'Realtime voice closed'); }
        break;
    }
  }

  async function startCodex(): Promise<void> {
    events = new EventSource(`${API}/events`);
    events.onmessage = m => { try { onRealtime(JSON.parse(m.data) as RealtimeEvent); } catch { /* ignore */ } };

    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    pc = new RTCPeerConnection();
    audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.style.display = 'none';
    document.body.appendChild(audioEl);
    const el = audioEl;
    pc.ontrack = e => { el.srcObject = e.streams[0] ?? new MediaStream([e.track]); };
    for (const track of mic.getAudioTracks()) pc.addTrack(track, mic);
    // The realtime transport expects an events data channel in the offer.
    pc.createDataChannel('oai-events');

    await pc.setLocalDescription(await pc.createOffer());
    await waitIce(pc, 2000);
    const offer = pc.localDescription?.sdp;
    if (!offer) throw new Error('No local SDP offer');

    const r = await fetch(`${API}/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sdp: offer }) });
    const body = await r.json().catch(() => ({})) as { sdp?: string; error?: string };
    if (!r.ok || !body.sdp) throw new Error(body.error || `Voice session failed (${r.status})`);
    await pc.setRemoteDescription({ type: 'answer', sdp: body.sdp });
    await waitConnected(pc, 15000);
    const conn = pc;
    conn.onconnectionstatechange = () => {
      if (mode === 'codex' && (conn.connectionState === 'failed' || conn.connectionState === 'closed')) {
        teardownCodex(); mode = null; cb.onState('error', 'Realtime voice connection ' + conn.connectionState);
      }
    };
  }

  function startBrowser(): void {
    const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) throw new Error('Speech recognition is not available in this browser');
    const r = new Ctor();
    r.continuous = true; r.interimResults = true; r.lang = 'en-GB';
    r.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]; const text = res[0]?.transcript ?? '';
        if (res.isFinal) { const t = text.trim(); if (t) cb.onFinal(t); } else interim += text;
      }
      if (interim) cb.onPartial(interim.trim());
    };
    r.onerror = e => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { wantRecog = false; cb.onState('error', 'Microphone permission denied'); }
      else cb.onState('error', 'Speech recognition: ' + e.error);
    };
    r.onend = () => { if (wantRecog) { try { r.start(); } catch { /* already started */ } } };
    recog = r; wantRecog = true;
    r.start();
  }

  function pickVoice(): SpeechSynthesisVoice | null {
    const voices = speechSynthesis.getVoices();
    const gb = voices.filter(v => v.lang.replace('_', '-').toLowerCase().startsWith('en-gb'));
    const pool = gb.length ? gb : voices.filter(v => v.lang.toLowerCase().startsWith('en'));
    const prefer = ['Google UK English Female', 'Serena', 'Kate', 'Stephanie', 'Martha', 'Daniel', 'Google UK English Male'];
    for (const name of prefer) { const v = pool.find(x => x.name.includes(name)); if (v) return v; }
    return pool.find(v => /premium|enhanced|natural/i.test(v.name)) ?? pool[0] ?? null;
  }

  return {
    get mode() { return mode; },

    async start(preferred: VoiceMode = 'codex'): Promise<VoiceMode> {
      this.stop();
      cb.onState('connecting');
      let codexError = '';
      if (preferred === 'codex') {
        try {
          await startCodex();
          mode = 'codex';
          cb.onState('listening', 'Realtime voice (ChatGPT)');
          return mode;
        } catch (e) {
          codexError = e instanceof Error ? e.message : String(e);
          teardownCodex();
        }
      }
      try {
        startBrowser();
        mode = 'browser';
        cb.onState('listening', codexError ? `Browser speech (realtime unavailable: ${codexError})` : 'Browser speech');
        return mode;
      } catch (e) {
        mode = null;
        const msg = e instanceof Error ? e.message : String(e);
        cb.onState('error', codexError ? `${msg}; realtime unavailable: ${codexError}` : msg);
        throw e;
      }
    },

    stop(): void {
      if (mode === 'codex') { void fetch(`${API}/stop`, { method: 'POST' }).catch(() => undefined); }
      teardownCodex();
      wantRecog = false;
      if (recog) { try { recog.abort(); } catch { /* ignore */ } recog = null; }
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
      const was = mode; mode = null;
      if (was) cb.onState('idle');
    },

    note(text: string): void {
      if (mode !== 'codex' || !text.trim()) return;
      void fetch(`${API}/note`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) }).catch(() => undefined);
    },

    say(text: string): void {
      if (mode === 'codex' || !text.trim() || typeof speechSynthesis === 'undefined') return;
      const u = new SpeechSynthesisUtterance(text);
      const v = pickVoice();
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-GB';
      u.rate = 1.02;
      // Pause recognition while speaking so we don't transcribe ourselves.
      const resume = wantRecog;
      if (recog && resume) { wantRecog = false; try { recog.stop(); } catch { /* ignore */ } }
      u.onend = u.onerror = () => { if (resume && recog && mode === 'browser') { wantRecog = true; try { recog.start(); } catch { /* ignore */ } } };
      speechSynthesis.speak(u);
    },
  };
}

function waitIce(pc: RTCPeerConnection, ms: number): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(resolve => {
    const t = setTimeout(done, ms);
    function done(): void { clearTimeout(t); pc.removeEventListener('icegatheringstatechange', check); resolve(); }
    function check(): void { if (pc.iceGatheringState === 'complete') done(); }
    pc.addEventListener('icegatheringstatechange', check);
  });
}

function waitConnected(pc: RTCPeerConnection, ms: number): Promise<void> {
  if (pc.connectionState === 'connected') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { cleanup(); reject(new Error('WebRTC did not connect (state ' + pc.connectionState + ')')); }, ms);
    function cleanup(): void { clearTimeout(t); pc.removeEventListener('connectionstatechange', check); }
    function check(): void {
      if (pc.connectionState === 'connected') { cleanup(); resolve(); }
      else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') { cleanup(); reject(new Error('WebRTC ' + pc.connectionState)); }
    }
    pc.addEventListener('connectionstatechange', check);
  });
}
