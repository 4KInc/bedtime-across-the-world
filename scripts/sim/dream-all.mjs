// "Dream a new one" offers every shape on one page. On a Quest 3 (Nov 17), with
// this many creatures, the chooser did not show them all (a place's own row
// shows at most three). Now "All shapes..." opens a page with all twenty:
//   1. the page shows every shape, and the chooser's other rows make way for it;
//   2. four shapes picked there, from any world, in story order, and "Picked: ..." says so; a fifth is refused;
//   3. Done goes back, Dream it: Mo is asked for exactly those four, in that order.
// Saves a screenshot of the page.
//
//   node scripts/sim/dream-all.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { assembleStory, checkDream } from '../../server/dream.ts';
import { cannedWords } from '../../tests/fixtures/dream-words.mjs';
import { MEDIA_DIR } from './media.mjs';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const OUT = join(MEDIA_DIR, `dream-all-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(OUT, { recursive: true });
const ALL = ['rabbit', 'fish', 'dog', 'bird', 'cup', 'snail', 'swan', 'deer', 'crocodile', 'shark', 'octopus', 'whale', 'rocket', 'alien', 'asteroid', 'car', 'plane', 'digger', 'trex', 'pterodactyl'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};
const errors = [];

const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
  const asked = [];
  await context.route('**/api/dream', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ json: { available: true } });
    const body = checkDream(JSON.parse(req.postData() ?? '{}'));
    asked.push(body);
    if (!body) return route.fulfill({ status: 400, json: { error: 'bad' } });
    return route.fulfill({ json: assembleStory(body, cannedWords(body.shapes)) });
  });
  await context.route('**/api/coach', (route) => route.fulfill({ json: { available: false } }));
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  const remote = (m, p) => page.evaluate(([m, p]) => IWER_DEVICE.remote.dispatch(m, p), [m, p]);
  const pinch = async (id) => {
    await page.evaluate(() => __sp.set('ShadowJournal', 'open', true));
    await sleep(700);
    await remote('set_input_mode', { mode: 'hand' });
    await sleep(300);
    const t = await page.evaluate((id) => __sp.where(id), id);
    await remote('look_at', { device: 'hand-right', target: { x: t[0], y: t[1], z: t[2] } });
    await sleep(300);
    await remote('set_select_value', { device: 'hand-right', value: 1 });
    await sleep(250);
    await remote('set_select_value', { device: 'hand-right', value: 0 });
    await sleep(400);
  };
  const chooser = () => page.evaluate(() => __sp.view().dream.chooser);
  await page.goto(APP + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await sleep(1500);
  await page.getByRole('button', { name: /Enter XR/i }).click();
  await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().head[1] > 1 && window.__sp.view().ready, null, { timeout: 30000 });
  await sleep(1500);

  // 1. The page.
  await pinch('story-dream');
  await pinch('dream-all-open');
  const opened = await chooser();
  const shown = await page.evaluate((ids) => ids.filter((id) => __sp.where(`dream-all-${id}`) !== null).length, ALL);
  check('All shapes... shows every shape, the chooser\'s other rows making way', opened.open && opened.all && shown === ALL.length, { open: opened.open, all: opened.all, shown, of: ALL.length });

  // 2. Four from any world, in order; a fifth refused.
  for (const s of opened.shapes) await pinch(`dream-all-${s}`);
  for (const s of ['trex', 'whale', 'rocket', 'rabbit', 'car']) await pinch(`dream-all-${s}`);
  const picked = await chooser();
  const t = await page.evaluate(() => __sp.where('dream-all-done'));
  await remote('look_at', { device: 'headset', target: { x: t[0], y: t[1] + 0.25, z: t[2] } });
  await sleep(800);
  await page.screenshot({ path: join(OUT, 'all-shapes.png') });
  check('four picked there, from any world, in story order; a fifth refused', picked.shapes.join() === 'trex,whale,rocket,rabbit', picked);

  // 3. Done, then Dream it.
  await pinch('dream-all-done');
  const back = await chooser();
  await pinch('dream-go');
  await page.waitForFunction(() => __sp.view().dream.ready, null, { timeout: 20000 }).catch(() => undefined);
  const last = asked.at(-1);
  check('Done goes back to the chooser; Dream it asks Mo for exactly those four, in order', back.open && !back.all && last?.shapes.join() === 'trex,whale,rocket,rabbit', { back: { open: back.open, all: back.all }, asked: last });
} finally {
  await browser.close();
}
console.log(`screenshots: ${OUT}`);
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed || errors.length) process.exitCode = 1;
