// Intelligent 3D scene + streaming compiler.
// apply(line) renders each SpecLine the moment it arrives, so objects assemble part by part.
import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Action, PickResult, SceneApi, Shape, SpecLine, SystemSpec, Vec3 } from '../contract';
import { coverRepeat } from '../coords';

export interface SceneOptions {
  video?: HTMLVideoElement;
  mirror?: boolean;
}

// SceneApi plus two extras the integration can use with hand tracking.
export interface SceneApiExt extends SceneApi {
  // Press a spatial button under an NDC point (pinch on a pill). Returns true if one was pressed.
  press(ndcX: number, ndcY: number): boolean;
  // Add a world-space object (e.g. the voice orb) with an optional per-frame tick.
  attach(object: THREE.Object3D, tick?: (dt: number) => void): void;
  readonly camera: THREE.PerspectiveCamera;
  // Hide the object (it lives flat in the chat), or fly it out from a world point into the room.
  setPresent(on: boolean, from?: THREE.Vector3): void;
  readonly home: { position: THREE.Vector3; target: THREE.Vector3 };
  dispose(): void;
}

const BG = '#111111';
const TAN = new THREE.Color('#ef8b57');
const PALETTE = ['#ef8b57', '#6fa8dc', '#8fc27f', '#b48ce6', '#e3c45a', '#7f8a96'];
const STAGE_POS = new THREE.Vector3(0, 0.95, 0);
const CAM_POS = new THREE.Vector3(0, 1.3, 2.3);
const LOOK_AT = new THREE.Vector3(0, 1.08, 0);
const DEFAULT_YAW = -0.32;
const DEFAULT_PITCH = 0.06;
const APPEAR_MS = 350;

interface PartRec {
  id: string;
  label: string;
  systemId: string;
  mesh: THREE.Mesh;
  material: THREE.MeshPhysicalMaterial;
  born: number;
}

interface SystemRec {
  spec: SystemSpec;
  index: number;
  group: THREE.Group;
  parts: PartRec[];
  dim: number; // current opacity multiplier
  hover: number;
  focus: number;
  lift: number;
  bbox: THREE.Box3; // in system-group local space (assembled)
  bboxDirty: boolean;
}

interface AssemblyRec {
  id: string;
  title: string;
  root: THREE.Group;
  systems: Map<string, SystemRec>;
  parts: Map<string, PartRec>;
}

interface AnchoredObj {
  id: string;
  obj: CSS2DObject;
  el: HTMLElement;
  anchor?: string;
  position?: Vec3;
  kind: 'panel' | 'controls' | 'focus';
  title?: string;
}

function injectStyle() {
  if (document.getElementById('i3d-scene-style')) return;
  const s = document.createElement('style');
  s.id = 'i3d-scene-style';
  s.textContent = `
.i3d-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.i3d-panel{pointer-events:auto;box-sizing:border-box;max-width:280px;min-width:180px;padding:12px 14px 13px;
  background:rgba(33,33,33,.92);color:#ececec;border:1px solid #3a3a3a;border-radius:14px;
  -webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,"Segoe UI",sans-serif;
  box-shadow:0 10px 30px rgba(0,0,0,.35);transition:opacity .25s ease;animation:i3d-in .35s ease both}
.i3d-panel h3{margin:0 0 4px;font-weight:600;font-size:15px;line-height:1.2;letter-spacing:0}
.i3d-panel p{margin:0;font-size:14px;line-height:1.42;color:#8f8f8f}
.i3d-panel.i3d-focus{border-color:#5a5a5a}
.i3d-controls{pointer-events:auto;display:flex;flex-wrap:wrap;justify-content:center;gap:6px;max-width:440px;
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,"Segoe UI",sans-serif;animation:i3d-in .35s ease both}
.i3d-pill{pointer-events:auto;cursor:pointer;font:inherit;font-size:14px;line-height:1;padding:9px 13px;border-radius:999px;
  color:#ececec;background:rgba(33,33,33,.92);border:1px solid #3a3a3a;
  -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);transition:background .15s,border-color .15s,color .15s}
.i3d-pill:hover,.i3d-pill.i3d-hot{background:#2f2f2f;border-color:#5a5a5a}
.i3d-pill.i3d-on{background:#3a3a3a;color:#ececec;border-color:#5a5a5a}
@keyframes i3d-in{from{opacity:0;transform:translateY(6px)}to{opacity:1}}
`;
  document.head.appendChild(s);
}

