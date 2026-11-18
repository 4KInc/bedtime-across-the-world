// A child's goodnight back wakes the shape they make, not only the rabbit. On
// an iPad (Nov 17), sending a goodnight back, a child's rabbit woke at once but
// a dog or a bird hardly ever did: the goodnight is free play (nothing asked
// for), and free play gave real hands none of the room a story gives the shape
// it asks for. Here the family viewer's recognizer is in free play, as Send a
// goodnight back puts it, and hands come through the hand override the camera
// writes (posed as people make them, fingers a little relaxed; no camera is
// opened), held where a child holds them in the light. Each must wake as itself:
//   1. a relaxed dog, fish and swan (one hand);
//   2. a relaxed bird (two hands, wrists 24 cm apart);
//   3. still: the rabbit, and a resting hand wakes nothing.
//
//   node scripts/sim/goodnight-shapes.mjs [--gpu]
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

const f = (curl) => ({ curl });
/**
 * Hands as people make them: fingers a little relaxed (a resting hand curls about 0.3), so they
 * fit the resting-hand template best, and two hands held a little apart. `seed` is the hand's own
 * joint-angle noise (hand-poses.ts), standing in for one person.
 */
const POSES = {
  dog: { seed: 59, right: { fingers: [f(0.2), f(0.2), f(0.2), f(0.35)], spread: 0, thumb: 'raised', roll: -90 } },
  fish: { seed: 59, right: { fingers: [f(0.22), f(0.22), f(0.22), f(0.22)], spread: 0, thumb: 'tucked', roll: -90 } },
  swan: { seed: 41, right: { fingers: [f(0.22), f(0.22), f(0.22), f(0.22)], spread: 0, thumb: 'tucked', roll: 180 } },
  bird: {
    seed: 37,
    right: { fingers: [f(0.2), f(0.2), f(0.2), f(0.2)], spread: 14, thumb: 'out', roll: -90 },
    left: { fingers: [f(0.2), f(0.2), f(0.2), f(0.2)], spread: 14, thumb: 'out', roll: -90 },
    rightAt: [0.12, 0],
    leftAt: [-0.12, 0],
  },
  rabbit: { seed: 37, right: { fingers: [f(0), f(0), f(1), f(1)], spread: 10, thumb: { touch: 19 } } },
  resting: { seed: 37, right: { fingers: [f(0.3), f(0.25), f(0.3), f(0.35)], spread: 5, thumb: 'half' } },
};

const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 }, ignoreHTTPSErrors: true })).newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(APP + '/?viewer', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  // The app's own module copies (Vite may serve them with ?t= after an update).
  await page.evaluate(async () => {
    performance.setResourceTimingBufferSize(5000);
    const url = (file) => performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes(file)) ?? file;
    window.__rt = await import(url('/src/stage-runtime.ts'));
    window.__poses = await import(url('/src/hand-poses.ts'));
  });
  await page.waitForFunction(() => __rt.stageRuntime.ready && __rt.stageRuntime.lampOn, null, { timeout: 30000 });
  // Free play, as Send a goodnight back sets it (viewer-ui.ts openReply).
  await page.evaluate(() => {
    __sp.set('ShapeRecognizer', 'freeMode', true);
    __sp.set('ShapeRecognizer', 'target', 'none');
  });

  /** Hold a pose in the light (the camera's hands, posed) for up to 4 s; the creature that wakes. */
  const make = (pose) =>
    page.evaluate(async (pose) => {
      const { handOverride, stageRuntime: s } = __rt;
      const rec = () => ({ hand: __sp.get('ShapeRecognizer', 'matchedHand'), shape: __sp.get('ShapeRecognizer', 'matchedShape') });
      __sp.set('ShapeRecognizer', 'matchedHand', 'none');
      __sp.set('ShapeRecognizer', 'matchedShape', 'none');
      // Where a hand rests in the lamplight, as the demo hands are placed (demo-director.ts).
      const fwd = (p) => -((p.x - s.eye.x) * s.normal.x + (p.y - s.eye.y) * s.normal.y + (p.z - s.eye.z) * s.normal.z);
      const b = fwd(s.bulb);
      const c = fwd(s.center);
      const reach = c - b > 1e-3 ? Math.min(0.9, Math.max(0.05, (0.42 - b) / (c - b))) : 0.4;
      const base = s.bulb.clone().lerp(s.center, reach).addScaledVector(s.up, -0.06);
      const place = (side, hp, at) => {
        if (!hp) return null;
        const wrist = base.clone().addScaledVector(s.right, at?.[0] ?? 0).addScaledVector(s.up, at?.[1] ?? 0);
        return __poses.toWorld(__poses.localJoints(hp, 1, side === 'left' ? pose.seed + 1000 : pose.seed), side, wrist, s.right, s.up, s.normal, new Float32Array(75));
      };
      handOverride.cameraAllowed = false;
      handOverride.active = true;
      handOverride.source = 'sim';
      handOverride.right = place('right', pose.right, pose.rightAt);
      handOverride.left = place('left', pose.left, pose.leftAt);
      const t0 = performance.now();
      let woke = 'none';
      while (performance.now() - t0 < 4000) {
        await new Promise((r) => setTimeout(r, 50));
        const r = rec();
        if (r.hand !== 'none') {
          woke = r.shape;
          break;
        }
      }
      const seen = { left: __sp.get('ShapeRecognizer', 'leftShape'), right: __sp.get('ShapeRecognizer', 'rightShape') };
      handOverride.right = handOverride.left = null;
      return { woke, seen };
    }, pose);

  const got = {};
  for (const name of Object.keys(POSES)) {
    got[name] = await make(POSES[name]);
    await sleep(1500);
  }
  check('a relaxed dog, fish and swan wake as themselves', ['dog', 'fish', 'swan'].every((s) => got[s].woke === s), { dog: got.dog, fish: got.fish, swan: got.swan });
  check('a relaxed bird (two hands) wakes as the bird', got.bird.woke === 'bird', got.bird);
  check('still: the rabbit wakes, and a resting hand wakes nothing', got.rabbit.woke === 'rabbit' && got.resting.woke === 'none', { rabbit: got.rabbit, resting: got.resting });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed || errors.length) process.exitCode = 1;
