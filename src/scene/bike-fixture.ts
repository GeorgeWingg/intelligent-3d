// A 7-speed hybrid bike built from primitives, in metres.
// x = forward (front wheel at +x), y = up (axles at y = 0), z = toward the viewer's side (drive side +z).
// This is the labelled offline replay and the visual bar for model output.
import type { Shape, SpecLine, Vec3 } from '../contract';

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const V = (x: number, y: number, z = 0): Vec3 => [r3(x), r3(y), r3(z)];
const tube = (from: Vec3, to: Vec3, radius: number): Shape => ({ kind: 'tube', from, to, radius });
const ZROT: Vec3 = [r3(Math.PI / 2), 0, 0]; // cylinder axis along z

function polyline(points: Vec3[], radius: number, closed = false): Shape[] {
  const out: Shape[] = [];
  const n = closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) out.push(tube(points[i], points[(i + 1) % points.length], radius));
  return out;
}

// Catmull-Rom through control points, sampled into a polyline.
function curve(ctrl: Vec3[], samples: number): Vec3[] {
  const pts: Vec3[] = [];
  const P = (i: number) => ctrl[Math.max(0, Math.min(ctrl.length - 1, i))];
  for (let s = 0; s <= samples; s++) {
    const u = (s / samples) * (ctrl.length - 1);
    const i = Math.min(Math.floor(u), ctrl.length - 2);
    const t = u - i;
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const c = (k: number) =>
      0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t * t * t);
    pts.push(V(c(0), c(1), c(2)));
  }
  return pts;
}

// Key points
const REAR: Vec3 = V(-0.525, 0);
const FRONT: Vec3 = V(0.525, 0);
const BB = V(-0.105, -0.07);
const SEAT_TOP = V(-0.269, 0.465);
const HT_BOT = V(0.45, 0.4);
const HT_TOP = V(0.404, 0.532);
const RIM_R = 0.305;
const TYRE_R = 0.325;
// Brake bridge between the seatstays, 0.05 m out from the axle past the tyre top (seatstays run radially from the rear axle).
const BRIDGE_T = 0.375 / Math.hypot(0.26, 0.45);
const BRIDGE = V(-0.525 + 0.26 * BRIDGE_T, 0.45 * BRIDGE_T);

function wheel(prefix: 'front' | 'rear', c: Vec3): SpecLine[] {
  const [cx, cy] = c;
  const spokes: Shape[] = [];
  const N = 28;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const side = i % 2 === 0 ? 1 : -1;
    // Tangential lacing: hub end offset by a few degrees.
    const ha = a + side * 0.32;
    spokes.push(
      tube(V(cx + 0.024 * Math.cos(ha), cy + 0.024 * Math.sin(ha), side * 0.032), V(cx + (RIM_R - 0.006) * Math.cos(a), cy + (RIM_R - 0.006) * Math.sin(a), 0), 0.0016),
    );
  }
  const label = prefix === 'front' ? 'Front' : 'Rear';
  return [
    {
      t: 'part', assembly: 'bike', id: `${prefix}-tyre`, label: `${label} tyre`, system: 'wheels', color: '#2b2d30',
      shapes: [{ kind: 'torus', position: c, radius: TYRE_R, tube: 0.019 }],
    },
    {
      t: 'part', assembly: 'bike', id: `${prefix}-rim`, label: `${label} rim`, system: 'wheels', color: '#8a9199',
      shapes: [
        { kind: 'torus', position: c, radius: RIM_R, tube: 0.009 },
        { kind: 'cylinder', position: V(cx + (RIM_R + 0.012) * Math.cos(-1.2), cy + (RIM_R + 0.012) * Math.sin(-1.2)), rotation: [0, 0, r3(-1.2 + Math.PI / 2)], radius: 0.003, length: 0.03 },
      ],
    },
    {
      t: 'part', assembly: 'bike', id: `${prefix}-spokes`, label: `${label} spokes and hub`, system: 'wheels', color: '#7a828b',
      shapes: [
        ...spokes,
        { kind: 'cylinder', position: c, rotation: ZROT, radius: 0.018, length: 0.1 },
        { kind: 'cylinder', position: V(cx, cy, 0.032), rotation: ZROT, radius: 0.028, length: 0.004 },
        { kind: 'cylinder', position: V(cx, cy, -0.032), rotation: ZROT, radius: 0.028, length: 0.004 },
        { kind: 'cylinder', position: c, rotation: ZROT, radius: 0.005, length: 0.15 },
      ],
    },
  ];
}

const frameColor = '#ef8b57';

