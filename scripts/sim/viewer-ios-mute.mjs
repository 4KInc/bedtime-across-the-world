// While the child's Join in turn waits for their shape, the storyteller's
// recorded voice is not heard going on. On an iPad (Nov 17, diagnostics
// murp9yey4w) the story waited at each shape and the player had the voice
// "muted", but it was heard carrying on past the request, then jumped back to
// the line when the shape was made, and caught up. The voice is quietened with
// a Web Audio gain node, which there did not silence it. Here the page behaves
// so: the gain node passes the voice through at full loudness, an element's
// volume is ignored (as on iOS), and only muted, or paused, silences it. With the
// sample story from Dad, joining in (Chromium's fake camera: a test pattern):
//   1. while the turn waits for the child's shape, the voice is not audible (and not paused: no tap needed later);
//   2. after the child's shape and the turn, the voice is audible again.
//
//   node scripts/sim/viewer-ios-mute.mjs [--gpu]
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
    // As that iPad: a gain node does not quieten the voice, and an element's volume is ignored.
    const gainDesc = Object.getOwnPropertyDescriptor(AudioParam.prototype, 'value');
    const createGain = BaseAudioContext.prototype.createGain;
    BaseAudioContext.prototype.createGain = function () {
      const node = createGain.call(this);
      Object.defineProperty(node.gain, 'value', { get: () => 1, set: () => undefined, configurable: true });
      return node;
    };
    void gainDesc;
    Object.defineProperty(HTMLMediaElement.prototype, 'volume', { get: () => 1, set: () => undefined, configurable: true });
    // What is heard: the recorded voice (a blob) playing and not muted.
    window.__audible = () => [...(window.__voices ?? [])].some((a) => !a.paused && !a.muted);
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this.src.startsWith('blob:')) window.__voices = new Set([...(window.__voices ?? []), this]);
      return play.call(this);
    };
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(APP + '/?viewer', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  const card = page.getByRole('button', { name: /Watch A story from far away from Dad/ }).first();
  await card.waitFor({ timeout: 30000 });
  await card.click();
  await page.waitForFunction(() => __sp.get('PerformancePlayer', 'position') > 1, null, { timeout: 30000 });
  await page.mouse.move(400, 300);
  await page.getByRole('button', { name: 'Join in with your hands' }).click();
  await page.getByRole('button', { name: 'Allow camera' }).click().catch(() => undefined);
  const turn = await page.waitForFunction(() => __sp.get('PerformancePlayer', 'inJoinIn'), null, { timeout: 120000, polling: 200 }).then(() => true, () => false);

  // 1. The turn waits (the instruction said, then quiet): sample what is heard for 8 s.
  await sleep(6000);
  const heard = [];
  for (let i = 0; i < 16; i++) {
    heard.push(await page.evaluate(() => ({ audible: window.__audible(), paused: [...(window.__voices ?? [])].some((a) => a.paused), at: Math.round(([...(window.__voices ?? [])][0]?.currentTime ?? 0) * 10) / 10 })));
    await sleep(500);
  }
  const audibleWhileWaiting = heard.filter((h) => h.audible).length;
  check('while the turn waits for the child\'s shape, the recording is not heard going on (and is not paused)', turn && audibleWhileWaiting === 0 && heard.every((h) => !h.paused), { turn, audibleWhileWaiting, of: heard.length, first: heard[0], last: heard.at(-1) });

  // 2. The child's shape, then the turn ends: heard again.
  const target = await page.evaluate(() => __sp.get('ShapeRecognizer', 'target'));
  await page.evaluate((t) => {
    __sp.set('ShapeRecognizer', 'matchedHand', 'right');
    __sp.set('ShapeRecognizer', 'matchedShape', t);
  }, target);
  const back = await page.waitForFunction(() => !__sp.get('PerformancePlayer', 'inJoinIn'), null, { timeout: 90000, polling: 250 }).then(() => true, () => false);
  const again = await page.waitForFunction(() => window.__audible(), null, { timeout: 15000, polling: 200 }).then(() => true, () => false);
  check('after the child\'s shape and the turn, the voice is heard again', back && again, { back, again, target });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed || errors.length) process.exitCode = 1;
