// Dev harness for hands-dev.html: proves the model + wasm load and the full createHands path runs.
// 1) IMAGE-mode detection on public/models/test-hand.jpg -> landmark count.
// 2) The test image streamed into a <video> via canvas.captureStream -> createHands loop, overlay, fps.
//    Add ?camera to use the real webcam instead.
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { createHands } from './index';

const logEl = document.getElementById('log')!;
const log = (s: string) => {
  console.log(`HANDS_DEV ${s}`);
  logEl.textContent += s + '\n';
};
const result: Record<string, unknown> = {};
(window as unknown as { __handsDev: unknown }).__handsDev = result;

async function imageTest(img: HTMLImageElement) {
  const fileset = await FilesetResolver.forVisionTasks('/mediapipe-wasm');
  const lm = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate: 'CPU' },
    runningMode: 'IMAGE',
    numHands: 2,
  });
  const t0 = performance.now();
  const res = lm.detect(img);
  const ms = performance.now() - t0;
  const hands = res.landmarks.length;
  const points = res.landmarks.reduce((n, h) => n + h.length, 0);
  const labels = res.handedness.map((h) => h[0]?.categoryName).join(',');
  log(`image: hands=${hands} landmarks=${points} handedness=${labels} detect=${ms.toFixed(1)}ms`);
  result.image = { hands, points, labels, ms };
  lm.close();
}

async function videoTest(img: HTMLImageElement) {
  const video = document.getElementById('video') as HTMLVideoElement;
  if (location.search.includes('camera')) {
    video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
  } else {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!;
    let k = 0;
    const paint = () => {
      ctx.drawImage(img, 0, 0);
      ctx.fillStyle = `rgba(0,0,0,${(k++ % 2) * 0.004})`; // keep frames changing
      ctx.fillRect(0, 0, 1, 1);
      requestAnimationFrame(paint);
    };
    paint();
    video.srcObject = c.captureStream(30);
  }
  await video.play();
  const counts: Record<string, number> = {};
  const hands = createHands(
    video,
    (e) => {
      counts[e.type] = (counts[e.type] ?? 0) + 1;
    },
    { mirror: true, overlay: document.getElementById('view')!, delegate: location.search.includes('cpu') ? 'CPU' : undefined },
  );
  await hands.start();
  log(`video: running=${hands.running} delegate=${hands.delegate}`);
  await new Promise((r) => setTimeout(r, location.search.includes('long') ? 10000 : 4000));
  log(`video: fps=${hands.fps.toFixed(1)} events=${JSON.stringify(counts)}`);
  result.video = { fps: hands.fps, delegate: hands.delegate, counts };
  if (location.search.includes('stop')) hands.stop();
}

(async () => {
  try {
    const img = new Image();
    img.src = '/models/test-hand.jpg';
    await img.decode();
    await imageTest(img);
    await videoTest(img);
    result.done = true;
    log('done');
  } catch (err) {
    result.error = String(err);
    log(`error: ${String(err)}`);
  }
})();
