// The storyteller's voice keeps playing on an iPad when the child joins in.
// On an iPad (Nov 17), joining in, the narration said the line after the
// child's shape and then stopped. iOS lets a page start its audio (an
// AudioContext) only inside a tap, and nothing started it at the tap on a
// story: so the voice was not routed through Web Audio, was paused between
// lines (the only way to quiet it without a gain node), and could not start
// again without a tap. Here the page behaves as iOS does, and the browser
// has no autoplay exception:
//   - an AudioContext created or resumed outside a tap stays suspended;
//   - starting one audio element pauses the others; the recorded voice plays only from a tap.
// With the sample story from Dad:
//   1. the tap on the story starts the audio, and the voice is routed through it;
//   2. joining in (Chromium's fake camera: a test pattern), after the child's creature and the turn, the voice plays on.
//
//   node scripts/sim/viewer-ios-audio.mjs [--gpu]
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

// No --autoplay-policy flag: as on an iPad, sound needs a tap.
const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
try {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, ignoreHTTPSErrors: true, permissions: ['camera'], hasTouch: true });
  await context.addInitScript(() => {
    window.__ios = { contextsSuspended: 0, resumesRefused: 0, voicePlays: 0, refused: 0, pausedByOther: 0 };
    // A tap counts only while its own handlers run (iOS), not for seconds after it (Chromium's transient activation).
    let tapping = false;
    for (const type of ['touchstart', 'touchend', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'keydown']) {
      window.addEventListener(type, () => {
        tapping = true;
        setTimeout(() => (tapping = false), 0);
      }, { capture: true });
    }
    const inTap = () => tapping;
    // iOS: an AudioContext made outside a tap starts suspended, and resume() works only inside one.
    const Real = window.AudioContext;
    window.AudioContext = class extends Real {
      constructor(...args) {
        super(...args);
        if (!inTap()) {
          window.__ios.contextsSuspended++;
          void super.suspend();
        }
      }
      resume() {
        if (!inTap()) {
          window.__ios.resumesRefused++;
          return Promise.resolve();
        }
        return super.resume();
      }
    };
    window.webkitAudioContext = window.AudioContext;
    // iOS: one audio element at a time, and the recorded voice (a blob) may start only from a tap, after its first.
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this.src.startsWith('blob:')) {
        if (window.__ios.voicePlays > 0 && this.paused && !inTap()) {
          window.__ios.refused++;
          return Promise.reject(new DOMException('play() needs a tap', 'NotAllowedError'));
        }
        window.__ios.voicePlays++;
      }
      if (!(this instanceof HTMLVideoElement)) {
        for (const other of window.__playing ?? []) {
          if (other !== this && !other.paused) {
            other.pause();
            window.__ios.pausedByOther++;
          }
        }
      }
      window.__playing = [...new Set([...(window.__playing ?? []), this])];
      return play.call(this);
    };
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(APP + '/?viewer', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  const card = page.getByRole('button', { name: /Watch A story from far away from Dad/ }).first();
  await card.waitFor({ timeout: 30000 });
  await card.tap();
  await page.waitForFunction(() => __sp.get('PerformancePlayer', 'position') > 2, null, { timeout: 30000 });
  const voice = () => page.evaluate(() => ({ ...__sp.view().playbackVoice, pos: __sp.get('PerformancePlayer', 'position'), beat: __sp.get('StoryState', 'beatId'), ios: { ...window.__ios } }));

  // 1. The tap started the audio; the voice goes through it.
  await sleep(1500);
  const start = await voice();
  check('the tap on the story starts the audio, and the storyteller\'s voice is routed through it', start.routed && !start.paused, start);

  // 2. Joining in.
  await page.mouse.move(400, 300);
  await page.getByRole('button', { name: 'Join in with your hands' }).tap();
  await page.getByRole('button', { name: 'Allow camera' }).tap().catch(() => undefined);
  const turn = await page.waitForFunction(() => __sp.get('PerformancePlayer', 'inJoinIn'), null, { timeout: 120000, polling: 200 }).then(() => true, () => false);
  await sleep(3000);
  const target = await page.evaluate(() => __sp.get('ShapeRecognizer', 'target'));
  await page.evaluate((t) => {
    __sp.set('ShapeRecognizer', 'matchedHand', 'right');
    __sp.set('ShapeRecognizer', 'matchedShape', t);
  }, target);
  const back = await page.waitForFunction(() => !__sp.get('PerformancePlayer', 'inJoinIn'), null, { timeout: 90000, polling: 250 }).then(() => true, () => false);
  // The recording's next lines: the voice is heard.
  let heard = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    const v = await voice();
    if (!v.paused && v.gain > 0.9) {
      heard = v;
      break;
    }
    await sleep(250);
  }
  const after = heard ?? (await voice());
  check('joining in: after the child\'s creature and the turn, the storyteller\'s voice plays on', turn && back && !!heard, { turn, back, target, after });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed || errors.length) process.exitCode = 1;
