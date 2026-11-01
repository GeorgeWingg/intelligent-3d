// Voice orb: the sphere is a window onto a raymarched cloud volume that you drift through,
// accelerating forward as the voice level rises.
// Original implementation, inspired by nimitz's "Protean clouds" technique (shadertoy 3l23Rh):
// a cheap deformed periodic-grid noise volume, density-adaptive step size and a forward-moving
// camera inside a soft tunnel. No code from that shader is used.
import * as THREE from 'three';

const vertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float u_time;      // wall-clock-ish time, for slow morphing
  uniform float u_z;         // distance travelled along the tunnel
  uniform float u_level;     // smoothed voice level 0..1
  uniform float u_speed;     // smoothed forward speed
  uniform float u_presence;  // 0..1 visibility easing
  uniform mat3 u_rot;        // octave rotation
  varying vec3 vNormal;
  varying vec3 vView;

  const vec3 OLIVE  = vec3(0.055, 0.059, 0.031);
  const vec3 RUST   = vec3(0.30, 0.13, 0.05);
  const vec3 AMBER  = vec3(0.62, 0.36, 0.16);
  const vec3 ORANGE = vec3(0.913, 0.627, 0.400);
  const vec3 TAN    = vec3(0.831, 0.749, 0.596);
  const vec3 CREAM  = vec3(0.914, 0.871, 0.769);

  // Gentle meandering centre line of the tunnel.
  vec2 lane(float z) {
    return vec2(sin(z * 0.13) * 0.9 + sin(z * 0.051) * 0.6, cos(z * 0.097) * 0.7);
  }

  // Deformed periodic grid: |cos . sin| lattice summed over rotated, scaled octaves.
  float lattice(vec3 p, int oct) {
    float sum = 0.0;
    float amp = 0.62;
    float drift = u_time * 0.06;
    // Low-frequency warp + initial rotation hide the lattice's axis-aligned periodicity.
    p += 0.7 * sin(p.yzx * 0.37 + vec3(0.0, 1.1, 2.3));
    p = u_rot * p;
    for (int i = 0; i < 4; i++) {
      if (i >= oct) break;
      p += vec3(drift, -drift * 0.7, 0.0);
      sum += amp * abs(dot(cos(p * 0.83), sin(p.zxy * 0.91 + 1.3)));
      p = u_rot * p * 1.87 + vec3(0.4, 1.7, 2.3);
      amp *= 0.5;
    }
    return sum;
  }

  float density(vec3 p, int oct) {
    vec2 off = p.xy - lane(p.z);
    float r = length(off);
    // Hollow core, cloud walls further out.
    float wall = smoothstep(0.3, 2.0, r);
    float n = lattice(p * 1.55, oct);
    return clamp((n - 0.74 + wall * 0.6) * 1.9, 0.0, 1.0) * smoothstep(0.2, 0.8, r);
  }

  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vView);
    float facing = max(dot(n, v), 0.0);

    // Window ray: sphere surface point gives the main direction, the eye ray adds parallax.
    vec3 rd = normalize(vec3(n.xy * 0.62 - v.xy * 0.35, 1.0));
    // Slight roll with the lane so turns feel banked.
    vec3 ro = vec3(lane(u_z), u_z);
    vec2 ahead = lane(u_z + 2.5) - ro.xy;
    rd.xy += ahead * 0.18;
    rd = normalize(rd);

    vec3 lightDir = normalize(vec3(ahead * 0.25, 1.0));
    // Glow falloff measured in angle from the vanishing point (rd.z is ~0.85+ across the window).
    float sun = exp(-(1.0 - max(dot(rd, lightDir), 0.0)) * 28.0);

    // Far background: a warm glow down the tunnel.
    vec3 bg = mix(RUST * 0.5, AMBER, sun);
    bg = mix(bg, ORANGE, smoothstep(0.3, 0.8, sun) * 0.8);
    bg = mix(bg, CREAM, smoothstep(0.7, 1.0, sun) * 0.7);

    vec4 acc = vec4(0.0);
    float t = 0.05;
    for (int i = 0; i < 56; i++) {
      if (acc.a > 0.97 || t > 9.0) break;
      vec3 p = ro + rd * t;
      float d = density(p, 4);
      if (d > 0.01) {
        // One-tap directional derivative toward the light: lit edges glow cream.
        float dl = density(p + lightDir * 0.22, 3);
        float lit = clamp((d - dl) * 4.0 + 0.36, 0.0, 1.0);
        vec3 c = mix(RUST * 0.75, AMBER, smoothstep(0.1, 0.55, lit));
        c = mix(c, ORANGE, smoothstep(0.4, 0.7, lit) * 0.75);
        c = mix(c, TAN, smoothstep(0.65, 0.92, lit));
        c = mix(c, CREAM * 1.15, smoothstep(0.82, 1.0, lit));
        // Thin parts let the light through.
        c += ORANGE * (1.0 - d) * 0.45 * sun;
        // Distance fog toward the tunnel glow.
        float fog = 1.0 - exp(-t * 0.16);
        c *= mix(1.0, 0.62, smoothstep(0.0, 6.0, t) * (1.0 - sun));
        c = mix(c, bg, fog);
        float a = d * 0.24;
        acc.rgb += c * a * (1.0 - acc.a);
        acc.a += a * (1.0 - acc.a);
      }
      // Density-adaptive stride: long through the clear core, short inside cloud.
      t += clamp(0.34 - d * 0.3, 0.05, 0.34) * (0.8 + 0.6 * float(i) / 56.0);
    }
    vec3 col = acc.rgb + bg * (1.0 - acc.a);

    // Speed streak: brighten the vanishing point a touch when flying fast.
    col += ORANGE * sun * sun * u_level * 0.25;

    // Gentle tone curve, lift the blacks into olive.
    col = col * 1.15 / (1.0 + col * 0.3);
    col = mix(OLIVE, col, 0.92 + 0.08 * u_presence);

    // Window edge: darken just inside the rim, then a soft tan fresnel.
    float rim = 1.0 - facing;
    col *= mix(1.0, 0.7, smoothstep(0.45, 0.9, rim));
    col += TAN * pow(rim, 4.0) * 0.6;

    gl_FragColor = vec4(col, u_presence);
  }
