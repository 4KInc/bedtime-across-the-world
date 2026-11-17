// Record a dreamed story from its beginning. A dreamed story starts at once,
// so on a Quest 3 (Nov 17) Record could only be pressed a few lines in, and the
// recording missed its opening. Now Record pressed before a story's first
// shape starts the story again from its title:
//   1. a dream is told; a few lines in, Record: the story starts again from its title, recording;
//   2. the recording, saved at the end, is the whole story (from the title, its first beat);
//   3. Record pressed after the first shape has been asked for does not start the story again.
//
//   node scripts/sim/record-from-start.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { chromium } from 'playwright';
import { assembleStory, checkDream } from '../../server/dream.ts';
import { cannedWords } from '../../tests/fixtures/dream-words.mjs';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
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
const beat = (page) => page.evaluate(() => ({ id: __sp.get('StoryState', 'beatId'), index: __sp.get('StoryState', 'beatIndex'), recording: __sp.get('PerformanceRecorder', 'recording') }));

const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
  await context.route('**/api/dream', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ json: { available: true } });
    const body = checkDream(JSON.parse(req.postData() ?? '{}'));
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
  await page.evaluate(() => __sp.set('PerformanceRecorder', 'withVoice', false));
  await sleep(1500);

  // 1. A dream, a few lines in, then Record.
  await pinch(page, 'story-dream');
  await pinch(page, 'dream-go');
  await page.waitForFunction(() => /^dreamed:/.test(__sp.get('StoryState', 'script')) && __sp.get('StoryState', 'beatId')?.startsWith('dream-'), null, { timeout: 20000 });
  await page.evaluate(() => __sp.set('ShadowJournal', 'open', false));
  await page.waitForFunction(() => (__sp.get('StoryState', 'beatIndex') ?? 0) >= 3, null, { timeout: 30000 });
  const before = await beat(page);
  await pinch(page, 'record-button');
  const seen = [];
  for (let i = 0; i < 12; i++) {
    seen.push((await beat(page)).index);
    await sleep(200);
  }
  const after = await beat(page);
  check('Record a few lines into a dreamed story: it starts again from its title, recording', before.index >= 3 && seen.some((i) => i <= 0) && after.recording === true, { before, seen, after });

  // 2. Told to the end, and saved: the recording is the whole story.
  await page.evaluate(() => {
    __sp.set('ShadowJournal', 'open', false);
    __sp.set('DemoDirector', 'persona', 'perfect');
    __sp.set('DemoDirector', 'playing', true);
  });
  await page.waitForFunction(() => __sp.get('StoryState', 'beatId') === 'dream-end', null, { timeout: 360000, polling: 500 }).catch(() => undefined);
  await page.evaluate(() => __sp.set('DemoDirector', 'playing', false));
  await pinch(page, 'record-button');
  await page.waitForFunction(() => /^Saved/.test(__sp.get('PerformanceRecorder', 'status') ?? ''), null, { timeout: 30000 }).catch(() => undefined);
  const made = await page.evaluate(() => ({ ...__sp.view().recordings.made, status: __sp.get('PerformanceRecorder', 'status') }));
  const story = await page.evaluate(() => __sp.view().dream);
  check('the saved recording is the whole dreamed story, from its title to The End', /^Saved/.test(made.status ?? '') && made.saved === 1 && made.seconds >= 60, { made, title: story?.title });

  // 3. After the first shape has been asked for, Record does not start the story again.
  await pinch(page, 'story-dream');
  await pinch(page, 'dream-go');
  await page.waitForFunction(() => __sp.get('StoryState', 'script') === 'dreamed:2' && __sp.get('StoryState', 'beatId')?.startsWith('dream-'), null, { timeout: 20000 });
  await page.evaluate(() => {
    __sp.set('ShadowJournal', 'open', false);
    __sp.set('DemoDirector', 'persona', 'perfect');
    __sp.set('DemoDirector', 'playing', true);
  });
  await page.waitForFunction(() => /^dream-1-(ride|carry|after|bow)/.test(__sp.get('StoryState', 'beatId') ?? ''), null, { timeout: 120000, polling: 200 });
  await page.evaluate(() => __sp.set('DemoDirector', 'playing', false));
  const mid = await beat(page);
  await pinch(page, 'record-button');
  const lowest = [];
  for (let i = 0; i < 10; i++) {
    lowest.push((await beat(page)).index);
    await sleep(200);
  }
  check('Record after the first shape was asked for: the story goes on from where it is', Math.min(...lowest) >= mid.index && (await beat(page)).recording === true, { mid, lowest });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed || errors.length) process.exitCode = 1;
