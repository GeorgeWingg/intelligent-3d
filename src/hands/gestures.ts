// Pure gesture recogniser: per-frame MediaPipe landmarks in, HandEvents out.
// No DOM, no MediaPipe import, so it runs under node for tests.
import type { HandEvent } from '../contract';

export type HandName = 'Left' | 'Right';

export interface Landmark {
  x: number; // 0..1 video coords, origin top-left, unmirrored
  y: number;
  z?: number;
}

export interface HandInput {
  hand: HandName; // true handedness (index.ts flips MediaPipe's selfie-assumed label)
  landmarks: Landmark[]; // 21 points
}

export interface GestureOptions {
  // Maps normalised video coords to view NDC (use videoToNdc with the current cover fit).
  toNdc: (u: number, v: number) => { x: number; y: number };
  // Video width / height, so pinch distance is measured in square pixels.
  aspect?: number;
  enter?: number; // pinch ratio below which a pinch starts (default 0.28)
  exit?: number; // pinch ratio above which a pinch ends (default 0.42)
  debounce?: number; // consecutive frames a state change must hold (default 2)
  lostMs?: number; // no hands for this long -> 'lost' (default 300)
  dropMs?: number; // a single hand missing this long ends its pinch (default 150)
  minCutoff?: number; // One-Euro params
  beta?: number;
}

export interface HandView {
  hand: HandName;
  pinching: boolean;
  ratio: number;
  tip: { x: number; y: number }; // smoothed index tip, NDC
  pinchPoint: { x: number; y: number }; // smoothed thumb/index midpoint, NDC
  points: { x: number; y: number }[]; // all 21 landmarks, NDC (unsmoothed)
}

export const TIP_THUMB = 4;
export const TIP_INDEX = 8;
export const WRIST = 0;
export const MIDDLE_MCP = 9;

class LowPass {
  private y: number | null = null;
  filter(x: number, a: number): number {
    this.y = this.y === null ? x : a * x + (1 - a) * this.y;
    return this.y;
  }
  get last(): number | null {
    return this.y;
  }
  reset(): void {
    this.y = null;
  }
}

// One-Euro filter (Casiez et al.): low lag when moving fast, low jitter when still.
export class OneEuro {
  private x = new LowPass();
  private dx = new LowPass();
  private lastT: number | null = null;
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  constructor(minCutoff = 1.2, beta = 0.02, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }
  private alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(value: number, tMs: number): number {
    const dt = this.lastT === null ? 1 / 60 : Math.max(1e-3, (tMs - this.lastT) / 1000);
    this.lastT = tMs;
    const prev = this.x.last;
    const d = prev === null ? 0 : (value - prev) / dt;
    const ed = this.dx.filter(d, this.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(ed);
    return this.x.filter(value, this.alpha(cutoff, dt));
  }
  reset(): void {
    this.x.reset();
    this.dx.reset();
    this.lastT = null;
  }
}

interface Track {
  hand: HandName;
  pinching: boolean;
  pending: number; // frames the opposite state has held
  ratio: number;
  fx: OneEuro[]; // tip x,y and pinch x,y
  tip: { x: number; y: number };
  pinch: { x: number; y: number };
  lastPinch: { x: number; y: number } | null;
  points: { x: number; y: number }[];
  lastSeen: number;
}

export function pinchRatio(lm: Landmark[], aspect = 1): number {
  const d = (a: Landmark, b: Landmark) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
  const size = d(lm[WRIST], lm[MIDDLE_MCP]);
  if (size < 1e-6) return Infinity;
  return d(lm[TIP_THUMB], lm[TIP_INDEX]) / size;
}

export class GestureEngine {
  private tracks = new Map<HandName, Track>();
  private lastAnyHand: number | null = null;
  private lostSent = true; // nothing to lose before the first hand
  private prevSpread: number | null = null;
  private o: Required<Omit<GestureOptions, 'toNdc'>> & Pick<GestureOptions, 'toNdc'>;

  constructor(opts: GestureOptions) {
    this.o = {
      aspect: 1,
      enter: 0.28,
      exit: 0.42,
      debounce: 2,
      lostMs: 300,
      dropMs: 150,
      minCutoff: 1.2,
      beta: 0.02,
      ...opts,
    };
  }

  setAspect(aspect: number): void {
    this.o.aspect = aspect;
  }
  setToNdc(fn: GestureOptions['toNdc']): void {
    this.o.toNdc = fn;
  }

  // Current per-hand state for the overlay.
  get hands(): HandView[] {
    return [...this.tracks.values()].map((t) => ({
      hand: t.hand,
      pinching: t.pinching,
      ratio: t.ratio,
      tip: t.tip,
      pinchPoint: t.pinch,
      points: t.points,
    }));
  }

