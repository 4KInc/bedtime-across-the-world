// "Raise an open hand into the light to go on", as people do it: a palm held up
// toward the wall, flat with the fingers together (the fish's pose), not spread.
// On a Quest 3 (Nov 16) The Moth's go-on steps waited 8 to 21 s for a
// spread-finger pose. The comfortable bot raises a flat hand: each step must go
// on within a few seconds.
//
//   node scripts/sim/raise-hand.mjs [--gpu]
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
const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })).newPage();
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(APP + '/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
await sleep(1500);
await page.getByRole('button', { name: /Enter XR/i }).click();
await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().ready, null, { timeout: 30000 });
await page.evaluate(() => {
  __sp.set('StoryState', 'script', 'story/the-moth.story.json');
  __sp.set('DemoDirector', 'persona', 'comfortable');
  __sp.set('DemoDirector', 'playing', true);
});

for (const step of ['go-on-1', 'go-on-2']) {
  const reached = await page.waitForFunction((s) => __sp.get('StoryState', 'beatId') === s, step, { timeout: 300000, polling: 100 }).then(() => true, () => false);
  if (!reached) {
    check(`${step}: a flat raised hand goes on`, false, { reached: false, beat: await page.evaluate(() => __sp.get('StoryState', 'beatId')) });
    continue;
  }
  // The caption is read first; then the hand counts.
  await page.waitForFunction(() => __sp.get('StoryState', 'voiceDone'), null, { timeout: 30000 }).catch(() => undefined);
  const t0 = Date.now();
  const hand = await page.evaluate(() => ({ shape: __sp.get('ShapeRecognizer', 'rightShape'), lit: __sp.get('ShapeRecognizer', 'rightInLight') }));
  const went = await page.waitForFunction((s) => __sp.get('StoryState', 'beatId') !== s, step, { timeout: 20000, polling: 100 }).then(() => true, () => false);
  const seconds = +((Date.now() - t0) / 1000).toFixed(1);
  check(`${step}: a flat raised hand (fingers together) goes on within 5 s`, went && seconds <= 5, { hand, seconds, went });
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
