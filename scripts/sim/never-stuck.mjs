// Never stuck, with real-looking hands: a player who never makes the bird (a
// fist, with a 1 cm hand tremor like real tracking) still gets the bird after
// the story's last assist (45 s): a hand held still in the light. The old
// frame-to-frame speed test never saw a shaky hand as still (Quest 3, Nov 14).
//
//   node scripts/sim/never-stuck.mjs [--gpu]
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
  __sp.set('StoryState', 'script', 'story/counting-stars.story.json');
  __sp.set('DemoDirector', 'persona', 'perfect');
  __sp.set('DemoDirector', 'playing', true);
});
await page.waitForFunction(() => __sp.get('StoryState', 'beatId') === 'stars-want-bird', null, { timeout: 90000 });
await page.evaluate(() => __sp.set('DemoDirector', 'persona', 'stuck'));
const t0 = Date.now();
let maxAssist = 0;
let woke = false;
while (Date.now() - t0 < 100000) {
  const s = await page.evaluate(() => ({ beat: __sp.get('StoryState', 'beatId'), assist: __sp.get('StoryState', 'assist') }));
  maxAssist = Math.max(maxAssist, s.assist ?? 0);
  if (s.beat !== 'stars-want-bird') {
    woke = true;
    break;
  }
  await sleep(250);
}
const seconds = +((Date.now() - t0) / 1000).toFixed(1);
check('a shaky hand that never makes the bird still gets it after the last assist (about 45 s)', woke && maxAssist === 3 && seconds >= 42 && seconds <= 60, { woke, seconds, maxAssist });

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
