// The storyteller's voice keeps playing when it could not be routed through Web
// Audio. On an iPad (Nov 17, Chrome, joining in) the narration went silent after
// the first shape in one playback and not in the next (j6ghxcag89, routed: fine).
// When the audio context is not running yet as the recording loads, the voice is
// not routed through a gain node; quiet between lines it was then paused, and iOS
// will not start a paused voice again without a tap. Here the audio context never
// runs (so the voice cannot be routed) and a paused voice cannot play again
// without a tap, as on iOS. With the sample story from Dad, joining in
// (Chromium's fake camera: a test pattern):
//   1. while the child's turn waits, the voice is not heard, and is not paused;
//   2. after the child's shape and the turn, the voice is heard again.
//
//   node scripts/sim/viewer-unrouted.mjs [--gpu]
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
  await context.addInitScript(() => {
    // The audio context never runs: the voice cannot be routed through Web Audio.
    const Real = window.AudioContext;
    window.AudioContext = class extends Real {
      constructor(...a) {
        super(...a);
        void super.suspend();
      }
      get state() {
        return 'suspended';
      }
      resume() {
        return Promise.resolve();
      }
    };
    // iOS: a paused recorded voice (a blob) cannot play again without a tap.
    window.__voice = { plays: 0, refused: 0 };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this.src.startsWith('blob:')) {
        window.__voices = new Set([...(window.__voices ?? []), this]);
        if (window.__voice.plays > 0 && this.paused) {
          window.__voice.refused++;
          return Promise.reject(new DOMException('play() needs a tap', 'NotAllowedError'));
        }
        window.__voice.plays++;
      }
      return play.call(this);
    };
    window.__heard = () => [...(window.__voices ?? [])].some((a) => !a.paused && !a.muted);
    window.__paused = () => [...(window.__voices ?? [])].some((a) => a.paused);
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(APP + '/?viewer', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  const card = page.getByRole('button', { name: /Watch A story from far away from Dad/ }).first();
  await card.waitFor({ timeout: 30000 });
  await card.click();
  await page.waitForFunction(() => __sp.get('PerformancePlayer', 'position') > 1, null, { timeout: 30000 });
  const routed = await page.evaluate(() => __sp.view().playbackVoice.routed);
  await page.mouse.move(400, 300);
  await page.getByRole('button', { name: 'Join in with your hands' }).click();
  await page.getByRole('button', { name: 'Allow camera' }).click().catch(() => undefined);
  const turn = await page.waitForFunction(() => __sp.get('PerformancePlayer', 'inJoinIn'), null, { timeout: 120000, polling: 200 }).then(() => true, () => false);

  // 1. The turn waits.
  await sleep(8000);
  const waiting = await page.evaluate(() => ({ heard: window.__heard(), paused: window.__paused(), ...window.__voice }));
  check('not routed, while the turn waits: the voice is not heard, and not paused', !routed && turn && !waiting.heard && !waiting.paused, { routed, turn, waiting });

  // 2. The child's shape, the turn ends: heard again.
  const target = await page.evaluate(() => __sp.get('ShapeRecognizer', 'target'));
  await page.evaluate((t) => {
    __sp.set('ShapeRecognizer', 'matchedHand', 'right');
    __sp.set('ShapeRecognizer', 'matchedShape', t);
  }, target);
  const back = await page.waitForFunction(() => !__sp.get('PerformancePlayer', 'inJoinIn'), null, { timeout: 90000, polling: 250 }).then(() => true, () => false);
  const heard = await page.waitForFunction(() => window.__heard(), null, { timeout: 15000, polling: 200 }).then(() => true, () => false);
  const after = await page.evaluate(() => ({ heard: window.__heard(), paused: window.__paused(), ...window.__voice }));
  check('not routed, after the child\'s shape and the turn: the voice is heard again (no tap needed)', back && heard && after.refused === 0, { back, heard, target, after });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed || errors.length) process.exitCode = 1;
