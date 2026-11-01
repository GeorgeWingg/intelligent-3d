// Light hand visual drawn over the camera feed: faint skeleton, cream fingertip dots,
// and a ring cursor at the index tip that fills tan while pinching.
import type { HandView } from './gestures';

const CREAM = '233, 222, 196'; // #e9dec4
const TAN = '212, 191, 152'; // #d4bf98

const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];
const TIPS = [4, 8, 12, 16, 20];

export class HandOverlay {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private fill = new Map<string, number>(); // eased 0..1 pinch fill per hand
  private w = 0;
  private h = 0;
  private dpr = 1;

  constructor(private host: HTMLElement) {
    const c = document.createElement('canvas');
    c.className = 'hands-overlay';
    Object.assign(c.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '5',
    } satisfies Partial<CSSStyleDeclaration>);
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(c);
    this.canvas = c;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('2d canvas unavailable');
    this.ctx = ctx;
  }

  get size(): { w: number; h: number } {
    const r = this.host.getBoundingClientRect();
    return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
  }

  private resize(): void {
    const { w, h } = this.size;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (w !== this.w || h !== this.h || dpr !== this.dpr) {
      this.w = w;
      this.h = h;
      this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
  }

  draw(hands: HandView[]): void {
    this.resize();
    const { ctx, w, h, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const px = (p: { x: number; y: number }) => [((p.x + 1) / 2) * w, ((1 - p.y) / 2) * h] as const;
    const seen = new Set<string>();

    for (const hand of hands) {
      seen.add(hand.hand);
      if (hand.points.length < 21) continue;
      const pts = hand.points.map(px);

      ctx.lineWidth = 1;
      ctx.lineCap = 'round';
      ctx.strokeStyle = `rgba(${CREAM}, 0.28)`;
      ctx.beginPath();
      for (const [a, b] of BONES) {
        ctx.moveTo(pts[a][0], pts[a][1]);
        ctx.lineTo(pts[b][0], pts[b][1]);
      }
      ctx.stroke();

      ctx.fillStyle = `rgba(${CREAM}, 0.9)`;
      for (const i of TIPS) {
        ctx.beginPath();
        ctx.arc(pts[i][0], pts[i][1], 2.6, 0, Math.PI * 2);
        ctx.fill();
      }

      const prev = this.fill.get(hand.hand) ?? 0;
      const f = prev + ((hand.pinching ? 1 : 0) - prev) * 0.35;
      this.fill.set(hand.hand, f);
      const [cx, cy] = px(hand.pinching ? hand.pinchPoint : hand.tip);
      const r = 13 - 3 * f;
      if (f > 0.02) {
        ctx.fillStyle = `rgba(${TAN}, ${0.55 * f})`;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = `rgba(${f > 0.5 ? TAN : CREAM}, 0.85)`;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const k of [...this.fill.keys()]) if (!seen.has(k)) this.fill.delete(k);
  }

  clear(): void {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  destroy(): void {
    this.canvas.remove();
  }
}
