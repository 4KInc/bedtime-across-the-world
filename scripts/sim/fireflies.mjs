// Fireflies: when a creature wakes, glowing specks in its colour leave the wall
// and drift out into the room toward the storyteller, then fade away. Saves one
// screenshot just after a wake.
//
//   node scripts/sim/fireflies.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { MEDIA_DIR } from './media.mjs';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const OUT = join(MEDIA_DIR, `fireflies-${new Date().toISOString().replace(/[:.]/g, '-')}`);
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
const ff = () => page.evaluate(() => __sp.view().fireflies);
await page.goto(APP + '/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
await sleep(1500);
await page.getByRole('button', { name: /Enter XR/i }).click();
await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().ready, null, { timeout: 30000 });
const before = await ff();
check('no fireflies before anything wakes', before.active === 0 && before.released === 0, before);
await page.evaluate(() => {
  __sp.set('DemoDirector', 'persona', 'perfect');
  __sp.set('DemoDirector', 'playing', true);
});
await page.waitForFunction(() => __sp.view().fireflies.released > 0, null, { timeout: 90000 });
await sleep(400);
const just = await ff();
await page.screenshot({ path: join(OUT, 'fireflies.png') });
console.log(`screenshot: ${join(OUT, 'fireflies.png')}`);
await sleep(1600);
const later = await ff();
check('a wake sends fireflies off the wall into the room', just.released >= 12 && just.active > 0 && later.furthest > just.furthest && later.furthest > 0.2, { just, later });
await page.evaluate(() => __sp.set('DemoDirector', 'playing', false));
await sleep(6000);
const gone = await ff();
check('they fade and are gone within a few seconds', gone.active === 0, gone);
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
