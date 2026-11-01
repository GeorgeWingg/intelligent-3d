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
  arc: { a: number; r: number; y: number }; // angle around the eye (0 = straight ahead, + = right), radius, height
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

  // Windows live on a cylinder around the viewer's eye and always turn to face it, like headset panels.
  const eye = () => scene.home.position;
  const toArc = (p: THREE.Vector3) => {
    const dx = p.x - eye().x, dz = eye().z - p.z;
    return { a: Math.atan2(dx, dz), r: Math.max(0.6, Math.hypot(dx, dz)), y: p.y };
  };
  const fromArc = (arc: Win['arc'], out = new THREE.Vector3()) =>
    out.set(eye().x + arc.r * Math.sin(arc.a), arc.y, eye().z - arc.r * Math.cos(arc.a));

  const resize = () => css.setSize(stage.clientWidth, stage.clientHeight);
  new ResizeObserver(resize).observe(stage);
  resize();

  // Gentle head-motion parallax from the pointer or the hand, so depth reads in a flat recording.
  const look = { x: 0, y: 0, tx: 0, ty: 0 };
  const home = scene.home.position.clone();
  const dir = scene.home.target.clone().sub(home);
  const yaw0 = Math.atan2(-dir.x, -dir.z);
  const pitch0 = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
  const walk = { pos: home.clone(), cur: home.clone(), yaw: yaw0, pitch: pitch0, curYaw: yaw0, curPitch: pitch0 };
  const keys = new Set<string>();
  const typing = () => { const a = document.activeElement; return !!a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT'); };
  window.addEventListener('keydown', e => {
    if (typing()) return;
    if (e.key === 'r' || e.key === 'R') { walk.pos.copy(home); walk.yaw = yaw0; walk.pitch = pitch0; return; }
    keys.add(e.key.toLowerCase());
    if (e.shiftKey) keys.add('shift');
  });
  window.addEventListener('keyup', e => { keys.delete(e.key.toLowerCase()); if (!e.shiftKey) keys.delete('shift'); });
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('contextmenu', e => { if ((e.target as Element).closest?.('#stage')) e.preventDefault(); });
  let lookDrag: { x: number; y: number } | null = null;
  window.addEventListener('pointerdown', e => {
    if ((e.button === 2 || e.altKey) && !(e.target as Element).closest?.('.xr-window')) { lookDrag = { x: e.clientX, y: e.clientY }; e.preventDefault(); }
  }, true);
  window.addEventListener('pointermove', e => {
    if (!lookDrag) return;
    walk.yaw -= (e.clientX - lookDrag.x) * 0.004;
    walk.pitch = THREE.MathUtils.clamp(walk.pitch - (e.clientY - lookDrag.y) * 0.004, -1.2, 1.2);
    lookDrag = { x: e.clientX, y: e.clientY };
  }, true);
  window.addEventListener('pointerup', () => { lookDrag = null; }, true);
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
    // First-person walk: W/A/S/D (or arrows) move, Q/E down/up, right-drag or Alt-drag looks around.
    const sp = (keys.has('shift') ? 2.2 : 1.1) * dt;
    const fwd = new THREE.Vector3(-Math.sin(walk.yaw), 0, -Math.cos(walk.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    if (keys.has('w') || keys.has('arrowup')) walk.pos.addScaledVector(fwd, sp);
    if (keys.has('s') || keys.has('arrowdown')) walk.pos.addScaledVector(fwd, -sp);
    if (keys.has('d') || keys.has('arrowright')) walk.pos.addScaledVector(right, sp);
    if (keys.has('a') || keys.has('arrowleft')) walk.pos.addScaledVector(right, -sp);
    if (keys.has('e')) walk.pos.y += sp * 0.6;
    if (keys.has('q')) walk.pos.y -= sp * 0.6;
    walk.cur.lerp(walk.pos, Math.min(1, dt * 10));
    walk.curYaw += (walk.yaw - walk.curYaw) * Math.min(1, dt * 12);
    walk.curPitch += (walk.pitch - walk.curPitch) * Math.min(1, dt * 12);
    cam.position.copy(walk.cur).add(new THREE.Vector3(look.x * 0.18, -look.y * 0.08, 0));
    cam.rotation.set(walk.curPitch, walk.curYaw, 0, 'YXZ');
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
      w.obj.rotation.y += (-w.arc.a - w.obj.rotation.y) * Math.min(1, dt * 12);
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
    const arc = toArc(o.position);
    obj.rotation.y = -arc.a;
    const from = (o.from ?? o.position).clone();
    obj.position.copy(from);
    obj.scale.setScalar(PX * (o.from ? 0.25 : 1));
    world.add(obj);
    const w: Win = { obj, frame, target: fromArc(arc), arc, spawn: o.from ? 0 : 1, from };
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

  // NDC delta -> slide along the arc (horizontal) and up/down (vertical), keeping distance to the eye.
  function dragBy(w: Win, dx: number, dy: number) {
    const cam = scene.camera;
    const vfov = THREE.MathUtils.degToRad(cam.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * cam.aspect);
    w.arc.a = THREE.MathUtils.clamp(w.arc.a + dx * hfov / 2, -1.4, 1.4);
    w.arc.y += dy * Math.tan(vfov / 2) * w.arc.r;
    fromArc(w.arc, w.target);
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
  let pulling: { el: HTMLElement; dx: number; dy: number } | null = null;
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
      const flat = el.closest('.flat-card') as HTMLElement | null;
      if (flat) {
        pulling = { el: flat, dx: 0, dy: 0 };
      } else if (bar?.dataset.win) {
        dragging = wins.get(bar.dataset.win) ?? null;
        bar.classList.add('active');
      } else {
        (el.closest('button, a, [role="button"], textarea, input') as HTMLElement | null)?.click();
      }
      return true;
    },
    pinchMove(dx, dy) {
      if (pulling) {
        // Net displacement, not path length, so hand jitter while pinching never counts as a pull.
        pulling.dx += dx; pulling.dy += dy;
        if (Math.hypot(pulling.dx, pulling.dy) > 0.22) { pulling.el.dispatchEvent(new Event('flat-pull')); pulling = null; }
        return;
      }
      if (dragging) dragBy(dragging, dx, dy);
    },
    pinchEnd() {
      pulling = null;
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
