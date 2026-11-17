// Every creature of a story stays on the desk. A dreamed story can have four
// creatures; on a Quest 3 (Nov 17) the desk had three places, so the fourth one
// let go took the first one's place. A dreamed story with a T. rex, a dog, a
// rabbit and a bird (as that night), played to the end:
//   1. all four are on the desk at the end, each once;
//   2. side by side, never touching (centres at least 15 cm apart);
//   3. all on the desk, in front of the wall (none left in the air).
//
//   node scripts/sim/desk-four.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { chromium } from 'playwright';
import { assembleStory, checkDream } from '../../server/dream.ts';
import { cannedWords } from '../../tests/fixtures/dream-words.mjs';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const FOUR = ['trex', 'dog', 'rabbit', 'bird'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};
const errors = [];
const remote = (page, m, p) => page.evaluate(([m, p]) => IWER_DEVICE.remote.dispatch(m, p), [m, p]);
async function pinch(page, id) {
  await page.evaluate(() => __sp.set('ShadowJournal', 'open', true));
  await sleep(1000);
  await remote(page, 'set_input_mode', { mode: 'hand' });
  await sleep(400);
  const t = await page.evaluate((id) => __sp.where(id), id);
  await remote(page, 'look_at', { device: 'hand-right', target: { x: t[0], y: t[1], z: t[2] } });
  await sleep(300);
  await remote(page, 'set_select_value', { device: 'hand-right', value: 1 });
  await sleep(250);
  await remote(page, 'set_select_value', { device: 'hand-right', value: 0 });
  await sleep(400);
}

const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
  // The dream is answered here by the server's own story builder, with these four creatures.
  await context.route('**/api/dream', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ json: { available: true } });
    const body = checkDream({ ...JSON.parse(req.postData() ?? '{}'), shapes: FOUR });
    if (!body) return route.fulfill({ status: 400, json: { error: 'bad' } });
    return route.fulfill({ json: assembleStory(body, cannedWords(body.shapes)) });
  });
  await context.route('**/api/coach', (route) => route.fulfill({ json: { available: false } }));
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(APP + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await sleep(1500);
  await page.getByRole('button', { name: /Enter XR/i }).click();
  await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().head[1] > 1 && window.__sp.view().ready, null, { timeout: 30000 });
  await sleep(2000);
  await pinch(page, 'story-dream');
  await pinch(page, 'dream-go');
  await page.waitForFunction(() => /^dreamed:/.test(__sp.get('StoryState', 'script')) && __sp.get('StoryState', 'beatId')?.startsWith('dream-'), null, { timeout: 20000 });
  const shapes = await page.evaluate(() => __sp.view().dream?.shapes ?? []);
  await page.evaluate(() => {
    __sp.set('ShadowJournal', 'open', false);
    __sp.set('DemoDirector', 'persona', 'perfect');
    __sp.set('DemoDirector', 'playing', true);
  });
  // Every creature that reaches the desk, as it happens.
  const seen = new Set();
  const until = Date.now() + 360000;
  while (Date.now() < until && (await page.evaluate(() => __sp.get('StoryState', 'beatId'))) !== 'dream-end') {
    for (const s of await page.evaluate(() => __sp.view().lanterns.onDesk)) seen.add(s);
    await sleep(500);
  }
  await page.evaluate(() => __sp.set('DemoDirector', 'playing', false));
  await sleep(2500);
  const end = await page.evaluate(() => ({ ...__sp.view().lanterns, desk: __sp.view().desk }));
  const want = FOUR.filter((s) => seen.has(s));
  check('a four-creature story: all four on the desk at the end, each once', want.length === 4 && end.onDesk.length === 4 && FOUR.every((s) => end.onDesk.includes(s)) && new Set(end.onDesk).size === 4, { shapes, seen: [...seen], onDesk: end.onDesk });
  check('side by side, never touching (centres at least 15 cm apart)', end.gap >= 0.15, { gap: end.gap });
  check('all of them landed (none still hopping)', end.hopping === 0 && Math.abs(end.last[1] - end.deskY) < 0.15, { hopping: end.hopping, last: end.last, deskY: end.deskY });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed || errors.length) process.exitCode = 1;
