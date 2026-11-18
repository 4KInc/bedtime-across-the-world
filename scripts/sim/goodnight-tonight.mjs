// A goodnight back can answer with tonight's creatures. Sending a goodnight
// back, a child could make only the classic shapes (rabbit, dog, fish, bird,
// snail, swan, deer, crocodile): the creatures of the story they had just
// watched (the shark, the car...) never woke, as they had never been "met" on
// that phone. Here a story that woke a shark and a car plays to its end on the
// family viewer; Send a goodnight back; Start (the camera allowed: Chromium's
// fake camera, a test pattern), and the child's hands come through the hand
// override the camera writes, posed (no one's camera is opened):
//   1. the shark's fin (a flat hand, fingers up) wakes the shark;
//   2. the snail's two fingers wake tonight's car first (the pose they share);
//   3. still: the rabbit wakes.
//
//   node scripts/sim/goodnight-tonight.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { chromium } from 'playwright';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};
const errors = [];

const browser = await chromium.launch({
  args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
try {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, ignoreHTTPSErrors: true, permissions: ['camera'] });
  await context.addInitScript(() => performance.setResourceTimingBufferSize(5000));
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(APP + '/?viewer', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  // Tonight's story, as a family code brings it: it woke a shark and a car.
  // (The app's own module copies: Vite may serve them with ?t= after an update.)
  await page.evaluate(() =>
      import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/src/journal-store.ts')) ?? '/src/journal-store.ts').then((s) =>
        s.saveRecording({
          version: 'shadowplay.performance.v1', id: 'tonight', title: 'The Shy Little Shark', performer: 'Dad', child: 'Mia', shareCode: 'biscuit-puddle-marigold-704',
          createdAt: Date.now() - 60_000, durationMs: 1500, script: 'story/gentle-shark.story.json', frameHz: 30, hands: '', frameCount: 0,
          events: [
            // As a recording does: its beats (here the title and The End), the lamp low at the end.
            { t: 0, type: 'beat', data: { index: 0, id: 'shark-title' } },
            { t: 1200, type: 'beat', data: { index: 44, id: 'shark-end' } },
            { t: 1400, type: 'stage', data: { lampLevel: 0.35, finale: 1, glow: 1 } },
            { t: 300, type: 'wake', data: { shape: 'shark', hand: 'right', twoHanded: false } },
            { t: 600, type: 'wake', data: { shape: 'car', hand: 'right', twoHanded: false } },
          ],
        }),
      ),
  );
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await page.evaluate(async () => {
    const find = (file) => performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes(file)) ?? file;
    window.__rt = await import(find('/src/stage-runtime.ts'));
    window.__poses = await import(find('/src/hand-poses.ts'));
  });

  // The story plays to its end; its goodnight offers Send a goodnight back.
  await page.getByRole('button', { name: /Watch The Shy Little Shark/ }).first().click();
  const reply = page.getByRole('button', { name: /Send a goodnight back/ });
  await reply.waitFor({ timeout: 60000 });
  await reply.click();
  await page.getByRole('button', { name: 'Start' }).click();
  await page.getByRole('button', { name: 'Allow camera' }).click({ timeout: 5000 }).catch(() => undefined);
  await page.waitForFunction(() => __sp.get('ShapeRecognizer', 'freeMode') && __rt.stageRuntime.ready && __rt.stageRuntime.lampOn, null, { timeout: 30000 });
  const tonight = await page.evaluate(() => __rt.tonightRuntime?.creatures ?? '(none)');

  const f = (curl) => ({ curl });
  /** Hold a pose in the light for up to 4 s, as the camera's hands; the creature that wakes. */
  const make = (pose) =>
    page.evaluate(async (pose) => {
      const { handOverride, stageRuntime: s } = __rt;
      __sp.set('ShapeRecognizer', 'matchedHand', 'none');
      __sp.set('ShapeRecognizer', 'matchedShape', 'none');
      // Where a hand rests in the lamplight, as the demo hands are placed (demo-director.ts).
      const fwd = (p) => -((p.x - s.eye.x) * s.normal.x + (p.y - s.eye.y) * s.normal.y + (p.z - s.eye.z) * s.normal.z);
      const b = fwd(s.bulb);
      const c = fwd(s.center);
      const reach = c - b > 1e-3 ? Math.min(0.9, Math.max(0.05, (0.42 - b) / (c - b))) : 0.4;
      const wrist = s.bulb.clone().lerp(s.center, reach).addScaledVector(s.up, -0.06);
      handOverride.cameraAllowed = false;
      handOverride.active = true;
      handOverride.source = 'sim';
      handOverride.left = null;
      handOverride.right = __poses.toWorld(__poses.localJoints(pose, 1, 37), 'right', wrist, s.right, s.up, s.normal, new Float32Array(75));
      const t0 = performance.now();
      let woke = 'none';
      while (performance.now() - t0 < 4000) {
        await new Promise((r) => setTimeout(r, 50));
        if (__sp.get('ShapeRecognizer', 'matchedHand') !== 'none') {
          woke = __sp.get('ShapeRecognizer', 'matchedShape');
          break;
        }
      }
      handOverride.right = null;
      return woke;
    }, pose);

  const shark = await make({ fingers: [f(0), f(0), f(0), f(0)], spread: 0, thumb: 'tucked', roll: 0 });
  await sleep(1500);
  const car = await make({ fingers: [f(0), f(0), f(1), f(1)], spread: 6, thumb: { touch: 19 }, roll: -90 });
  await sleep(1500);
  const rabbit = await make({ fingers: [f(0), f(0), f(1), f(1)], spread: 10, thumb: { touch: 19 } });
  check("a goodnight back: the shark's fin wakes tonight's shark", shark === 'shark', { tonight, shark });
  check("the snail's two fingers wake tonight's car first", car === 'car', { car });
  check('still: the rabbit wakes', rabbit === 'rabbit', { rabbit });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed || errors.length) process.exitCode = 1;
