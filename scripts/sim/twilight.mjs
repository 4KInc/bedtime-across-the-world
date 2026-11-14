// Twilight on the wall: coloured light (indigo above, warm below) behind the
// shadows, following the story's scene (Counting Stars goes to the sea: ocean
// blue to teal), off when the lamp is switched off, and off in high contrast.
// Saves a screenshot at the sea.
//
//   node scripts/sim/twilight.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { MEDIA_DIR } from './media.mjs';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const OUT = join(MEDIA_DIR, `twilight-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};
const errors = [];
const near = (hex, want, tol = 24) => {
  const a = parseInt(hex, 16);
  const b = parseInt(want, 16);
  return [16, 8, 0].every((s) => Math.abs(((a >> s) & 255) - ((b >> s) & 255)) <= tol);
};
const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })).newPage();
page.on('pageerror', (e) => errors.push(String(e)));
const sky = () => page.evaluate(() => __sp.view().twilight);
await page.goto(APP + '/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
await sleep(1500);
await page.getByRole('button', { name: /Enter XR/i }).click();
await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().ready, null, { timeout: 30000 });
await page.evaluate(() => {
  __sp.set('DemoDirector', 'persona', 'perfect');
  __sp.set('DemoDirector', 'playing', true);
});
await page.waitForFunction(() => __sp.get('StoryState', 'beatId') === 'stars-one', null, { timeout: 60000 });
await sleep(2500);
const night = await sky();
check('the night sky glows on the wall while the lamp is lit', near(night.top, '3d3ab0') && night.intensity > 0.3, night);
await page.waitForFunction(() => __sp.get('StoryState', 'beatId') === 'stars-sea-text', null, { timeout: 90000 });
await sleep(3500);
const sea = await sky();
await page.screenshot({ path: join(OUT, 'sea.png') });
console.log(`screenshot: ${join(OUT, 'sea.png')}`);
check('at the sea it turns ocean blue to teal', near(sea.top, '1f6fb8') && near(sea.bottom, '2cc5b5'), sea);
// The same sea on a real wall (simulated Room Setup planes): coloured lamp light, no paper.
const eye = (await page.evaluate(() => __sp.view())).head[1];
await page.evaluate((y) => {
  const wall = { orientation: 'vertical', label: 'wall', point: { x: 0, y: y - 0.2, z: -2 }, normal: { x: 0, y: 0, z: 1 },
    corners: [[-2, -1.3], [2, -1.3], [2, 1.3], [-2, 1.3]].map(([x, dy]) => ({ x, y: y - 0.2 + dy, z: -2 })) };
  __sp.room([wall]);
  __sp.set('Stage', 'replaceRequested', true);
}, eye);
await page.waitForFunction(() => __sp.get('Stage', 'mode') === 'wall', null, { timeout: 15000 }).catch(() => {});
await sleep(2500);
await page.screenshot({ path: join(OUT, 'sea-on-a-wall.png') });
console.log(`screenshot: ${join(OUT, 'sea-on-a-wall.png')}`);
await page.evaluate(() => __sp.set('Stage', 'lampOn', false));
await sleep(500);
const dark = await sky();
check('the lamp switched off: no sky', dark.intensity === 0, dark);
await page.evaluate(() => {
  __sp.set('Stage', 'lampOn', true);
  __sp.set('Settings', 'highContrast', true);
});
await sleep(800);
const contrast = await sky();
check('high contrast: no sky', contrast.intensity === 0, contrast);
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
