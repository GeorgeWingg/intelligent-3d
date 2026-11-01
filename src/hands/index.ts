// Hand tracking from the camera feed: MediaPipe HandLandmarker -> gestures -> HandEvents + overlay.
import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';
import type { HandEvent } from '../contract';
import { videoToNdc } from '../coords';
import { GestureEngine, type HandInput, type HandName } from './gestures';
import { HandOverlay } from './overlay';

export { GestureEngine, pinchRatio, OneEuro } from './gestures';
export type { HandInput, HandView, Landmark, GestureOptions } from './gestures';

export interface HandsOptions {
  mirror: boolean;
  overlay: HTMLElement;
  delegate?: 'GPU' | 'CPU'; // default: try GPU, fall back to CPU
}

export interface Hands {
  start(): Promise<void>;
  stop(): void;
  readonly running: boolean;
  readonly fps: number; // detection frames per second (smoothed)
  readonly delegate: 'GPU' | 'CPU' | null;
}

const BASE = import.meta.env.BASE_URL ?? '/';
const WASM_PATH = `${BASE}mediapipe-wasm`;
const MODEL_PATH = `${BASE}models/hand_landmarker.task`;

const landmarkers = new Map<string, Promise<{ lm: HandLandmarker; delegate: 'GPU' | 'CPU' }>>();

function loadLandmarker(prefer: 'GPU' | 'CPU' = 'GPU'): Promise<{ lm: HandLandmarker; delegate: 'GPU' | 'CPU' }> {
  const cached = landmarkers.get(prefer);
  if (cached) return cached;
  const p = (async () => {
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    const make = (delegate: 'GPU' | 'CPU') =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    if (prefer === 'GPU') {
      try {
        return { lm: await make('GPU'), delegate: 'GPU' as const };
      } catch (err) {
        console.warn('[hands] GPU delegate failed, using CPU', err);
      }
    }
    return { lm: await make('CPU'), delegate: 'CPU' as const };
  })();
  landmarkers.set(prefer, p);
  p.catch(() => landmarkers.delete(prefer));
  return p;
}

// MediaPipe labels handedness assuming a mirrored (selfie) image; camera frames are not mirrored,
// so its label is the opposite of the real hand.
function toInputs(res: HandLandmarkerResult): HandInput[] {
  return res.landmarks.map((landmarks, i) => {
    const label = res.handedness[i]?.[0]?.categoryName;
    const hand: HandName = label === 'Left' ? 'Right' : 'Left';
    return { hand, landmarks };
  });
}

export function createHands(
  video: HTMLVideoElement,
  onEvent: (e: HandEvent) => void,
  opts: HandsOptions,
): Hands {
  const overlay = new HandOverlay(opts.overlay);
  const fit = () => {
    const { w, h } = overlay.size;
    return { videoW: video.videoWidth || 1, videoH: video.videoHeight || 1, viewW: w, viewH: h, mirror: opts.mirror };
  };
  const engine = new GestureEngine({ toNdc: (u, v) => videoToNdc(u, v, fit()) });

  let running = false;
  let lm: HandLandmarker | null = null;
  let delegate: 'GPU' | 'CPU' | null = null;
  let lastTs = -1;
  let lastVideoTime = -1;
  let fps = 0;
  let lastFrameAt = 0;
  let rafId = 0;
  let vfcId = 0;
  // requestVideoFrameCallback only fires for composited videos; the app may hide the <video> and
  // draw it via a texture, so fall back to rAF (deduped on currentTime) when the video is not visible.
  const useVfc = () =>
    'requestVideoFrameCallback' in HTMLVideoElement.prototype && video.isConnected && video.offsetParent !== null;
  let viaVfc = false;

  const schedule = () => {
    if (!running) return;
    viaVfc = useVfc();
    if (viaVfc) vfcId = video.requestVideoFrameCallback(tick);
    else rafId = requestAnimationFrame(tick);
  };

  const tick = () => {
    if (!running || !lm) return;
    try {
      const ready = video.readyState >= 2 && video.videoWidth > 0;
      if (ready && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        let ts = performance.now();
        if (ts <= lastTs) ts = lastTs + 0.001;
        lastTs = ts;
        engine.setAspect(video.videoWidth / video.videoHeight);
        const res = lm.detectForVideo(video, ts);
        const events = engine.update(toInputs(res), ts);
        for (const e of events) onEvent(e);
        overlay.draw(engine.hands);
        if (lastFrameAt) {
          const inst = 1000 / Math.max(1, ts - lastFrameAt);
          fps = fps ? fps * 0.9 + inst * 0.1 : inst;
        }
        lastFrameAt = ts;
      }
    } catch (err) {
      console.warn('[hands] detection error', err);
    }
    schedule();
  };

  return {
    async start() {
      if (running) return;
      const loaded = await loadLandmarker(opts.delegate);
      lm = loaded.lm;
      delegate = loaded.delegate;
      running = true;
      lastVideoTime = -1;
      schedule();
    },
    stop() {
      running = false;
      if (viaVfc && vfcId) video.cancelVideoFrameCallback(vfcId);
      if (rafId) cancelAnimationFrame(rafId);
      vfcId = rafId = 0;
      const pending = engine.update([], Number.MAX_SAFE_INTEGER / 2);
      for (const e of pending) if (e.type === 'pinchend' || e.type === 'lost') onEvent(e);
      engine.reset();
      overlay.clear();
      fps = 0;
      lastFrameAt = 0;
    },
    get running() {
      return running;
    },
    get fps() {
      return fps;
    },
    get delegate() {
      return delegate;
    },
  };
}
