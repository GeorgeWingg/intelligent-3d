// Spatial windows: real DOM panels placed in the 3D world with CSS3DRenderer, sharing the scene camera.
// The chat lives in one; model panels spawn out of it as further windows. Each window has a grab bar.
import * as THREE from 'three';
import { CSS3DObject, CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';
import type { SceneApiExt } from '../scene';
import './windows.css';

const PX = 0.001; // 1 CSS px = 1 mm in the world

export interface WindowOpts {
  id: string;
  position: THREE.Vector3;
  yaw?: number; // radians, turn toward the viewer
  width: number; // CSS px
  height?: number; // CSS px; omitted = fit content
  from?: THREE.Vector3; // spawn origin, animates out from here
  className?: string;
}

interface Win {
  obj: CSS3DObject;
  frame: HTMLElement;
  target: THREE.Vector3;
  spawn: number; // 0..1 spawn progress
  from: THREE.Vector3;
}

export interface Windows {
  add(content: HTMLElement, opts: WindowOpts): HTMLElement;
  has(id: string): boolean;
  remove(id: string): void;
  position(id: string): THREE.Vector3 | null;
  // Hand input: returns true when the pinch landed on a window (grab bar drags, anything else clicks).
  pinchStart(ndcX: number, ndcY: number): boolean;
  pinchMove(dx: number, dy: number): void;
  pinchEnd(): void;
  hoverAt(ndcX: number | null, ndcY?: number): void;
}

export function createWindows(stage: HTMLElement, scene: SceneApiExt): Windows {
  const css = new CSS3DRenderer();
  css.domElement.className = 'xr-layer';
  stage.appendChild(css.domElement);
  const world = new THREE.Scene();
  const wins = new Map<string, Win>();

  const resize = () => css.setSize(stage.clientWidth, stage.clientHeight);
  new ResizeObserver(resize).observe(stage);
  resize();

  // Gentle head-motion parallax from the pointer or the hand, so depth reads in a flat recording.
  const look = { x: 0, y: 0, tx: 0, ty: 0 };
  const sway = new URLSearchParams(location.search).has('sway');
  if (sway) window.addEventListener('pointermove', e => {
    look.tx = (e.clientX / innerWidth) * 2 - 1;
    look.ty = (e.clientY / innerHeight) * 2 - 1;
  });

  const ease = (t: number) => 1 - Math.pow(1 - t, 3);
  scene.attach(new THREE.Object3D(), dt => {
    look.x += (look.tx - look.x) * Math.min(1, dt * 3);
    look.y += (look.ty - look.y) * Math.min(1, dt * 3);
    const cam = scene.camera;
    cam.position.copy(scene.home.position).add(new THREE.Vector3(look.x * 0.18, -look.y * 0.08, 0));
    cam.lookAt(scene.home.target);
    for (const w of wins.values()) {
      if (w.spawn < 1) {
        w.spawn = Math.min(1, w.spawn + dt / 0.65);
        const k = ease(w.spawn);
        w.obj.position.lerpVectors(w.from, w.target, k);
        w.obj.scale.setScalar(PX * (0.25 + 0.75 * k));
        w.frame.style.opacity = String(Math.min(1, k * 1.6));
      } else {
        w.obj.position.lerp(w.target, Math.min(1, dt * 12));
      }
    }
    css.render(world, cam);
  });

  function add(content: HTMLElement, o: WindowOpts): HTMLElement {
    remove(o.id);
    const frame = document.createElement('div');
    frame.className = `xr-window ${o.className ?? ''}`;
    frame.style.width = `${o.width}px`;
    if (o.height) frame.style.height = `${o.height}px`;
    const body = document.createElement('div');
    body.className = 'xr-window-body';
    body.appendChild(content);
    const bar = document.createElement('div');
    bar.className = 'xr-grab';
    bar.dataset.win = o.id;
    frame.append(body, bar);
    const obj = new CSS3DObject(frame);
    obj.rotation.y = o.yaw ?? 0;
    const from = (o.from ?? o.position).clone();
    obj.position.copy(from);
    obj.scale.setScalar(PX * (o.from ? 0.25 : 1));
    world.add(obj);
    const w: Win = { obj, frame, target: o.position.clone(), spawn: o.from ? 0 : 1, from };
    if (!o.from) frame.style.opacity = '1';
    wins.set(o.id, w);
    attachMouseDrag(bar, w);
    return frame;
  }

  function attachMouseDrag(bar: HTMLElement, w: Win) {
    bar.addEventListener('pointerdown', e => {
      e.preventDefault();
      bar.setPointerCapture(e.pointerId);
      let lx = e.clientX, ly = e.clientY;
      bar.classList.add('active');
      const move = (ev: PointerEvent) => {
        dragBy(w, (ev.clientX - lx) / innerWidth * 2, -(ev.clientY - ly) / innerHeight * 2);
        lx = ev.clientX; ly = ev.clientY;
      };
      const up = () => { bar.classList.remove('active'); bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up);
    });
  }

  // NDC delta -> metres at the window's distance, moved in the window's own plane.
  function dragBy(w: Win, dx: number, dy: number) {
    const cam = scene.camera;
    const dist = cam.position.distanceTo(w.target);
    const h = 2 * dist * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const right = new THREE.Vector3(Math.cos(w.obj.rotation.y), 0, -Math.sin(w.obj.rotation.y));
    w.target.addScaledVector(right, dx * h * cam.aspect / 2);
    w.target.y += dy * h / 2;
  }

  function remove(id: string) {
    const w = wins.get(id);
    if (!w) return;
    world.remove(w.obj);
    w.frame.remove();
    wins.delete(id);
  }

  const toClient = (x: number, y: number) => {
    const r = stage.getBoundingClientRect();
    return { cx: r.left + (x + 1) / 2 * r.width, cy: r.top + (1 - y) / 2 * r.height };
  };
  let dragging: Win | null = null;
  let hovered: Element | null = null;

  return {
    add,
    has: id => wins.has(id),
    remove,
    position: id => wins.get(id)?.target.clone() ?? null,
    pinchStart(x, y) {
      const { cx, cy } = toClient(x, y);
      const el = document.elementFromPoint(cx, cy);
      const frame = el?.closest('.xr-window');
      if (!el || !frame) return false;
      const bar = el.closest('.xr-grab') as HTMLElement | null;
      if (bar?.dataset.win) {
        dragging = wins.get(bar.dataset.win) ?? null;
        bar.classList.add('active');
      } else {
        (el.closest('button, a, [role="button"], textarea, input') as HTMLElement | null)?.click();
      }
      return true;
    },
    pinchMove(dx, dy) { if (dragging) dragBy(dragging, dx, dy); },
    pinchEnd() {
      dragging?.frame.querySelector('.xr-grab')?.classList.remove('active');
      dragging = null;
    },
    hoverAt(x, y) {
      hovered?.classList.remove('xr-hover');
      hovered = null;
      if (x === null || y === undefined) return;
      const { cx, cy } = toClient(x, y);
      const el = document.elementFromPoint(cx, cy)?.closest('.xr-grab, button');
      if (el) { el.classList.add('xr-hover'); hovered = el; }
      if (sway) { look.tx = x * 0.6; look.ty = -y * 0.4; }
    },
  };
}