  reset(): void {
    this.tracks.clear();
    this.prevSpread = null;
    this.lastAnyHand = null;
    this.lostSent = true;
  }

  update(input: HandInput[], tMs: number): HandEvent[] {
    const out: HandEvent[] = [];
    const { toNdc, aspect, enter, exit, debounce } = this.o;

    // Two detections with the same label: assign by screen position (leftmost = Left).
    let hands = input.filter((h) => h.landmarks.length >= 21);
    if (hands.length === 2 && hands[0].hand === hands[1].hand) {
      const xs = hands.map((h) => toNdc(h.landmarks[WRIST].x, h.landmarks[WRIST].y).x);
      const leftFirst = xs[0] <= xs[1];
      hands = [
        { ...hands[0], hand: leftFirst ? 'Left' : 'Right' },
        { ...hands[1], hand: leftFirst ? 'Right' : 'Left' },
      ];
    }
    hands = hands.slice(0, 2);

    for (const h of hands) {
      let t = this.tracks.get(h.hand);
      if (!t) {
        t = {
          hand: h.hand,
          pinching: false,
          pending: 0,
          ratio: Infinity,
          fx: [0, 1, 2, 3].map(() => new OneEuro(this.o.minCutoff, this.o.beta)),
          tip: { x: 0, y: 0 },
          pinch: { x: 0, y: 0 },
          lastPinch: null,
          points: [],
          lastSeen: tMs,
        };
        this.tracks.set(h.hand, t);
      }
      const lm = h.landmarks;
      t.lastSeen = tMs;
      t.points = lm.map((p) => toNdc(p.x, p.y));
      const rawTip = t.points[TIP_INDEX];
      const thumb = t.points[TIP_THUMB];
      t.tip = { x: t.fx[0].filter(rawTip.x, tMs), y: t.fx[1].filter(rawTip.y, tMs) };
      t.pinch = {
        x: t.fx[2].filter((rawTip.x + thumb.x) / 2, tMs),
        y: t.fx[3].filter((rawTip.y + thumb.y) / 2, tMs),
      };
      t.ratio = pinchRatio(lm, aspect);

      const wantFlip = t.pinching ? t.ratio > exit : t.ratio < enter;
      t.pending = wantFlip ? t.pending + 1 : 0;
      if (t.pending >= debounce) {
        t.pending = 0;
        t.pinching = !t.pinching;
        if (t.pinching) {
          t.lastPinch = { ...t.pinch };
          out.push({ type: 'pinchstart', hand: t.hand, x: t.pinch.x, y: t.pinch.y });
        } else {
          out.push({ type: 'pinchend', hand: t.hand, x: t.pinch.x, y: t.pinch.y });
          t.lastPinch = null;
        }
      }
    }

    // Hands that dropped out: end their pinch after a short grace period.
    for (const [name, t] of this.tracks) {
      if (tMs - t.lastSeen > this.o.dropMs) {
        if (t.pinching) out.push({ type: 'pinchend', hand: name, x: t.pinch.x, y: t.pinch.y });
        this.tracks.delete(name);
      }
    }

    const visible = [...this.tracks.values()].filter((t) => t.lastSeen === tMs);
    const pinching = [...this.tracks.values()].filter((t) => t.pinching);

    if (pinching.length === 2) {
      const [a, b] = pinching;
      const spread = Math.hypot(a.pinch.x - b.pinch.x, a.pinch.y - b.pinch.y);
      const delta = this.prevSpread === null ? 0 : spread - this.prevSpread;
      this.prevSpread = spread;
      out.push({ type: 'twohand', spread, delta });
      for (const t of pinching) t.lastPinch = { ...t.pinch };
    } else {
      this.prevSpread = null;
      for (const t of visible) {
        if (t.pinching && t.lastPinch) {
          const dx = t.pinch.x - t.lastPinch.x;
          const dy = t.pinch.y - t.lastPinch.y;
          t.lastPinch = { ...t.pinch };
          out.push({ type: 'pinchmove', hand: t.hand, x: t.pinch.x, y: t.pinch.y, dx, dy });
        }
      }
    }
    for (const t of visible) {
      if (!t.pinching) out.push({ type: 'point', hand: t.hand, x: t.tip.x, y: t.tip.y });
    }

    if (hands.length > 0) {
      this.lastAnyHand = tMs;
      this.lostSent = false;
    } else if (!this.lostSent && this.lastAnyHand !== null && tMs - this.lastAnyHand >= this.o.lostMs) {
      this.lostSent = true;
      out.push({ type: 'lost' });
    }
    return out;
  }
}
