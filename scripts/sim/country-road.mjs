// The Little Car's Long Way Home happens on a country road. On a Quest 3 (Nov 17,
// qdyraafjwa) the story told of a road, a little car and a house with a garage,
// but its scenery was the meadow: no road, no car, no garage. Now it has the
// country road: green hills and trees, the road, the little car (its headlights
// fading) and the house with a garage at the road's end. Told to The End by the
// demo player:
//   1. the country road is on the wall (not the meadow);
//   2. the little car follows Mo along the road, closer to the house as the story goes;
//   3. at the finale it drives home into the garage, and the house's window glows.
// Saves two screenshots (on the road; home).
//
//   node scripts/sim/country-road.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { MEDIA_DIR } from './media.mjs';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const OUT = join(MEDIA_DIR, `country-road-${new Date().toISOString().replace(/[:.]/g, '-')}`);
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
  await page.evaluate(() => __sp.set('StoryState', 'script', 'story/long-way-home.story.json'));
  await page.waitForFunction(() => __sp.get('StoryState', 'beatId')?.startsWith('lane-'), null, { timeout: 30000 });
  await page.evaluate(() => {
    __sp.set('DemoDirector', 'persona', 'perfect');
    __sp.set('DemoDirector', 'playing', true);
  });
  const sets = new Set();
  let start = null;
  let mid = null;
  let beat = '';
  let shot = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 420000) {
    const s = await page.evaluate(() => ({
      beat: __sp.get('StoryState', 'beatId'),
      set: __sp.get('Scenery', 'set'),
      car: __sp.where('scenery-country-road-car'),
      home: __sp.where('scenery-country-road-house-window'),
    }));
    beat = s.beat ?? '';
    if (s.set) sets.add(s.set);
    if (beat === 'lane-want-car' && !start) start = dist(s.car, s.home);
    if (beat === 'lane-dark' && !mid) mid = dist(s.car, s.home);
    if (beat === 'lane-digger-carry' && !shot) {
      shot = true;
      await sleep(1200);
      await page.screenshot({ path: join(OUT, 'on-the-road.png') });
    }
    if (beat === 'lane-end') break;
    await sleep(250);
  }
  const end = await page.evaluate(() => [__sp.where('scenery-country-road-car'), __sp.where('scenery-country-road-house-window')]);
  await page.screenshot({ path: join(OUT, 'home.png') });
  const home = dist(end[0], end[1]);
  check('The Little Car\'s Long Way Home is told to The End, on the country road', beat === 'lane-end' && sets.has('country-road') && !sets.has('field'), { last: beat, sets: [...sets] });
  check('the little car follows Mo along the road, closer to the house as the story goes, and drives home at the finale', start > mid && mid > home && home < start * 0.5, { start: +start?.toFixed(3), mid: +mid?.toFixed(3), home: +home.toFixed(3) });
} finally {
  await browser.close();
}
console.log(`screenshots: ${OUT}`);
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed || errors.length) process.exitCode = 1;
