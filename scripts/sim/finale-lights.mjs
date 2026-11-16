// The light comes home at the finale: in each scenery without a finale of its
// own, the released light lights the scene (stars come out in the open sky and
// through the parting rain clouds, fireflies rise from the meadow, a silver path
// on the river, glowing mushrooms and fireflies in the forest), as the lighthouse
// wakes by the sea. Then Counting Stars played to its end lights the sky. Saves a
// screenshot of each.
//
//   node scripts/sim/finale-lights.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { MEDIA_DIR } from './media.mjs';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const OUT = join(MEDIA_DIR, `finale-lights-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(OUT, { recursive: true });
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
const lights = () => page.evaluate(() => __sp.view().finaleLights);
await page.goto(APP + '/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
await sleep(1500);
await page.getByRole('button', { name: /Enter XR/i }).click();
await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().ready, null, { timeout: 30000 });
const centre = await page.evaluate(() => __sp.view().center);
await page.evaluate((t) => IWER_DEVICE.remote.dispatch('look_at', { device: 'headset', target: { x: t[0], y: t[1], z: t[2] } }), centre);

// Each scenery, its finale played by hand (the story is held at its first beat).
const KIND = { none: 'sky', storm: 'sky', field: 'field', river: 'river', forest: 'forest', sea: '' };
for (const [set, kind] of Object.entries(KIND)) {
  await page.evaluate(() => __sp.set('Stage', 'finale', 0));
  await sleep(2500);
  await page.evaluate((set) => __sp.set('Scenery', 'set', set), set);
  await sleep(2200);
  const before = await lights();
  for (let i = 1; i <= 20; i++) {
    await page.evaluate((f) => __sp.set('Stage', 'finale', f), i / 20);
    await sleep(150);
  }
  await sleep(600);
  const after = await lights();
  await page.screenshot({ path: join(OUT, `${set}.png`) });
  const ok = kind ? before.lit === 0 && after.kind === kind && after.lit >= 0.95 : after.kind === '';
  check(kind ? `${set}: dark before the finale, ${kind} lights after` : `${set}: its own finale (the lighthouse), none added`, ok, { before, after });
}
await page.evaluate(() => __sp.set('Stage', 'finale', 0));
await sleep(2500);
check('a new story clears them', (await lights()).lit === 0, await lights());

// A real ending: Counting Stars lets its last star go back to the sky.
await page.evaluate(() => {
  __sp.set('StoryState', 'script', 'story/counting-stars.story.json');
  __sp.set('DemoDirector', 'persona', 'perfect');
  __sp.set('DemoDirector', 'playing', true);
});
await page.waitForFunction(() => __sp.get('StoryState', 'beatId') === 'stars-five', null, { timeout: 420000, polling: 250 });
await sleep(1000);
const end = await lights();
await page.evaluate((t) => IWER_DEVICE.remote.dispatch('look_at', { device: 'headset', target: { x: t[0], y: t[1], z: t[2] } }), centre);
await sleep(500);
await page.screenshot({ path: join(OUT, 'counting-stars-end.png') });
check('Counting Stars: the star let go lights the sky with stars', end.kind === 'sky' && end.lit >= 0.95, end);
console.log(`screenshots: ${OUT}`);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