`;

export interface Orb {
  object: THREE.Mesh;
  setLevel(level: number): void; // 0..1, mic or speaker level
  setVisible(on: boolean): void;
  update(dt: number): void;
}

export function createOrb(radius = 0.12): Orb {
  const rot = new THREE.Matrix3().setFromMatrix4(
    new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0.3, 0.8, 0.52).normalize(), 0.9),
  );
  const uniforms = {
    u_time: { value: 0 },
    u_z: { value: 8 },
    u_level: { value: 0 },
    u_speed: { value: 0 },
    u_presence: { value: 0 },
    u_rot: { value: rot },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 48), material);
  mesh.renderOrder = 10;
  const IDLE_SPEED = 0.35;
  const MAX_SPEED = 3.6;
  let target = 0;
  let level = 0;
  let speed = IDLE_SPEED;
  let presence = 0;
  let wantVisible = false;
  let clock = 0;

  return {
    object: mesh,
    setLevel(l) { target = Math.max(0, Math.min(1, l)); },
    setVisible(on) { wantVisible = on; if (on) mesh.visible = true; },
    update(dt) {
      // Guard against negative/huge dt (rAF timestamps can precede performance.now()).
      dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
      clock += dt;
      level += (target - level) * Math.min(1, dt * 10);
      // Speed eases more slowly than level so voice reads as smooth acceleration, not jitter.
      const wantSpeed = IDLE_SPEED + (MAX_SPEED - IDLE_SPEED) * Math.pow(Math.max(0, level), 1.2);
      speed += (wantSpeed - speed) * Math.min(1, dt * 2.2);
      presence += ((wantVisible ? 1 : 0) - presence) * Math.min(1, dt * 6);
      if (presence < 0.01 && !wantVisible) mesh.visible = false;
      uniforms.u_level.value = level;
      uniforms.u_speed.value = speed;
      uniforms.u_presence.value = presence;
      uniforms.u_z.value += dt * speed;
      uniforms.u_time.value = clock;
      const breathe = 1 + Math.sin(clock * 1.1) * 0.015;
      mesh.scale.setScalar(presence * breathe * (1 + level * 0.1));
    },
  };
}
