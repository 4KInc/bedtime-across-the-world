// The child's camera keeps going through full screen. On an iPad (Nov 17)
// pressing the full-screen icon while joining in stopped the camera: the
// browser paused its preview (or ended the camera), and nothing started it
// again. With Join in on (Chromium's fake camera: a test pattern, no one's camera):
//   0. paused while the camera is still starting: it still comes on (it was taken for a failure);
//   1. the browser pauses the camera's preview: it plays again by itself;
//   2. the browser ends the camera: it is opened again (already allowed), playing a live camera;
//   3. the full-screen icon, on and off: the camera is still playing, live.
//
//   node scripts/sim/camera-fullscreen.mjs [--gpu]
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
  // 0. Paused while the camera is still starting (full screen pressed at once): it was taken for a
  // failure, and the camera turned off for good.
  await page.waitForFunction(() => [...document.querySelectorAll('video')].some((v) => v.srcObject), null, { timeout: 60000 });
  await page.evaluate(() => [...document.querySelectorAll('video')].find((x) => x.srcObject).pause());
  const started = await page.waitForFunction(() => __sp.get('WebcamHands', 'status') === 'Camera hands on.' && [...document.querySelectorAll('video')].some((v) => v.srcObject && !v.paused), null, { timeout: 60000 }).then(() => true, () => false);
  check('paused while starting: the camera still comes on, playing', started, { status: await page.evaluate(() => __sp.get('WebcamHands', 'status')), enabled: await page.evaluate(() => __sp.get('WebcamHands', 'enabled')) });
  const camera = () =>
    page.evaluate(() => {
      const v = [...document.querySelectorAll('video')].find((x) => x.srcObject);
      const track = v?.srcObject?.getVideoTracks()[0];
      return { playing: !!v && !v.paused, live: track?.readyState === 'live', id: track?.id ?? '' };
    });
  const before = await camera();

  // 1. Paused by the browser.
  await page.evaluate(() => [...document.querySelectorAll('video')].find((x) => x.srcObject).pause());
  // (In this software-rendered browser the hand model stalls timers for seconds; on a device it is 150 ms.)
  await page.waitForFunction(() => [...document.querySelectorAll('video')].some((v) => v.srcObject && !v.paused), null, { timeout: 10000 }).catch(() => undefined);
  const afterPause = await camera();
  check('the browser pauses the camera preview: it plays again by itself', before.playing && afterPause.playing && afterPause.live, { before, afterPause });

  // 2. Ended by the browser.
  await page.evaluate(() => {
    const track = [...document.querySelectorAll('video')].find((x) => x.srcObject).srcObject.getVideoTracks()[0];
    track.stop();
    track.dispatchEvent(new Event('ended'));
  });
  await page.waitForFunction((id) => {
    const v = [...document.querySelectorAll('video')].find((x) => x.srcObject);
    const t = v?.srcObject?.getVideoTracks()[0];
    return t && t.id !== id && t.readyState === 'live' && !v.paused;
  }, before.id, { timeout: 8000 }).catch(() => undefined);
  const afterEnd = await camera();
  check('the browser ends the camera: it is opened again, live and playing', afterEnd.playing && afterEnd.live && afterEnd.id !== before.id, { before: before.id, afterEnd });

  // 3. The full-screen icon, on and off.
  await page.mouse.move(420, 320);
  const corner = page.locator('.sp-fs-corner');
  await corner.click();
  await page.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 3000 }).catch(() => undefined);
  await sleep(800);
  const inFull = await camera();
  await page.mouse.move(440, 340);
  await corner.click();
  await sleep(800);
  const outFull = await camera();
  check('full screen on and off: the camera is still playing, live', inFull.playing && inFull.live && outFull.playing && outFull.live, { inFull, outFull });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed || errors.length) process.exitCode = 1;
