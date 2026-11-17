// Join in on an iPad: the recorded voice comes back after the child's turn.
// iOS lets a page start audio only from a tap, so a voice paused at the
// child's turn could not be started again (Nov 17: on an iPad the narration
// stopped at the first shape; the music played on). Here the page refuses
// every play() after the first, as iOS does, and the voice must still be heard
// at the child's next line and when the recording takes over again.
//
//   node scripts/sim/join-in-voice.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { chromium } from 'playwright';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};
const errors = [];
const browser = await chromium.launch({
  args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, ignoreHTTPSErrors: true, permissions: ['camera'] });
await context.addInitScript(() => {
  // As iOS: the recorded voice starts from the tap, and no later play() is allowed without one.
  const play = HTMLMediaElement.prototype.play;
  window.__voicePlays = { ok: 0, refused: 0 };
  HTMLMediaElement.prototype.play = function () {
    if (this.src.startsWith('blob:')) {
      if (window.__voicePlays.ok > 0) {
        window.__voicePlays.refused++;
        return Promise.reject(new DOMException('play() needs a tap', 'NotAllowedError'));
      }
      window.__voicePlays.ok++;
    }
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
// Join in, and a grown-up allows the camera.
await page.mouse.move(400, 300);
await page.getByRole('button', { name: 'Join in with your hands' }).click();
await page.getByRole('button', { name: 'Allow camera' }).click().catch(() => undefined);
const turn = await page.waitForFunction(() => __sp.get('PerformancePlayer', 'inJoinIn'), null, { timeout: 120000, polling: 200 }).then(() => true, () => false);
const voice = () => page.evaluate(() => ({ ...__sp.view().playbackVoice, plays: { ...window.__voicePlays }, beat: __sp.get('StoryState', 'beatId') }));
// The performer finishes the instruction, then the voice fades.
await sleep(9000);
const quiet = await voice();
// The child's shape (the fake camera shows no hands): the creature wakes and the story goes on, line by line.
const target = await page.evaluate(() => __sp.get('ShapeRecognizer', 'target'));
await page.evaluate((t) => {
  __sp.set('ShapeRecognizer', 'matchedHand', 'right');
  __sp.set('ShapeRecognizer', 'matchedShape', t);
}, target);
let heardInTurn = null;
const t0 = Date.now();
while (Date.now() - t0 < 60000) {
  const v = await voice();
  if (v.gain > 0.5 && !v.paused) {
    heardInTurn = v;
    break;
  }
  await sleep(250);
}
check("the child's turn: the performer's voice is heard again at its next line, with no new play()", turn && heardInTurn !== null, { turn, quiet, heardInTurn, target });
const back = await page.waitForFunction(() => !__sp.get('PerformancePlayer', 'inJoinIn'), null, { timeout: 90000, polling: 250 }).then(() => true, () => false);
await sleep(1500);
const after = await voice();
check('after the turn the recording takes over, its voice playing', back && after.gain > 0.9 && !after.paused, { back, after });

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
