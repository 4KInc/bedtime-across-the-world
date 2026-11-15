// The lamp is behind you: the bulb stands about 65 cm behind the eyes, on a
// side table; the lamp's switch is on the desk; hands held where people hold
// them (38 cm ahead, a little low) throw their shadow onto the stage from the
// lamp itself, and the light is aimed through them once (calibration). Saves
// screenshots: the wall with the hands' shadows, and the lamp behind.
//
//   node scripts/sim/lamp-behind.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { MEDIA_DIR } from './media.mjs';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const OUT = join(MEDIA_DIR, `lamp-behind-${new Date().toISOString().replace(/[:.]/g, '-')}`);
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
const remote = (m, p) => page.evaluate(([m, p]) => IWER_DEVICE.remote.dispatch(m, p), [m, p]);
await page.goto(APP + '/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
await sleep(1500);
await page.getByRole('button', { name: /Enter XR/i }).click();
await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().ready, null, { timeout: 30000 });
await sleep(1000);

const v0 = await page.evaluate(() => ({ lamp: __sp.view().lamp, head: __sp.view().head, sw: __sp.where('desk-switch'), book: __sp.where('journal-cover-top'), table: __sp.where('lamp-side-table') }));
check('the bulb stands behind the viewer (about 65 cm back, a little low)', Math.abs(v0.lamp.behind - 0.65) < 0.05 && v0.lamp.below > 0.1 && v0.lamp.below < 0.5, v0.lamp);
check('the lamp switch is on the desk, beside the Shadow Journal', v0.sw && Math.abs(v0.sw[1] - (v0.book[1] - 0.026)) < 0.05 && Math.hypot(v0.sw[0] - v0.book[0], v0.sw[2] - v0.book[2]) < 0.6, { sw: v0.sw, book: v0.book });

// Hands where people hold them: the story's first beats (follow, the bird).
await page.evaluate(() => {
  __sp.set('StoryState', 'script', 'story/counting-stars.story.json');
  __sp.set('DemoDirector', 'persona', 'comfortable');
  __sp.set('DemoDirector', 'playing', true);
});
const calibrated = await page.waitForFunction(() => __sp.view().lamp.calibrated, null, { timeout: 60000 }).then(() => true, () => false);
await sleep(1500);
const v1 = await page.evaluate(() => __sp.view().lamp);
check('the light is aimed through the viewer\'s own hands (calibrated once)', calibrated && v1.behind > 0.6, v1);
// The bird, made with comfortable hands, flies Mo up (the carry needs the hands to steer it).
const t0 = Date.now();
const flew = await page.waitForFunction(() => ['stars-two', 'stars-bird-bows'].includes(__sp.get('StoryState', 'beatId')), null, { timeout: 120000, polling: 200 }).then(() => true, () => false);
check('comfortable hands wake the bird and fly it up with Mo', flew, { beat: await page.evaluate(() => __sp.get('StoryState', 'beatId')), seconds: Math.round((Date.now() - t0) / 1000) });
await page.screenshot({ path: join(OUT, 'wall.png') });
console.log(`screenshot: ${join(OUT, 'wall.png')}`);

// Look back at the lamp behind.
const b = v1.bulb;
await remote('look_at', { device: 'headset', target: { x: b[0], y: b[1] - 0.25, z: b[2] } });
await sleep(800);
await page.screenshot({ path: join(OUT, 'lamp-behind.png') });
console.log(`screenshot: ${join(OUT, 'lamp-behind.png')}`);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