const frame: SpecLine[] = [
  {
    t: 'part', assembly: 'bike', id: 'main-triangle', label: 'Main triangle', system: 'frame', color: frameColor,
    shapes: [
      tube(BB, V(SEAT_TOP[0] + 0.006, SEAT_TOP[1] + 0.02), 0.016), // seat tube
      tube(V(-0.262, 0.452), V(0.418, 0.505), 0.017), // top tube
      tube(BB, V(0.44, 0.42), 0.021), // down tube
      tube(HT_BOT, HT_TOP, 0.02), // head tube
      { kind: 'cylinder', position: BB, rotation: ZROT, radius: 0.022, length: 0.075 }, // bottom bracket shell
    ],
  },
  {
    t: 'part', assembly: 'bike', id: 'rear-triangle', label: 'Seat and chain stays', system: 'frame', color: frameColor,
    shapes: [
      tube(V(-0.265, 0.45, 0.012), V(-0.525, 0.0, 0.062), 0.009),
      tube(V(-0.265, 0.45, -0.012), V(-0.525, 0.0, -0.062), 0.009),
      tube(V(BB[0], BB[1], 0.03), V(-0.525, 0.0, 0.062), 0.01),
      tube(V(BB[0], BB[1], -0.03), V(-0.525, 0.0, -0.062), 0.01),
      tube(V(BRIDGE[0], BRIDGE[1], 0.027), V(BRIDGE[0], BRIDGE[1], -0.027), 0.006), // brake bridge, above the tyre
      { kind: 'box', position: V(-0.525, 0, 0.064), size: [0.035, 0.03, 0.006] },
      { kind: 'box', position: V(-0.525, 0, -0.064), size: [0.035, 0.03, 0.006] },
    ],
  },
  {
    t: 'part', assembly: 'bike', id: 'fork', label: 'Fork', system: 'frame', color: frameColor,
    shapes: [
      { kind: 'box', position: V(0.452, 0.39), size: [0.045, 0.028, 0.115] },
      tube(V(0.455, 0.385, 0.05), V(0.508, 0.08, 0.052), 0.011),
      tube(V(0.508, 0.08, 0.052), V(0.525, 0.0, 0.052), 0.009),
      tube(V(0.455, 0.385, -0.05), V(0.508, 0.08, -0.052), 0.011),
      tube(V(0.508, 0.08, -0.052), V(0.525, 0.0, -0.052), 0.009),
    ],
  },
];

// Drivetrain
const CR = 0.1; // chainring radius
const COG_R = [0.064, 0.056, 0.049, 0.042, 0.036, 0.031, 0.026];
const CHAIN_Z = 0.062;
const COG = COG_R[3];
function chainLoop(): Vec3[] {
  const pts: Vec3[] = [];
  // Upper run from the top of the cog to the top of the chainring, around the ring's front.
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI / 2 - (i / 10) * Math.PI * 1.15;
    pts.push(V(BB[0] + CR * Math.cos(a), BB[1] + CR * Math.sin(a), CHAIN_Z));
  }
  // Lower run to the derailleur jockey wheels, then up to the cog.
  pts.push(V(-0.48, -0.15, CHAIN_Z));
  pts.push(V(-0.505, -0.145, CHAIN_Z));
  pts.push(V(-0.53, -0.085, CHAIN_Z));
  pts.push(V(-0.55, -0.055, CHAIN_Z));
  for (let i = 0; i <= 6; i++) {
    const a = -Math.PI * 0.62 - (i / 6) * Math.PI * 0.88;
    pts.push(V(REAR[0] + COG * Math.cos(a), REAR[1] + COG * Math.sin(a), CHAIN_Z));
  }
  return pts;
}
const crankAngle = -0.95;
const crankEnd = (s: number): Vec3 => V(BB[0] + s * 0.17 * Math.cos(crankAngle), BB[1] + s * 0.17 * Math.sin(crankAngle), s * 0.085);

