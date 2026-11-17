// The Pterodactyl's Sky Ride crosses a river: the scenery shows it. The story
// says "Now there is a river, with stepping stones" and the fish swims across
// it, but its scenery stayed the fern valley, which has no river (Nov 17: every
// story's scenery checked against its words). Told to The End by the demo player:
//   1. the valley, then the river while the fish swims across, then the valley again;
//   2. the little dinosaur still walks home into its cave at the finale.
// Saves a screenshot of the river crossing.
//
//   node scripts/sim/sky-ride-river.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { MEDIA_DIR } from './media.mjs';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const OUT = join(MEDIA_DIR, `sky-ride-river-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};
const errors = [];
const dist = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : NaN);

const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })).newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(APP + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await sleep(1500);
  await page.getByRole('button', { name: /Enter XR/i }).click();
  await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().head[1] > 1 && window.__sp.view().ready, null, { timeout: 30000 });
  await page.evaluate(() => IWER_DEVICE.remote.dispatch('set_input_mode', { mode: 'hand' }));
  await page.evaluate(() => __sp.set('StoryState', 'script', 'story/sky-ride.story.json'));
  await page.waitForFunction(() => __sp.get('StoryState', 'beatId')?.startsWith('sky-'), null, { timeout: 30000 });
  await page.evaluate(() => {
    __sp.set('DemoDirector', 'persona', 'perfect');
    __sp.set('DemoDirector', 'playing', true);
  });
  const order = [];
  let duringFish = '';
  let beat = '';
  let shot = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 420000) {
    const s = await page.evaluate(() => ({ beat: __sp.get('StoryState', 'beatId'), set: __sp.get('Scenery', 'set') }));
    beat = s.beat ?? '';
    if (s.set && s.set !== 'none' && order.at(-1) !== s.set) order.push(s.set);
    if (beat === 'sky-fish-carry') {
      duringFish = s.set;
      if (!shot) {
        shot = true;
        await sleep(1500);
        await page.screenshot({ path: join(OUT, 'river-crossing.png') });
      }
    }
    if (beat === 'sky-end') break;
    await sleep(250);
  }
  const end = await page.evaluate(() => [__sp.where('scenery-dino-valley-dino'), __sp.where('scenery-dino-valley-cave-door')]);
  check('the valley, then the river while the fish swims across, then the valley again; told to The End', beat === 'sky-end' && duringFish === 'river' && order.join() === 'dino-valley,river,dino-valley', { last: beat, order, duringFish });
  check('the little dinosaur still walks home into its cave at the finale', dist(end[0], end[1]) < 0.06, { home: +dist(end[0], end[1]).toFixed(3) });
} finally {
  await browser.close();
}
console.log(`screenshots: ${OUT}`);
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed || errors.length) process.exitCode = 1;
