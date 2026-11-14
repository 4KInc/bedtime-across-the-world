// Keepsake stars: the jar stands on the desk beside the Shadow Journal; when a
// story is told to the end a star rises off the wall and floats into it, with
// the count and the story's name shown briefly; the star is still there after
// reloading (the next night). Saves a screenshot of the jar.
//
//   node scripts/sim/keepsakes.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { MEDIA_DIR } from './media.mjs';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const OUT = join(MEDIA_DIR, `keepsakes-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};
const errors = [];
const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
const keep = (page) => page.evaluate(() => __sp.view().keepsakes);

async function enter(page) {
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await sleep(1500);
  await page.getByRole('button', { name: /Enter XR/i }).click();
  // Placed on the desk (after a reload the stage first waits to restore last night's wall).
  await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().keepsakes.loaded && window.__sp.view().keepsakes.jar.some((n) => n !== 0), null, { timeout: 60000 });
  await sleep(500);
}

const page = await context.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(APP + '/', { waitUntil: 'load' });
await enter(page);

// The jar, empty, beside the book on the desk.
const start = await keep(page);
const book = await page.evaluate(() => __sp.where('journal-cover-top'));
const d = Math.hypot(start.jar[0] - book[0], start.jar[2] - book[2]);
check('an empty jar stands beside the Shadow Journal on the desk', start.count === 0 && d > 0.08 && d < 0.3 && Math.abs(start.jar[1] - book[1]) < 0.06, { start, book, apart: +d.toFixed(3) });

// Counting Stars told to the end: a star flies into the jar.
await page.evaluate(() => {
  __sp.set('StoryState', 'script', 'story/counting-stars.story.json');
  __sp.set('DemoDirector', 'persona', 'perfect');
  __sp.set('DemoDirector', 'playing', true);
});
const flew = await page.waitForFunction(() => __sp.view().keepsakes.flying, null, { timeout: 360000, polling: 100 }).then(() => true, () => false);
await page.waitForFunction(() => __sp.view().keepsakes.count === 1, null, { timeout: 10000 }).catch(() => undefined);
const after = await keep(page);
check('at the end a star flies off the wall into the jar, and the count shows', flew && after.count === 1 && /^1 story in the jar: Counting Stars/i.test(after.label), after);
await page.evaluate(() => __sp.set('DemoDirector', 'playing', false));

// Look at the jar for the screenshot.
const j = after.jar;
await page.evaluate((t) => IWER_DEVICE.remote.dispatch('look_at', { device: 'headset', target: { x: t[0], y: t[1] + 0.05, z: t[2] } }), j);
await sleep(800);
await page.screenshot({ path: join(OUT, 'jar.png') });
console.log(`screenshot: ${join(OUT, 'jar.png')}`);

// The next night: reload, and the star is still in the jar.
await page.reload({ waitUntil: 'load' });
await enter(page);
const next = await keep(page);
check('after reloading (the next night) the star is still in the jar', next.count === 1 && !next.flying, next);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