function v3(a: Vec3 | undefined, fallback: Vec3 = [0, 0, 0]): THREE.Vector3 {
  const p = Array.isArray(a) && a.length === 3 ? a : fallback;
  return new THREE.Vector3(Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0);
}

function num(x: unknown, d: number): number {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : d;
}

// Build one geometry (in assembly space) from a list of shapes.
function shapeGeometry(shape: Shape): THREE.BufferGeometry | null {
  const up = new THREE.Vector3(0, 1, 0);
  switch (shape.kind) {
    case 'tube': {
      const a = v3(shape.from);
      const b = v3(shape.to);
      const len = a.distanceTo(b);
      if (len < 1e-5) return null;
      const r = num(shape.radius, 0.01);
      const g = new THREE.CylinderGeometry(r, r, len, r < 0.004 ? 6 : 14, 1, false);
      const q = new THREE.Quaternion().setFromUnitVectors(up, b.clone().sub(a).normalize());
      g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
      return g;
    }
    case 'cylinder': {
      const r = num(shape.radius, 0.02);
      const g = new THREE.CylinderGeometry(r, r, num(shape.length, 0.05), 28, 1, false);
      const e = v3(shape.rotation);
      g.applyMatrix4(
        new THREE.Matrix4().compose(v3(shape.position), new THREE.Quaternion().setFromEuler(new THREE.Euler(e.x, e.y, e.z)), new THREE.Vector3(1, 1, 1)),
      );
      return g;
    }
    case 'torus': {
      const R = num(shape.radius, 0.1);
      const t = num(shape.tube, 0.01);
      const g = new THREE.TorusGeometry(R, t, t < 0.006 ? 8 : 14, R > 0.2 ? 96 : 48);
      const e = v3(shape.rotation);
      g.applyMatrix4(
        new THREE.Matrix4().compose(v3(shape.position), new THREE.Quaternion().setFromEuler(new THREE.Euler(e.x, e.y, e.z)), new THREE.Vector3(1, 1, 1)),
      );
      return g;
    }
    case 'box': {
      const s = v3(shape.size, [0.05, 0.05, 0.05]);
      const g = new THREE.BoxGeometry(Math.max(s.x, 1e-4), Math.max(s.y, 1e-4), Math.max(s.z, 1e-4));
      const e = v3(shape.rotation);
      g.applyMatrix4(
        new THREE.Matrix4().compose(v3(shape.position), new THREE.Quaternion().setFromEuler(new THREE.Euler(e.x, e.y, e.z)), new THREE.Vector3(1, 1, 1)),
      );
      return g;
    }
    case 'sphere': {
      const g = new THREE.SphereGeometry(num(shape.radius, 0.03), 24, 16);
      g.applyMatrix4(new THREE.Matrix4().makeTranslation(v3(shape.position)));
      return g;
    }
    default:
      return null;
  }
}

function makeMaterial(hex: string): THREE.MeshPhysicalMaterial {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  const metallic = hsl.s < 0.12 && hsl.l > 0.45; // greys and silvers read as metal
  return new THREE.MeshPhysicalMaterial({
    color: c,
    roughness: metallic ? 0.28 : 0.4,
    metalness: metallic ? 0.75 : 0.08,
    clearcoat: metallic ? 0 : 0.55,
    clearcoatRoughness: 0.28,
    transparent: true,
    opacity: 0,
  });
}

function shadowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(0.5, 'rgba(0,0,0,0.22)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function createScene(container: HTMLElement, opts: SceneOptions = {}): SceneApiExt {
  injectStyle();
  const mirror = opts.mirror ?? true;
  const video = opts.video;
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';

  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.touchAction = 'none';
  container.appendChild(renderer.domElement);

  const css = new CSS2DRenderer();
  css.domElement.className = 'i3d-layer';
  container.appendChild(css.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 50);
  camera.position.copy(CAM_POS);
  camera.lookAt(LOOK_AT);

  // Lights: soft hemisphere, warm key, cool rim.
  scene.add(new THREE.HemisphereLight(0xf3ead2, 0x2a2818, 0.85));
  const key = new THREE.DirectionalLight(0xfff1dc, 2.1);
  key.position.set(1.8, 3.2, 2.6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xc6e3ef, 1.5);
  rim.position.set(-2.6, 2.2, -2.4);
  scene.add(rim);

  // Background: camera feed (cover + mirror, matching coords.ts) or dark olive with a faint grid.
  let videoTex: THREE.VideoTexture | null = null;
  const grid = new THREE.GridHelper(14, 56, 0x3a3826, 0x24241a);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.4;
  grid.position.y = STAGE_POS.y - 0.36;
  if (video) {
    videoTex = new THREE.VideoTexture(video);
    videoTex.colorSpace = THREE.SRGBColorSpace;
    videoTex.minFilter = THREE.LinearFilter;
    videoTex.magFilter = THREE.LinearFilter;
    scene.background = videoTex;
  } else {
    scene.background = new THREE.Color(BG);
    scene.fog = new THREE.Fog(BG, 3.2, 9);
    scene.add(grid);
  }

  // Stage -> turntable (user rotation/scale) -> assembly root -> system groups -> part meshes.
  const stage = new THREE.Group();
  stage.position.copy(STAGE_POS);
  scene.add(stage);
  const turntable = new THREE.Group();
  stage.add(turntable);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0, toneMapped: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = -1;
  turntable.add(shadow);

  const freeAnchor = new THREE.Group(); // panels/controls placed by position with no assembly
  turntable.add(freeAnchor);

  let assembly: AssemblyRec | null = null;
  const overlays = new Map<string, AnchoredObj>();
  let focusPanel: AnchoredObj | null = null;

  // Interaction state (targets + smoothed values)
  const st = {
    yaw: DEFAULT_YAW, yawT: DEFAULT_YAW,
    pitch: DEFAULT_PITCH, pitchT: DEFAULT_PITCH,
    scale: 1, scaleT: 1,
    explode: 0, explodeT: 0,
    focused: null as string | null,
    hovered: null as string | null,
  };

  // ---------- sizing / cover ----------
  let viewW = 1;
  let viewH = 1;
  function updateCover() {
    if (!videoTex || !video) return;
    const vw = video.videoWidth || 16;
    const vh = video.videoHeight || 9;
    const { rx, ry } = coverRepeat({ videoW: vw, videoH: vh, viewW, viewH, mirror });
    // uv' = uv * repeat + offset. Mirror flips x so screen-left shows the video's right side,
    // identical to videoToNdc's uu = 1 - u. flipY is on, so v=0 (image top) is texture-y 1.
    if (mirror) {
      videoTex.repeat.set(-rx, ry);
      videoTex.offset.set((1 + rx) / 2, (1 - ry) / 2);
    } else {
      videoTex.repeat.set(rx, ry);
      videoTex.offset.set((1 - rx) / 2, (1 - ry) / 2);
    }
    videoTex.center.set(0, 0);
    videoTex.rotation = 0;
  }
  function resize() {
    viewW = Math.max(1, container.clientWidth);
    viewH = Math.max(1, container.clientHeight);
    renderer.setSize(viewW, viewH, false);
    css.setSize(viewW, viewH);
    const aspect = viewW / viewH;
    camera.aspect = aspect;
    // Keep ~2.6 m of horizontal room at the object so a bike fits on phones too.
    const vfov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(35)) / aspect));
    camera.fov = THREE.MathUtils.clamp(vfov, 40, 78);
    camera.updateProjectionMatrix();
    updateCover();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  window.addEventListener('resize', resize);
  if (video) {
    video.addEventListener('loadedmetadata', updateCover);
    video.addEventListener('resize', updateCover);
  }
  resize();

  // ---------- assembly building ----------
  function disposeAssembly() {
    if (!assembly) return;
    for (const p of assembly.parts.values()) {
      p.mesh.geometry.dispose();
      p.material.dispose();
    }
    turntable.remove(assembly.root);
    assembly = null;
  }
  function removeOverlay(o: AnchoredObj) {
    o.obj.parent?.remove(o.obj);
    o.el.remove();
  }
  function clearOverlays() {
    for (const o of overlays.values()) removeOverlay(o);
    overlays.clear();
    if (focusPanel) removeOverlay(focusPanel);
    focusPanel = null;
  }

  function addSystem(a: AssemblyRec, spec: SystemSpec): SystemRec {
    const existing = a.systems.get(spec.id);
    if (existing) {
      existing.spec = { ...existing.spec, ...spec };
      return existing;
    }
    const group = new THREE.Group();
    group.name = 'system:' + spec.id;
    a.root.add(group);
    const rec: SystemRec = {
      spec: { ...spec, explode: Array.isArray(spec.explode) ? spec.explode : [0, 0, 0] },
      index: a.systems.size,
      group, parts: [], dim: 1, hover: 0, focus: 0, lift: 0,
      bbox: new THREE.Box3(), bboxDirty: true,
    };
    a.systems.set(spec.id, rec);
    return rec;
  }

  function newAssembly(id: string, title: string, systems: SystemSpec[]) {
    disposeAssembly();
    clearOverlays();
    st.explode = st.explodeT = 0;
    st.focused = null;
    st.hovered = null;
    const root = new THREE.Group();
    root.name = 'assembly:' + id;
    turntable.add(root);
    assembly = { id, title, root, systems: new Map(), parts: new Map() };
    for (const s of systems || []) if (s && s.id) addSystem(assembly, s);
  }

  function addPart(line: Extract<SpecLine, { t: 'part' }>) {
    if (!assembly) newAssembly(line.assembly || 'object', line.assembly || 'Object', []);
    const a = assembly!;
    const sysId = line.system || 'main';
    const sys = a.systems.get(sysId) ?? addSystem(a, { id: sysId, label: sysId, summary: '', explode: [0, 0, 0] });
    const geoms: THREE.BufferGeometry[] = [];
    for (const s of line.shapes || []) {
      try {
        const g = shapeGeometry(s);
        if (g) geoms.push(g.index ? g : g);
      } catch {
        /* skip malformed shape */
      }
    }
    if (!geoms.length) return;
    const merged = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false);
    if (geoms.length > 1) geoms.forEach((g) => g.dispose());
    if (!merged) return;
    merged.computeBoundingBox();
    const c = new THREE.Vector3();
    merged.boundingBox!.getCenter(c);
    merged.translate(-c.x, -c.y, -c.z);
    merged.computeBoundingSphere();
    const color = line.color || sys.spec.color || PALETTE[sys.index % PALETTE.length];
    const material = makeMaterial(color);
    const mesh = new THREE.Mesh(merged, material);
    mesh.position.copy(c);
    mesh.scale.setScalar(0.82);
    mesh.userData = { partId: line.id, systemId: sysId, label: line.label };
    const prev = a.parts.get(line.id);
    if (prev) {
      prev.mesh.parent?.remove(prev.mesh);
      prev.mesh.geometry.dispose();
      prev.material.dispose();
      const ps = a.systems.get(prev.systemId);
      if (ps) ps.parts = ps.parts.filter((p) => p !== prev);
    }
    sys.group.add(mesh);
    const rec: PartRec = { id: line.id, label: line.label || line.id, systemId: sysId, mesh, material, born: performance.now() };
    a.parts.set(line.id, rec);
    sys.parts.push(rec);
    sys.bboxDirty = true;
  }

  function systemBox(sys: SystemRec): THREE.Box3 {
    if (sys.bboxDirty) {
      sys.bbox.makeEmpty();
      for (const p of sys.parts) {
        const bb = p.mesh.geometry.boundingBox;
        if (bb) sys.bbox.union(bb.clone().translate(p.mesh.position));
      }
      sys.bboxDirty = false;
    }
    return sys.bbox;
  }
  function assemblyBox(): THREE.Box3 {
    const b = new THREE.Box3();
    if (assembly) for (const s of assembly.systems.values()) if (s.parts.length) b.union(systemBox(s));
    return b;
  }

  // ---------- overlays ----------
  function placeOverlay(o: AnchoredObj) {
    const sys = o.anchor && assembly ? assembly.systems.get(o.anchor) : undefined;
    if (sys && sys.parts.length) {
      if (o.obj.parent !== sys.group) sys.group.add(o.obj);
      const b = systemBox(sys);
      if (o.kind === 'controls') {
        o.obj.position.set((b.min.x + b.max.x) / 2, b.min.y - 0.05, b.max.z);
        o.obj.center.set(0.5, 0);
      } else {
        // Beside the system, vertically centred on it; follows it when exploded or lifted.
        o.obj.position.set(b.max.x + 0.05, (b.min.y + b.max.y) / 2, b.max.z);
        o.obj.center.set(0, 0.5);
      }
      return;
    }
    const parent = assembly ? assembly.root : freeAnchor;
    if (o.obj.parent !== parent) parent.add(o.obj);
    if (o.position) {
      o.obj.position.copy(v3(o.position));
      o.obj.center.set(o.kind === 'controls' ? 0.5 : 0, o.kind === 'controls' ? 0 : 0.5);
      return;
    }
    const b = assemblyBox();
    if (b.isEmpty()) {
      o.obj.position.set(o.kind === 'controls' ? 0 : 0.6, o.kind === 'controls' ? -0.45 : 0.2, 0);
    } else if (o.kind === 'controls') {
      o.obj.position.set((b.min.x + b.max.x) / 2, b.min.y - 0.06, b.max.z);
      o.obj.center.set(0.5, 0);
    } else {
      o.obj.position.set(b.max.x + 0.06, b.max.y, 0);
      o.obj.center.set(0, 0.15);
    }
  }

  function addPanel(line: Extract<SpecLine, { t: 'panel' }>) {
    const old = overlays.get(line.id);
    if (old) removeOverlay(old);
    const root = el('div', 'i3d-panel');
    root.appendChild(el('h3', '', line.title || ''));
    if (line.body) root.appendChild(el('p', '', line.body));
    const obj = new CSS2DObject(root);
    const o: AnchoredObj = { id: line.id, obj, el: root, anchor: line.anchor, position: line.position, kind: 'panel', title: line.title };
    overlays.set(line.id, o);
    placeOverlay(o);
  }

  function addControls(line: Extract<SpecLine, { t: 'controls' }>) {
    const old = overlays.get(line.id);
    if (old) removeOverlay(old);
    const root = el('div', 'i3d-controls');
    for (const b of line.buttons || []) {
      if (!b || !b.action) continue;
      const btn = el('button', 'i3d-pill', b.label);
      btn.type = 'button';
      btn.dataset.action = JSON.stringify(b.action);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        runButton(b.action);
      });
      btn.addEventListener('pointerdown', (e) => e.stopPropagation());
      root.appendChild(btn);
    }
    const obj = new CSS2DObject(root);
    const o: AnchoredObj = { id: line.id, obj, el: root, anchor: line.anchor, kind: 'controls' };
    overlays.set(line.id, o);
    placeOverlay(o);
    refreshButtons();
  }

  function runButton(action: Action) {
    // A focus button for the already-focused system toggles it off.
    if (action.op === 'focus' && action.system && action.system === st.focused) act({ op: 'focus', system: null });
    else act(action);
  }

  function refreshButtons() {
    for (const o of overlays.values()) {
      if (o.kind !== 'controls') continue;
      o.el.querySelectorAll<HTMLButtonElement>('.i3d-pill').forEach((btn) => {
        let on = false;
        try {
          const a = JSON.parse(btn.dataset.action || '{}') as Action;
          if (a.op === 'focus') on = a.system !== null && a.system === st.focused;
          else if (a.op === 'explode') on = Math.abs(a.amount - st.explodeT) < 0.05 && !st.focused && (a.amount > 0 || st.explodeT === 0) && a.amount > 0;
        } catch {
          /* ignore */
        }
        btn.classList.toggle('i3d-on', on);
      });
    }
  }

  function showFocusPanel(sysId: string | null) {
    if (focusPanel) {
      removeOverlay(focusPanel);
      focusPanel = null;
    }
    if (!sysId || !assembly) return;
    const sys = assembly.systems.get(sysId);
    if (!sys) return;
    // If the model already anchored a panel to this system, that one is the focus card.
    for (const o of overlays.values()) if (o.kind === 'panel' && o.anchor === sysId) return;
    const root = el('div', 'i3d-panel i3d-focus');
    root.appendChild(el('h3', '', sys.spec.label || sysId));
    if (sys.spec.summary) root.appendChild(el('p', '', sys.spec.summary));
    const obj = new CSS2DObject(root);
    focusPanel = { id: 'focus:' + sysId, obj, el: root, anchor: sysId, kind: 'focus' };
    placeOverlay(focusPanel);
  }

  // ---------- actions ----------
  function act(action: Action) {
    if (!action || typeof action !== 'object') return;
    switch (action.op) {
      case 'explode':
        st.explodeT = THREE.MathUtils.clamp(Number(action.amount) || 0, 0, 1);
        if (st.explodeT === 0 && st.focused) {
          st.focused = null;
          showFocusPanel(null);
        }
        break;
      case 'focus': {
        const id = action.system && assembly?.systems.has(action.system) ? action.system : null;
        st.focused = id;
        showFocusPanel(id);
        break;
      }
      case 'rotate':
        st.yawT += Number(action.y) || 0;
        break;
      case 'reset':
        st.yawT = DEFAULT_YAW;
        st.pitchT = DEFAULT_PITCH;
        st.scaleT = 1;
        st.explodeT = 0;
        st.focused = null;
        showFocusPanel(null);
        break;
    }
    refreshButtons();
  }

  function clear() {
    disposeAssembly();
    clearOverlays();
    st.explode = st.explodeT = 0;
    st.focused = null;
    st.hovered = null;
    st.yawT = DEFAULT_YAW;
    st.pitchT = DEFAULT_PITCH;
    st.scaleT = 1;
  }

  function apply(line: SpecLine) {
    if (!line || typeof line !== 'object') return;
    try {
      switch (line.t) {
        case 'assembly':
          newAssembly(line.id || 'object', line.title || line.id || 'Object', line.systems || []);
          break;
        case 'part':
          addPart(line);
          break;
        case 'panel':
          addPanel(line);
          break;
        case 'controls':
          addControls(line);
          break;
        case 'action':
          act(line.action);
          break;
        case 'clear':
          clear();
          break;
        default:
          break; // 'say' / 'done' are for chat
      }
    } catch (err) {
      console.warn('[scene] could not apply line', line, err);
    }
  }

  // ---------- picking ----------
  const raycaster = new THREE.Raycaster();
  function pickMesh(ndcX: number, ndcY: number): THREE.Mesh | null {
    if (!assembly) return null;
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const meshes: THREE.Object3D[] = [];
    for (const p of assembly.parts.values()) meshes.push(p.mesh);
    const hits = raycaster.intersectObjects(meshes, false);
    return hits.length ? (hits[0].object as THREE.Mesh) : null;
  }
  function pick(ndcX: number, ndcY: number): PickResult | null {
    const m = pickMesh(ndcX, ndcY);
    if (!m) return null;
    const u = m.userData as { partId: string; systemId: string; label: string };
    return { partId: u.partId, systemId: u.systemId, label: u.label };
  }
  function ndcToClient(ndcX: number, ndcY: number) {
    const r = renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((ndcX + 1) / 2) * r.width, y: r.top + ((1 - ndcY) / 2) * r.height };
  }
  function buttonAt(ndcX: number, ndcY: number): HTMLButtonElement | null {
    const { x, y } = ndcToClient(ndcX, ndcY);
    const hit = document.elementFromPoint(x, y);
    const btn = hit instanceof Element ? hit.closest('.i3d-pill') : null;
    return btn instanceof HTMLButtonElement && css.domElement.contains(btn) ? btn : null;
  }
  let hotBtn: HTMLButtonElement | null = null;
  function hover(ndcX: number | null, ndcY?: number) {
    if (ndcX === null || ndcY === undefined) {
      st.hovered = null;
      hotBtn?.classList.remove('i3d-hot');
      hotBtn = null;
      return;
    }
    const b = buttonAt(ndcX, ndcY);
    if (b !== hotBtn) {
      hotBtn?.classList.remove('i3d-hot');
      b?.classList.add('i3d-hot');
      hotBtn = b;
    }
    const p = b ? null : pick(ndcX, ndcY);
    st.hovered = p ? p.systemId : null;
  }
  function press(ndcX: number, ndcY: number): boolean {
    const b = buttonAt(ndcX, ndcY);
    if (!b) return false;
    b.click();
    return true;
  }

  // ---------- gestures ----------
  function rotateBy(dx: number, dy: number) {
    st.yawT += dx;
    st.pitchT = THREE.MathUtils.clamp(st.pitchT + dy, -0.7, 0.9);
  }
  function explodeBy(delta: number) {
    st.explodeT = THREE.MathUtils.clamp(st.explodeT + delta, 0, 1);
    refreshButtons();
  }
  function scaleBy(ratio: number) {
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    st.scaleT = THREE.MathUtils.clamp(st.scaleT * ratio, 0.3, 3);
  }

  // Mouse fallback: drag rotates, wheel explodes, click focuses the system under the cursor.
  const canvas = renderer.domElement;
  let drag: { x: number; y: number; moved: number; id: number } | null = null;
  function ndcOf(e: PointerEvent | WheelEvent) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
  }
  const onDown = (e: PointerEvent) => {
    drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (drag && drag.id === e.pointerId) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (drag.moved > 4) rotateBy(dx * 0.008, dy * 0.005);
      return;
    }
    const n = ndcOf(e);
    const p = pick(n.x, n.y);
    st.hovered = p ? p.systemId : null;
    canvas.style.cursor = p ? 'pointer' : 'grab';
  };
  const onUp = (e: PointerEvent) => {
    if (!drag || drag.id !== e.pointerId) return;
    const wasClick = drag.moved <= 4;
    drag = null;
    if (wasClick) {
      const n = ndcOf(e);
      const p = pick(n.x, n.y);
      if (p) runButton({ op: 'focus', system: p.systemId });
      else if (st.focused) act({ op: 'focus', system: null });
    }
  };
  const onLeave = () => {
    if (!drag) st.hovered = null;
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    explodeBy(-e.deltaY * 0.0015);
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  // ---------- describe ----------
  function describe(): string {
    if (!assembly) {
      const pan = [...overlays.values()].filter((o) => o.kind === 'panel').map((o) => `"${o.title}"`);
      return 'Scene is empty.' + (pan.length ? ` Panels: ${pan.join(', ')}.` : '');
    }
    const a = assembly;
    const systems = [...a.systems.values()].map((s) => `${s.spec.id} (${s.spec.label}, ${s.parts.length} parts)`).join('; ');
    const panels = [...overlays.values()]
      .filter((o) => o.kind === 'panel')
      .map((o) => `${o.id} "${o.title}"${o.anchor ? ' @' + o.anchor : ''}`)
      .join('; ');
    const yawDeg = Math.round(THREE.MathUtils.radToDeg(st.yawT - DEFAULT_YAW));
    return [
      `Assembly "${a.title}" (id ${a.id}), ${a.parts.size} parts.`,
      `Systems: ${systems}.`,
      `Explode ${st.explodeT.toFixed(2)}. Focused: ${st.focused ?? 'none'}. Rotation ${yawDeg} deg from default, scale ${st.scaleT.toFixed(2)}.`,
      panels ? `Panels: ${panels}.` : 'Panels: none.',
    ].join('\n');
  }

  // ---------- frame loop ----------
  const tmpV = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const camDirLocal = new THREE.Vector3();
  let last = performance.now();
  let raf = 0;
  const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const k = 1 - Math.exp(-dt * 9);
    const kSlow = 1 - Math.exp(-dt * 6);
    if (present.on && present.t < 1) {
      present.t = Math.min(1, present.t + dt / 0.9);
      const e = 1 - Math.pow(1 - present.t, 3);
      const over = 1 + Math.sin(present.t * Math.PI) * 0.08;
      stage.position.lerpVectors(present.from, STAGE_POS, e);
      stage.scale.set(0.08 + 0.92 * e * over, 0.08 + 0.92 * e * over, (0.02 + 0.98 * e) * over);
    }
    stage.visible = present.on;
    st.yaw += (st.yawT - st.yaw) * k;
    st.pitch += (st.pitchT - st.pitch) * k;
    st.scale += (st.scaleT - st.scale) * k;
    st.explode += (st.explodeT - st.explode) * kSlow;
    turntable.rotation.set(st.pitch, st.yaw, 0, 'XYZ');
    turntable.scale.setScalar(st.scale);
    turntable.updateMatrixWorld();

    // Direction toward the camera, expressed in assembly space, for the focus lift.
    turntable.getWorldQuaternion(tmpQ).invert();
    camDirLocal.copy(camera.position).sub(stage.position).normalize().multiplyScalar(0.25);
    camDirLocal.y += 0.05;
    camDirLocal.applyQuaternion(tmpQ).divideScalar(Math.max(st.scale, 0.01));

    const pulse = 0.5 + 0.5 * Math.sin(now / 380);
    if (assembly) {
      for (const sys of assembly.systems.values()) {
        const isF = st.focused === sys.spec.id;
        const dimT = st.focused && !isF ? 0.25 : 1;
        sys.dim += (dimT - sys.dim) * k;
        sys.focus += ((isF ? 1 : 0) - sys.focus) * k;
        sys.hover += ((st.hovered === sys.spec.id ? 1 : 0) - sys.hover) * (1 - Math.exp(-dt * 14));
        const ex = sys.spec.explode;
        // Focusing also pulls the system a little apart so it reads as lifted out.
        const exAmt = Math.max(st.explode, sys.focus * 0.35);
        tmpV.set(ex[0] * exAmt, ex[1] * exAmt, ex[2] * exAmt).addScaledVector(camDirLocal, sys.focus);
        sys.group.position.copy(tmpV);
        const emis = Math.max(sys.hover * 0.22, sys.focus * (0.14 + 0.08 * pulse));
        for (const p of sys.parts) {
          const t = Math.min(1, (now - p.born) / APPEAR_MS);
          const e = easeOut(t);
          p.mesh.scale.setScalar(0.82 + 0.18 * e + (t < 1 ? 0.04 * Math.sin(Math.PI * t) : 0));
          const op = e * sys.dim;
          p.material.opacity = op;
          p.material.depthWrite = op > 0.5;
          p.material.emissive.copy(TAN).multiplyScalar(emis);
        }
      }
      for (const o of overlays.values()) {
        placeOverlay(o);
        const dimmed = st.focused && o.anchor && o.anchor !== st.focused;
        o.el.style.opacity = dimmed ? '0.3' : '1';
      }
      if (focusPanel) placeOverlay(focusPanel);
      // Contact shadow under the assembled object.
      const b = assemblyBox();
      const sm = shadow.material as THREE.MeshBasicMaterial;
      if (!b.isEmpty()) {
        const sx = (b.max.x - b.min.x) * 1.25 + 0.2;
        const sz = (b.max.z - b.min.z) * 1.6 + 0.25;
        shadow.position.set((b.min.x + b.max.x) / 2, b.min.y - 0.004, (b.min.z + b.max.z) / 2);
        shadow.scale.set(sx, sz, 1);
        sm.opacity += ((video ? 0.5 : 0.85) * (1 - 0.5 * st.explode) - sm.opacity) * k;
        if (!video) grid.position.y = STAGE_POS.y + b.min.y * st.scale - 0.006;
      }
    } else {
      (shadow.material as THREE.MeshBasicMaterial).opacity *= 1 - k;
      for (const o of overlays.values()) placeOverlay(o);
    }

    for (const t of ticks) t(dt);
    renderer.render(scene, camera);
    css.render(scene, camera);
  }
  const ticks: ((dt: number) => void)[] = [];
  const present = { on: true, t: 1, from: STAGE_POS.clone() };
  function setPresent(on: boolean, from?: THREE.Vector3) {
    present.on = on;
    if (on) {
      present.t = from ? 0 : 1;
      present.from.copy(from ?? STAGE_POS);
      if (!from) { stage.position.copy(STAGE_POS); stage.scale.setScalar(1); }
    }
  }
  function attach(object: THREE.Object3D, tick?: (dt: number) => void) {
    scene.add(object);
    if (tick) ticks.push(tick);
  }
  raf = requestAnimationFrame(frame);

  function dispose() {
    cancelAnimationFrame(raf);
    ro.disconnect();
    window.removeEventListener('resize', resize);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('wheel', onWheel);
    clear();
    envRT.dispose();
    pmrem.dispose();
    videoTex?.dispose();
    renderer.dispose();
    canvas.remove();
    css.domElement.remove();
  }

  const api: SceneApiExt = { apply, act, clear, pick, hover, rotateBy, explodeBy, scaleBy, describe, press, attach, dispose, camera, setPresent, home: { position: CAM_POS.clone(), target: LOOK_AT.clone() } };
  // Handy for debugging from the console and for headless checks.
  (window as unknown as { __scene?: SceneApiExt }).__scene = api;
  return api;
}

export type { SceneApi };
