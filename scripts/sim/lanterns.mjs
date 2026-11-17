// Creatures step into the room: when a woken creature is let go, a paper
// lantern of it hops off the wall and lands on the desk between the Shadow
// Journal and the lamp, and stays; at most three; they leave when another
// story starts. Saves a screenshot of the desk.
//
//   node scripts/sim/lanterns.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { MEDIA_DIR } from './media.mjs';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const OUT = join(MEDIA_DIR, `lanterns-${new Date().toISOString().replace(/[:.]/g, '-')}`);
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
const lan = () => page.evaluate(() => __sp.view().lanterns);
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

// The first creature let go hops off the wall onto the desk.
const hopped = await page.waitForFunction(() => __sp.view().lanterns.hopping > 0, null, { timeout: 240000, polling: 100 }).then(() => true, () => false);
const mid = await lan();
await page.waitForFunction(() => __sp.view().lanterns.onDesk.length > 0, null, { timeout: 5000 }).catch(() => undefined);
await sleep(300);
const landed = await lan();
const book = await page.evaluate(() => __sp.where('journal-cover-top'));
const lampY = await page.evaluate(() => __sp.view().deskY);
const fromBook = Math.hypot(landed.last[0] - book[0], landed.last[2] - book[2]);
check('a creature let go hops off the wall and lands on the desk beside the Journal', hopped && landed.onDesk.length === 1 && Math.abs(landed.last[1] - (lampY + 0.07)) < 0.02 && fromBook < 0.4, { mid, landed, lampY, fromBook: +fromBook.toFixed(3) });

// The rest of the story: they stay, never more than four.
await page.waitForFunction(() => __sp.get('StoryState', 'beatId') === 'stars-end', null, { timeout: 360000, polling: 250 });
await page.evaluate(() => __sp.set('DemoDirector', 'playing', false));
await sleep(2500);
const end = await lan();
check('they stay on the desk to the end (at most four)', end.onDesk.length >= 1 && end.onDesk.length <= 4 && new Set(end.onDesk).size === end.onDesk.length, end);
// Side by side, never touching (Quest 3, Nov 15: they overlapped).
check('lanterns on the desk never touch (centres at least 15 cm apart)', end.onDesk.length >= 2 && end.gap >= 0.15, { gap: end.gap, onDesk: end.onDesk });

const t = end.last;
await page.evaluate((t) => IWER_DEVICE.remote.dispatch('look_at', { device: 'headset', target: { x: t[0], y: t[1], z: t[2] } }), t);
await sleep(800);
await page.screenshot({ path: join(OUT, 'desk.png') });
console.log(`screenshot: ${join(OUT, 'desk.png')}`);

// Another story: they leave.
await page.evaluate(() => __sp.set('StoryState', 'script', 'story/the-brave-little-dog.story.json'));
await sleep(2500);
const next = await lan();
check('another story: the desk is clear again', next.onDesk.length === 0 && next.hopping === 0, next);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
