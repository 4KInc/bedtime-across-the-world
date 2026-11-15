// Sound held back until a gesture. Entering XR from the browser's own prompt is
// not a gesture, so the headset refuses every sound until the first pinch
// (Quest 3S, Nov 15: the narrator silent for the first 50 s). Here the browser
// demands a gesture for sound and XR is entered without one:
//   1. the story stops on its first spoken line and asks for a pinch;
//   2. a gesture (a tap: the sim cannot make a trusted pinch) plays that same line, and the story goes on;
//   3. with no gesture, the story goes on with captions after about 10 s;
//   4. the headset's pinch (select) is listened for.
//
//   node scripts/sim/sound-unlock.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { chromium } from 'playwright';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const SOUND_CAPTION = /Pinch your thumb and finger together once to turn on the sound/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};
const errors = [];

async function open() {
  const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })).newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  // Every narration clip that actually started, and the session's pinch listeners.
  await page.addInitScript(() => {
    window.__started = [];
    // Headless Chromium plays sound regardless of --autoplay-policy (and page.evaluate
    // counts as a gesture), so the headset's rule is imitated: no playing until a real tap.
    window.__tapped = false;
    window.addEventListener('pointerdown', (e) => (window.__tapped ||= e.isTrusted), { capture: true });
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (!window.__tapped) return Promise.reject(new DOMException('no gesture yet', 'NotAllowedError'));
      const p = play.call(this);
      p.then(() => window.__started.push(this.src.split('/').pop()), () => undefined);
      return p;
    };
    window.__xrListeners = [];
    const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, ...rest) {
      if (typeof XRSession !== 'undefined' && this instanceof XRSession) window.__xrListeners.push(type);
      return add.call(this, type, ...rest);
    };
  });
  await page.goto(APP + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await sleep(1000);
  // Into XR with no gesture (a script click, like the browser's own Enter VR prompt).
  await page.getByRole('button', { name: /Enter XR/i }).evaluate((el) => el.click());
  await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && __sp.view().ready, null, { timeout: 30000 });
  await page.evaluate(() => {
    __sp.set('StoryState', 'script', 'story/counting-stars.story.json');
    __sp.set('DemoDirector', 'persona', 'comfortable');
    __sp.set('DemoDirector', 'playing', true);
  });
  return { browser, page };
}

const state = (page) =>
  page.evaluate(() => ({ beat: __sp.get('StoryState', 'beatId'), caption: __sp.get('StoryState', 'caption'), status: __sp.get('StoryState', 'status'), started: window.__started.slice() }));

// 1-2, 4: held, then a gesture.
{
  const { browser, page } = await open();
  const asked = await page.waitForFunction((re) => new RegExp(re).test(__sp.get('StoryState', 'caption') ?? ''), SOUND_CAPTION.source, { timeout: 60000, polling: 100 }).then(() => true, () => false);
  const s1 = await state(page);
  await sleep(3000);
  const s2 = await state(page);
  check('with sound held back, the story stops on its first line and asks for a pinch', asked && s1.beat === s2.beat && s2.started.length === 0, { beat: s2.beat, status: s2.status, started: s2.started });
  const listeners = await page.evaluate(() => window.__xrListeners);
  check("the headset's pinch and grip are listened for", listeners.includes('selectstart') && listeners.includes('squeezestart'), { listeners });
  await page.mouse.click(640, 400);
  const played = await page.waitForFunction(() => window.__started.length > 0, null, { timeout: 5000, polling: 100 }).then(() => true, () => false);
  await sleep(1500);
  const s3 = await state(page);
  check('a gesture plays the held line, from the beat that asked', played && s3.started[0] === `${s1.beat}.mp3` && !SOUND_CAPTION.test(s3.caption ?? ''), { started: s3.started, beat: s3.beat, caption: s3.caption?.slice(0, 50) });
  const moved = await page.waitForFunction((b) => __sp.get('StoryState', 'beatId') !== b, s1.beat, { timeout: 30000, polling: 200 }).then(() => true, () => false);
  check('and the story goes on', moved, { beat: (await state(page)).beat });
  await browser.close();
}

// 3: no gesture at all.
{
  const { browser, page } = await open();
  await page.waitForFunction((re) => new RegExp(re).test(__sp.get('StoryState', 'caption') ?? ''), SOUND_CAPTION.source, { timeout: 60000, polling: 100 });
  const s1 = await state(page);
  const t0 = Date.now();
  const moved = await page.waitForFunction((b) => __sp.get('StoryState', 'beatId') !== b, s1.beat, { timeout: 30000, polling: 200 }).then(() => true, () => false);
  const seconds = Math.round((Date.now() - t0) / 100) / 10;
  check('with no pinch, the story goes on with captions after about 10 s', moved && seconds >= 8 && seconds <= 20, { from: s1.beat, seconds });
  await sleep(4000);
  const s2 = await state(page);
  check('and is never asked again', !SOUND_CAPTION.test(s2.caption ?? '') && s2.status !== 'paused', { beat: s2.beat, status: s2.status });
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
