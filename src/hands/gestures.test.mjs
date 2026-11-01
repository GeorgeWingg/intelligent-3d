// Run: node --experimental-strip-types src/hands/gestures.test.mjs
import assert from 'node:assert/strict';
import { GestureEngine, pinchRatio } from './gestures.ts';

// Synthetic hand: wrist at (cx, cy+0.1), middle MCP 0.1 above it (hand size 0.1),
// thumb tip and index tip separated by `gap` (so pinch ratio = gap / 0.1).
function hand(cx, cy, gap) {
  const lm = Array.from({ length: 21 }, () => ({ x: cx, y: cy, z: 0 }));
  lm[0] = { x: cx, y: cy + 0.1, z: 0 };
  lm[9] = { x: cx, y: cy, z: 0 };
  lm[4] = { x: cx - gap / 2, y: cy - 0.05, z: 0 };
  lm[8] = { x: cx + gap / 2, y: cy - 0.05, z: 0 };
  return lm;
}
const toNdc = (u, v) => ({ x: (u - 0.5) * 2, y: -(v - 0.5) * 2 });
const types = (evs) => evs.map((e) => e.type);
let t = 0;
const step = (eng, hands) => eng.update(hands, (t += 33));

let passed = 0;
function test(name, fn) {
  t = 0;
  fn();
  passed++;
  console.log('ok -', name);
}

test('pinchRatio', () => {
  assert.ok(Math.abs(pinchRatio(hand(0.5, 0.5, 0.02)) - 0.2) < 1e-9);
  assert.ok(Math.abs(pinchRatio(hand(0.5, 0.5, 0.05)) - 0.5) < 1e-9);
});

test('open hand emits point, no pinch', () => {
  const eng = new GestureEngine({ toNdc });
  const evs = step(eng, [{ hand: 'Right', landmarks: hand(0.5, 0.5, 0.08) }]);
  assert.deepEqual(types(evs), ['point']);
});

test('pinch enter needs 2 frames below 0.28 (debounce)', () => {
  const eng = new GestureEngine({ toNdc });
  const R = (g) => [{ hand: 'Right', landmarks: hand(0.5, 0.5, g) }];
  step(eng, R(0.08));
  assert.deepEqual(types(step(eng, R(0.02))), ['point']); // 1st frame below: not yet
  assert.deepEqual(types(step(eng, R(0.02))), ['pinchstart', 'pinchmove']);
  // a single-frame glitch below threshold never starts a pinch
  const eng2 = new GestureEngine({ toNdc });
  step(eng2, R(0.08));
  step(eng2, R(0.02));
  assert.deepEqual(types(step(eng2, R(0.08))), ['point']);
  assert.deepEqual(types(step(eng2, R(0.02))), ['point']);
});

test('hysteresis: ratio 0.35 neither starts nor ends a pinch', () => {
  const eng = new GestureEngine({ toNdc });
  const R = (g) => [{ hand: 'Right', landmarks: hand(0.5, 0.5, g) }];
  for (let i = 0; i < 5; i++) assert.ok(!types(step(eng, R(0.035))).includes('pinchstart'));
  step(eng, R(0.02));
  step(eng, R(0.02)); // pinching now
  for (let i = 0; i < 5; i++) {
    const e = types(step(eng, R(0.035)));
    assert.ok(!e.includes('pinchend'), 'stays pinched in hysteresis band');
    assert.ok(e.includes('pinchmove'));
  }
  step(eng, R(0.05));
  assert.deepEqual(types(step(eng, R(0.05))), ['pinchend', 'point']);
});

test('pinchmove carries dx/dy of the (smoothed) pinch point', () => {
  const eng = new GestureEngine({ toNdc });
  step(eng, [{ hand: 'Right', landmarks: hand(0.5, 0.5, 0.02) }]);
  step(eng, [{ hand: 'Right', landmarks: hand(0.5, 0.5, 0.02) }]);
  let sumDx = 0;
  for (let i = 1; i <= 20; i++) {
    const evs = step(eng, [{ hand: 'Right', landmarks: hand(0.5 + i * 0.01, 0.5, 0.02) }]);
    const mv = evs.find((e) => e.type === 'pinchmove');
    assert.ok(mv);
    assert.ok(mv.dx >= 0);
    sumDx += mv.dx;
  }
  assert.ok(sumDx > 0.3 && sumDx < 0.41, `sumDx ${sumDx}`); // moved 0.4 NDC, smoothing lags a little
});

test('two hands pinching: twohand with spread/delta, single moves suppressed', () => {
  const eng = new GestureEngine({ toNdc });
  const both = (sep) => [
    { hand: 'Left', landmarks: hand(0.5 - sep, 0.5, 0.02) },
    { hand: 'Right', landmarks: hand(0.5 + sep, 0.5, 0.02) },
  ];
  step(eng, both(0.1));
  const start = step(eng, both(0.1));
  assert.deepEqual(types(start).filter((x) => x === 'pinchstart').length, 2);
  assert.ok(types(start).includes('twohand'));
  assert.ok(!types(start).includes('pinchmove'));
  let last = start.find((e) => e.type === 'twohand');
  assert.equal(last.delta, 0);
  let total = 0;
  for (let i = 1; i <= 10; i++) {
    const evs = step(eng, both(0.1 + i * 0.02));
    assert.ok(!types(evs).includes('pinchmove'));
    assert.ok(!types(evs).includes('point'));
    const th = evs.find((e) => e.type === 'twohand');
    assert.ok(th.delta > 0, 'spreading apart gives positive delta');
    total += th.delta;
    last = th;
  }
  assert.ok(Math.abs(last.spread - (0.4 + total)) < 1e-9);
  assert.ok(last.spread > 0.6, `spread ${last.spread}`);
});

test('same label twice is split by screen position', () => {
  const eng = new GestureEngine({ toNdc });
  step(eng, [
    { hand: 'Right', landmarks: hand(0.7, 0.5, 0.08) },
    { hand: 'Right', landmarks: hand(0.3, 0.5, 0.08) },
  ]);
  assert.deepEqual(eng.hands.map((h) => h.hand).sort(), ['Left', 'Right']);
});

test('hand vanishing mid-pinch ends the pinch, then lost after 300 ms', () => {
  const eng = new GestureEngine({ toNdc });
  const R = [{ hand: 'Right', landmarks: hand(0.5, 0.5, 0.02) }];
  step(eng, R);
  step(eng, R); // pinching at t=66
  const seen = [];
  for (let i = 0; i < 12; i++) seen.push(...types(step(eng, [])).map((x) => `${t}:${x}`));
  const end = seen.find((s) => s.endsWith('pinchend'));
  const lost = seen.filter((s) => s.endsWith('lost'));
  assert.ok(end, 'pinchend emitted');
  assert.equal(lost.length, 1, 'lost emitted exactly once');
  const lostT = Number(lost[0].split(':')[0]);
  assert.ok(lostT - 66 >= 300 && lostT - 66 < 340, `lost at +${lostT - 66}ms`);
  assert.ok(Number(end.split(':')[0]) < lostT);
});

test('brief dropout (< 150 ms) keeps the pinch alive', () => {
  const eng = new GestureEngine({ toNdc });
  const R = [{ hand: 'Right', landmarks: hand(0.5, 0.5, 0.02) }];
  step(eng, R);
  step(eng, R);
  const e1 = types(step(eng, []));
  const e2 = types(step(eng, []));
  const e3 = types(step(eng, R));
  assert.ok(![...e1, ...e2, ...e3].includes('pinchend'));
  assert.ok(e3.includes('pinchmove'));
});

console.log(`${passed} tests passed`);
