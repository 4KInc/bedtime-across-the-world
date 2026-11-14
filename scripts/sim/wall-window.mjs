// The wall opens: closed during the story; at the finale a window opens in the
// wall into the story's world (hills under a starry sky) and stays open at The
// End; it closes when a new story starts. On a real wall (simulated Room Setup
// planes). Saves screenshots from the front and from one side (parallax, and
// nothing drawn outside the window).
//
//   node scripts/sim/wall-window.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { MEDIA_DIR } from './media.mjs';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const OUT = join(MEDIA_DIR, `wall-window-${new Date().toISOString().replace(/[:.]/g, '-')}`);
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
const win = () => page.evaluate(() => __sp.view().wallWindow);
const remote = (m, p) => page.evaluate(([m, p]) => IWER_DEVICE.remote.dispatch(m, p), [m, p]);
await page.goto(APP + '/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
await sleep(1500);
await page.getByRole('button', { name: /Enter XR/i }).click();
await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().ready, null, { timeout: 30000 });

// On a real wall.
const eye = (await page.evaluate(() => __sp.view())).head[1];
await page.evaluate((y) => {
  const wall = { orientation: 'vertical', label: 'wall', point: { x: 0, y: y - 0.2, z: -2 }, normal: { x: 0, y: 0, z: 1 },
    corners: [[-2, -1.3], [2, -1.3], [2, 1.3], [-2, 1.3]].map(([x, dy]) => ({ x, y: y - 0.2 + dy, z: -2 })) };
  __sp.room([wall]);
  __sp.set('Stage', 'replaceRequested', true);
}, eye);
await page.waitForFunction(() => __sp.get('Stage', 'mode') === 'wall', null, { timeout: 15000 }).catch(() => {});

await page.evaluate(() => {
  __sp.set('StoryState', 'script', 'story/counting-stars.story.json');
  __sp.set('DemoDirector', 'persona', 'perfect');
  __sp.set('DemoDirector', 'playing', true);
});
await page.waitForFunction(() => __sp.get('StoryState', 'beatId') === 'stars-one', null, { timeout: 60000 });
const during = await win();
check('closed during the story', during.open === 0, during);

await page.waitForFunction(() => __sp.get('StoryState', 'beatId') === 'stars-end', null, { timeout: 360000, polling: 250 });
await page.evaluate(() => __sp.set('DemoDirector', 'playing', false));
await sleep(1500);
const end = await win();
check('at the finale the window opens, and stays open at The End', end.open === 1, end);

// Look at it: from the front, then from a step to the side.
const c = await page.evaluate(() => __sp.view().center);
console.log(`stage mode: ${await page.evaluate(() => __sp.get('Stage', 'mode'))}, centre ${c}`);
const target = c ? { x: c[0], y: c[1], z: c[2] } : { x: 0, y: eye - 0.2, z: -2 };
await remote('look_at', { device: 'headset', target });
await sleep(800);
await page.screenshot({ path: join(OUT, 'front.png') });
console.log(`screenshot: ${join(OUT, 'front.png')}`);
await remote('set_transform', { device: 'headset', position: { x: 0.6, y: eye, z: 0 } }).catch(() => undefined);
await remote('look_at', { device: 'headset', target });
await sleep(800);
await page.screenshot({ path: join(OUT, 'side.png') });
console.log(`screenshot: ${join(OUT, 'side.png')}`);

// A new story: it closes.
await page.evaluate(() => __sp.set('StoryState', 'script', 'story/the-brave-little-dog.story.json'));
await sleep(2500);
const next = await win();
check('a new story: the window closes', next.open === 0, next);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
