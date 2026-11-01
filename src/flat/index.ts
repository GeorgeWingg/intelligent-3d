// The flat form of a streamed assembly: an orthographic side drawing plus system tabs, shown inside the chat.
// Same SpecLines as the 3D scene, drawn in 2D — "one answer, two forms".
import type { SpecLine, SystemSpec, Vec3 } from '../contract';
import './flat.css';

const SVG = 'http://www.w3.org/2000/svg';

export interface FlatCard {
  el: HTMLElement;
  apply(line: SpecLine): void;
  setPulled(on: boolean): void;
  onPull(cb: () => void): void;
}

export function createFlatCard(): FlatCard {
  const el = document.createElement('div');
  el.className = 'flat-card';
  const title = document.createElement('div');
  title.className = 'flat-title';
  const tabs = document.createElement('div');
  tabs.className = 'flat-tabs';
  const svg = document.createElementNS(SVG, 'svg');
  svg.classList.add('flat-svg');
  const hint = document.createElement('div');
  hint.className = 'flat-hint';
  hint.textContent = 'Pinch or drag to pull it into the room';
  el.append(title, tabs, svg, hint);

  const systems = new Map<string, SystemSpec>();
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  const pulls: (() => void)[] = [];
  let pulled = false;

  const grow = (p: Vec3, r = 0) => {
    bounds.minX = Math.min(bounds.minX, p[0] - r); bounds.maxX = Math.max(bounds.maxX, p[0] + r);
    bounds.minY = Math.min(bounds.minY, p[1] - r); bounds.maxY = Math.max(bounds.maxY, p[1] + r);
    const pad = 0.04;
    const w = bounds.maxX - bounds.minX + pad * 2, h = bounds.maxY - bounds.minY + pad * 2;
    // y is flipped: SVG y grows downward.
    svg.setAttribute('viewBox', `${bounds.minX - pad} ${-(bounds.maxY + pad)} ${w} ${h}`);
  };

  const node = (tag: string, attrs: Record<string, string | number>, color: string) => {
    const n = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    n.setAttribute('stroke', color);
    n.setAttribute('fill', 'none');
    n.setAttribute('stroke-linecap', 'round');
    n.classList.add('flat-in');
    svg.appendChild(n);
  };

  function apply(line: SpecLine) {
    if (line.t === 'assembly') {
      title.textContent = line.title;
      for (const s of line.systems) {
        systems.set(s.id, s);
        const tab = document.createElement('span');
        tab.className = 'flat-tab';
        tab.textContent = s.label;
        tab.style.setProperty('--c', s.color ?? '#8f8f8f');
        tabs.appendChild(tab);
      }
      return;
    }
    if (line.t !== 'part') return;
    const color = line.color ?? systems.get(line.system)?.color ?? '#9aa1a8';
    for (const s of line.shapes ?? []) {
      switch (s.kind) {
        case 'tube': {
          const w = Math.max(0.006, s.radius * 2);
          node('line', { x1: s.from[0], y1: -s.from[1], x2: s.to[0], y2: -s.to[1], 'stroke-width': w }, color);
          grow(s.from, w); grow(s.to, w);
          break;
        }
        case 'torus':
          node('circle', { cx: s.position[0], cy: -s.position[1], r: s.radius, 'stroke-width': Math.max(0.006, s.tube * 2) }, color);
          grow(s.position, s.radius + s.tube);
          break;
        case 'cylinder':
          node('circle', { cx: s.position[0], cy: -s.position[1], r: Math.max(s.radius, 0.008), 'stroke-width': 0.006 }, color);
          grow(s.position, s.radius);
          break;
        case 'sphere':
          node('circle', { cx: s.position[0], cy: -s.position[1], r: s.radius, 'stroke-width': 0.006 }, color);
          grow(s.position, s.radius);
          break;
        case 'box':
          node('rect', { x: s.position[0] - s.size[0] / 2, y: -s.position[1] - s.size[1] / 2, width: s.size[0], height: s.size[1], rx: 0.004, 'stroke-width': 0.006 }, color);
          grow(s.position, Math.max(s.size[0], s.size[1]) / 2);
          break;
      }
    }
  }

  // Only a drag pulls it out (mouse drag, or a pinch-and-pull with hands); a plain click does nothing.
  let down: { x: number; y: number } | null = null;
  const fire = () => { if (!pulled) pulls.forEach(cb => cb()); };
  el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
  el.addEventListener('pointermove', e => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 120) { down = null; fire(); }
  });
  el.addEventListener('pointerup', () => { down = null; });
  el.addEventListener('flat-pull', fire); // a pinch that drags out of the window (see windows.pinchMove)

  return {
    el,
    apply,
    setPulled(on) {
      pulled = on;
      el.classList.toggle('is-pulled', on);
      hint.textContent = on ? 'In the room' : 'Pinch or drag to pull it into the room';
    },
    onPull: cb => { pulls.push(cb); },
  };
}