const drivetrain: SpecLine[] = [
  {
    t: 'part', assembly: 'bike', id: 'chainring', label: 'Chainring and cranks', system: 'drivetrain', color: '#8a9199',
    shapes: [
      { kind: 'torus', position: V(BB[0], BB[1], 0.06), radius: CR, tube: 0.006 },
      { kind: 'torus', position: V(BB[0], BB[1], 0.06), radius: CR - 0.012, tube: 0.004 },
      ...[0, 1, 2, 3, 4].map((i): Shape => {
        const a = (i / 5) * Math.PI * 2 + 0.3;
        return tube(V(BB[0], BB[1], 0.06), V(BB[0] + 0.088 * Math.cos(a), BB[1] + 0.088 * Math.sin(a), 0.06), 0.006);
      }),
      tube(V(BB[0], BB[1], 0.085), crankEnd(1), 0.011),
      tube(V(BB[0], BB[1], -0.085), crankEnd(-1), 0.011),
      { kind: 'cylinder', position: BB, rotation: ZROT, radius: 0.01, length: 0.18 },
    ],
  },
  {
    t: 'part', assembly: 'bike', id: 'pedals', label: 'Pedals', system: 'drivetrain', color: '#3a3d42',
    shapes: [
      { kind: 'box', position: V(crankEnd(1)[0], crankEnd(1)[1], 0.13), size: [0.095, 0.022, 0.07] },
      { kind: 'box', position: V(crankEnd(-1)[0], crankEnd(-1)[1], -0.13), size: [0.095, 0.022, 0.07] },
    ],
  },
  {
    t: 'part', assembly: 'bike', id: 'cassette', label: '7-speed cassette', system: 'drivetrain', color: '#9aa1a8',
    shapes: COG_R.map((r, i): Shape => ({ kind: 'cylinder', position: V(REAR[0], REAR[1], 0.04 + i * 0.0055), rotation: ZROT, radius: r, length: 0.0028 })),
  },
  {
    t: 'part', assembly: 'bike', id: 'chain', label: 'Chain', system: 'drivetrain', color: '#6b7178',
    shapes: polyline(chainLoop(), 0.0045, true),
  },
  {
    t: 'part', assembly: 'bike', id: 'derailleur', label: 'Rear derailleur', system: 'drivetrain', color: '#8a9199',
    shapes: [
      { kind: 'cylinder', position: V(-0.53, -0.085, CHAIN_Z), rotation: ZROT, radius: 0.013, length: 0.008 },
      { kind: 'cylinder', position: V(-0.495, -0.15, CHAIN_Z), rotation: ZROT, radius: 0.013, length: 0.008 },
      tube(V(-0.53, -0.085, CHAIN_Z + 0.008), V(-0.495, -0.15, CHAIN_Z + 0.008), 0.006),
      tube(V(-0.53, -0.085, CHAIN_Z + 0.008), V(-0.535, -0.02, 0.07), 0.009),
      { kind: 'box', position: V(-0.53, -0.02, 0.072), size: [0.04, 0.03, 0.016] },
    ],
  },
  {
    t: 'part', assembly: 'bike', id: 'shifter', label: 'Thumb shifter', system: 'drivetrain', color: '#3a3d42',
    shapes: [
      { kind: 'box', position: V(0.465, 0.592, 0.175), size: [0.035, 0.025, 0.03] },
      ...polyline(curve([V(0.47, 0.59, 0.17), V(0.53, 0.57, 0.1), V(0.45, 0.43, 0.03), V(0.16, 0.14, 0.026), V(-0.09, -0.1, 0.034), V(-0.3, -0.04, 0.055), V(-0.5, -0.012, 0.07)], 24), 0.0025),
    ],
  },
];

// Cockpit: bars, stem, grips, seatpost, saddle.
const BAR_C = V(0.475, 0.6);
const SEAT_DIR = [-0.292, 0.956];
const POST_TOP = V(SEAT_TOP[0] + SEAT_DIR[0] * 0.2, SEAT_TOP[1] + SEAT_DIR[1] * 0.2);
const cockpit: SpecLine[] = [
  {
    t: 'part', assembly: 'bike', id: 'stem', label: 'Stem', system: 'cockpit', color: '#8a9199',
    shapes: [tube(HT_TOP, V(0.392, 0.582), 0.014), tube(V(0.39, 0.578), V(0.478, 0.602), 0.014), { kind: 'cylinder', position: V(0.478, 0.602), rotation: ZROT, radius: 0.017, length: 0.045 }],
  },
  {
    t: 'part', assembly: 'bike', id: 'handlebar', label: 'Handlebar', system: 'cockpit', color: '#8a9199',
    shapes: polyline(curve([V(0.44, 0.61, -0.31), V(0.47, 0.604, -0.15), V(BAR_C[0], BAR_C[1], 0), V(0.47, 0.604, 0.15), V(0.44, 0.61, 0.31)], 10), 0.011),
  },
  {
    t: 'part', assembly: 'bike', id: 'grips', label: 'Grips', system: 'cockpit', color: '#ef8b57',
    shapes: [tube(V(0.448, 0.609, 0.22), V(0.438, 0.611, 0.33), 0.017), tube(V(0.448, 0.609, -0.22), V(0.438, 0.611, -0.33), 0.017)],
  },
  {
    t: 'part', assembly: 'bike', id: 'seatpost', label: 'Seatpost', system: 'cockpit', color: '#8a9199',
    shapes: [tube(SEAT_TOP, POST_TOP, 0.0135), { kind: 'box', position: V(POST_TOP[0], POST_TOP[1] + 0.005), size: [0.05, 0.016, 0.03] }],
  },
  {
    t: 'part', assembly: 'bike', id: 'saddle', label: 'Saddle', system: 'cockpit', color: '#ef8b57',
    shapes: [
      { kind: 'box', position: V(POST_TOP[0] - 0.04, POST_TOP[1] + 0.03), size: [0.15, 0.045, 0.16] },
      { kind: 'box', position: V(POST_TOP[0] + 0.07, POST_TOP[1] + 0.03), rotation: [0, 0, -0.04], size: [0.13, 0.038, 0.065] },
    ],
  },
];

