// The storyteller's voice keeps playing on an iPad after a creature wakes. On an
// iPad (Nov 17) the narration went silent after the first shape while the story
// went on, watching and joining in alike. A creature's voice was an audio
// element; on iOS starting one audio element pauses the others, and a paused
// voice cannot start again without a tap. Here the page behaves as iOS does
// (a play() pauses every other playing media element; the recorded voice may
// play only once, from the tap), with the sample story from Dad:
//   1. watching: after the first creatures wake, the voice is still playing, and the creatures were heard (Web Audio);
//   2. joining in (Chromium's fake camera, a test pattern): after the child's creature and the turn, the voice plays on.
//
//   node scripts/sim/viewer-ios-voice.mjs [--gpu]
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
async function session(join) {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, ignoreHTTPSErrors: true, permissions: ['camera'] });
  await context.addInitScript(() => {
    // As iOS: one audio element at a time, and the recorded voice (a blob) may start only once, from the tap.
    const play = HTMLMediaElement.prototype.play;
    window.__media = { voicePlays: 0, refused: 0, pausedByOther: 0 };
    HTMLMediaElement.prototype.play = function () {
      if (this.src.startsWith('blob:')) {
        if (window.__media.voicePlays > 0 && this.paused) {
          window.__media.refused++;
          return Promise.reject(new DOMException('play() needs a tap', 'NotAllowedError'));
        }
        window.__media.voicePlays++;
      }
      if (!(this instanceof HTMLVideoElement)) {
        for (const other of window.__playing ?? []) {
          if (other !== this && !other.paused) {
            other.pause();
            window.__media.pausedByOther++;
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
  await card.click();
  await page.waitForFunction(() => __sp.get('PerformancePlayer', 'position') > 1, null, { timeout: 30000 });
  const voice = () => page.evaluate(() => ({ ...__sp.view().playbackVoice, pos: __sp.get('PerformancePlayer', 'position'), beat: __sp.get('StoryState', 'beatId'), media: { ...window.__media } }));
  return { context, page, voice };
}

try {
  // 1. Watching, to the second creature.
  {
    const { context, page, voice } = await session(false);
    await page.waitForFunction(() => Object.values(__sp.view().sound.creature).reduce((a, b) => a + b, 0) >= 2, null, { timeout: 120000, polling: 250 }).catch(() => undefined);
    await sleep(3000);
    const v = await voice();
    const sound = await page.evaluate(() => __sp.view().sound);
    check('watching: after the creatures wake the storyteller\'s voice is still playing, and the creatures were heard', !v.paused && v.gain > 0.5 && v.media.pausedByOther === 0 && sound.creatureByBuffer >= 1, { voice: v, creature: sound.creature, byBuffer: sound.creatureByBuffer, skipped: sound.creatureSkipped });
    await context.close();
  }
  // 2. Joining in: the child's creature, the turn, and the voice after it.
  {
    const { context, page, voice } = await session(true);
    await page.mouse.move(400, 300);
    await page.getByRole('button', { name: 'Join in with your hands' }).click();
    await page.getByRole('button', { name: 'Allow camera' }).click().catch(() => undefined);
    const turn = await page.waitForFunction(() => __sp.get('PerformancePlayer', 'inJoinIn'), null, { timeout: 120000, polling: 200 }).then(() => true, () => false);
    await sleep(3000);
    const target = await page.evaluate(() => __sp.get('ShapeRecognizer', 'target'));
    await page.evaluate((t) => {
      __sp.set('ShapeRecognizer', 'matchedHand', 'right');
      __sp.set('ShapeRecognizer', 'matchedShape', t);
    }, target);
    const back = await page.waitForFunction(() => !__sp.get('PerformancePlayer', 'inJoinIn'), null, { timeout: 90000, polling: 250 }).then(() => true, () => false);
    await sleep(2500);
    const v = await voice();
    check('joining in: after the child\'s creature and the turn, the storyteller\'s voice plays on', turn && back && !v.paused && v.gain > 0.9 && v.media.pausedByOther === 0, { turn, back, target, voice: v });
    await context.close();
  }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed || errors.length) process.exitCode = 1;