// Brakes: side-pull rim calipers, pads, levers, cables.
// Each caliper pivot sits on its mount (front of the fork crown, rear face of the seatstay bridge);
// the arms wrap round the tyre and the pads sit on the rim's braking surface, inner faces touching the rim sides.
const PAD_R = RIM_R - 0.006; // braking surface, below the tyre bead
const PAD_Z = r3(Math.sqrt(0.009 ** 2 - 0.006 ** 2) + 0.0045); // rim half-width at PAD_R + half pad thickness
const LEVER_X = 0.462, LEVER_Y = 0.606, LEVER_Z = 0.2;
const leverTop = (side: number) => V(LEVER_X + 0.008, LEVER_Y + 0.012, side * LEVER_Z);
interface Caliper { part: SpecLine; anchor: Vec3 }
function caliper(id: string, label: string, hub: Vec3, pivot: Vec3, cableSide: number): Caliper {
  const dx = pivot[0] - hub[0], dy = pivot[1] - hub[1];
  const d = Math.hypot(dx, dy);
  const ux = dx / d, uy = dy / d; // radial, axle -> pivot
  const at = (r: number, z: number) => V(hub[0] + ux * r, hub[1] + uy * r, z);
  const pad = at(PAD_R, 0);
  const tangent = r3(Math.atan2(uy, ux) + Math.PI / 2);
  const anchor = at(d + 0.024, cableSide * 0.034);
  const shapes: Shape[] = [
    { kind: 'cylinder', position: pivot, rotation: ZROT, radius: 0.009, length: 0.03 },
    tube(V(pivot[0], pivot[1], cableSide * 0.012), anchor, 0.005), // cable arm
    { kind: 'cylinder', position: anchor, radius: 0.0055, length: 0.016, rotation: [0, 0, r3(Math.atan2(uy, ux) - Math.PI / 2)] }, // barrel adjuster
  ];
  for (const s of [1, -1]) {
    const shoulder = at(d - 0.012, s * 0.042);
    const drop = at(PAD_R + 0.012, s * 0.03);
    shapes.push(tube(V(pivot[0], pivot[1], s * 0.012), shoulder, 0.0055));
    shapes.push(tube(shoulder, drop, 0.0055));
    shapes.push(tube(drop, V(pad[0], pad[1], s * (PAD_Z + 0.0045)), 0.0045));
    shapes.push({ kind: 'box', position: V(pad[0], pad[1], s * PAD_Z), rotation: [0, 0, tangent], size: [0.04, 0.01, 0.009] });
  }
  return { part: { t: 'part', assembly: 'bike', id, label, system: 'brakes', color: '#c6e3ef', shapes }, anchor };
}
// Front pivot just ahead of the crown face (crown box spans x 0.430-0.475).
const frontCaliper = caliper('front-brake', 'Front rim brake', FRONT, V(0.484, 0.39), -1);
// Rear pivot on the wheel side of the bridge: offset perpendicular to the (radial) seatstay.
const rearCaliper = caliper('rear-brake', 'Rear rim brake', REAR, V(BRIDGE[0] - 0.866 * 0.012, BRIDGE[1] + 0.5 * 0.012), 1);
// Top tube axis y at x, then the cable runs 0.02 above it on the drive side.
const ttY = (x: number) => 0.452 + (x + 0.262) * (0.053 / 0.68);
// Drive-side seatstay at fraction t from its top, offset up/back so the cable rides on it.
const ssCable = (t: number) => V(-0.265 - 0.26 * t - 0.866 * 0.012, 0.45 - 0.45 * t + 0.5 * 0.012, 0.012 + 0.05 * t + 0.008);
const fA = frontCaliper.anchor, rA = rearCaliper.anchor;
const brakes: SpecLine[] = [
  frontCaliper.part,
  rearCaliper.part,
  {
    t: 'part', assembly: 'bike', id: 'levers', label: 'Brake levers', system: 'brakes', color: '#c6e3ef',
    shapes: [
      { kind: 'cylinder', position: V(LEVER_X, LEVER_Y, LEVER_Z), rotation: ZROT, radius: 0.014, length: 0.03 },
      { kind: 'cylinder', position: V(LEVER_X, LEVER_Y, -LEVER_Z), rotation: ZROT, radius: 0.014, length: 0.03 },
      tube(V(0.47, 0.6, 0.21), V(0.515, 0.585, 0.29), 0.006),
      tube(V(0.47, 0.6, -0.21), V(0.515, 0.585, -0.29), 0.006),
    ],
  },
  {
    t: 'part', assembly: 'bike', id: 'cables', label: 'Brake cables', system: 'brakes', color: '#9fc7d6',
    shapes: [
      // Front: left lever, a loop ahead of the bars, down in front of the head tube to the front caliper.
      ...polyline(curve([leverTop(-1), V(0.53, 0.665, -0.15), V(0.565, 0.6, -0.07), V(0.535, 0.49, -0.04), V(fA[0] + 0.008, fA[1] + 0.03, fA[2]), fA], 20), 0.003),
      // Rear: right lever, loop, along the top of the top tube, past the seat cluster, down the seatstay to the rear caliper.
      ...polyline(curve([
        leverTop(1), V(0.54, 0.665, 0.15), V(0.47, 0.57, 0.05), V(0.33, ttY(0.33) + 0.02, 0.016), V(0.0, ttY(0.0) + 0.02, 0.016),
        V(-0.2, ttY(-0.2) + 0.02, 0.018), V(-0.262, 0.47, 0.024), ssCable(0.1), ssCable(0.18), rA,
      ], 40), 0.003),
    ],
  },
];

export const bikeFixture: SpecLine[] = [
  {
    t: 'assembly',
    id: 'bike',
    title: '7-speed hybrid bike',
    systems: [
      { id: 'frame', label: 'Frame', summary: 'A steel diamond frame: two triangles that carry the rider and keep both wheels aligned, with the fork steering the front.', explode: [0, 0, 0], color: frameColor },
      { id: 'wheels', label: 'Wheels', summary: '700c wheels with 28 tensioned spokes each; the tyres are the only suspension.', explode: [0, -0.4, 0.14] },
      { id: 'drivetrain', label: 'Drivetrain', summary: 'One chainring drives a 7-cog cassette; the rear derailleur moves the chain across cogs to change gear.', explode: [-0.04, -0.06, 0.34] },
      { id: 'brakes', label: 'Brakes', summary: 'Rim brakes: levers pull cables that squeeze pads against the wheel rims.', explode: [0, 0.3, 0.2] },
      { id: 'cockpit', label: 'Cockpit', summary: 'Where the rider touches the bike: flat bar, grips, stem, seatpost and saddle.', explode: [0.1, 0.46, -0.15] },
    ],
  },
  ...frame,
  ...wheel('rear', REAR),
  ...wheel('front', FRONT),
  ...drivetrain,
  ...cockpit,
  ...brakes,
  {
    t: 'panel', id: 'overview', title: '7-speed hybrid bike', position: [0.95, 0.45, 0],
    body: 'Five systems: frame, wheels, drivetrain, brakes and cockpit. Spread two hands to pull it apart, or pick a system below.',
  },
  {
    t: 'controls', id: 'bike-controls',
    buttons: [
      { label: 'Explode', action: { op: 'explode', amount: 1 } },
      { label: 'Assemble', action: { op: 'explode', amount: 0 } },
      { label: 'Frame', action: { op: 'focus', system: 'frame' } },
      { label: 'Wheels', action: { op: 'focus', system: 'wheels' } },
      { label: 'Drivetrain', action: { op: 'focus', system: 'drivetrain' } },
      { label: 'Brakes', action: { op: 'focus', system: 'brakes' } },
      { label: 'Cockpit', action: { op: 'focus', system: 'cockpit' } },
    ],
  },
  { t: 'say', text: 'Here is a 7-speed hybrid bike in five systems. Spread your hands to explode it, or ask for any system, like the brakes.' },
  { t: 'done' },
];
