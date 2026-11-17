// After the child's Join in turn, the recording carries on from there. On an
// iPad and a computer (Nov 17) the story started again from the beginning once
// the child's creature reached the shelf. The recording had been started
// before its story (Record, then a story picked), so its first event was the
// beat the stage was on then: the end of the story played before. When the
// turn ended, the player looked for the first beat at or after the one to
// rejoin at, found that one at 0:00, and went back there. Here the sample story
// from Dad gets such a first beat (its own last one, at 0:00):
//   1. playback does not open on that ending;
//   2. the child joins in (Chromium's fake camera: a test pattern, no one's camera) and makes the shape;
//   3. after the turn the recording goes on from the turn, never back to the start.
//
//   node scripts/sim/join-in-rejoin.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

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

// The sample, with the stale first beat a recording started before its story has.
const sample = JSON.parse(readFileSync(new URL('../../public/samples/story-from-dad.json', import.meta.url), 'utf8'));
const perf = sample.performance ?? sample;
const lastBeat = perf.events.filter((e) => e.type === 'beat').at(-1);
perf.events = [{ t: 0, type: 'beat', data: { ...lastBeat.data } }, ...perf.events];

const browser = await chromium.launch({
  args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
try {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, ignoreHTTPSErrors: true, permissions: ['camera'] });
  await context.route('**/samples/story-from-dad.json*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sample) }));
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(APP + '/?viewer', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  const card = page.getByRole('button', { name: /Watch A story from far away from Dad/ }).first();
  await card.waitFor({ timeout: 30000 });
  await card.click();

  // 1. The first seconds: never the old ending.
  const opening = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 4000) {
    opening.add(await page.evaluate(() => __sp.get('StoryState', 'beatId') ?? ''));
    await sleep(100);
  }
  check('playback does not open on the story-before\'s ending', !opening.has(lastBeat.data.id), { opening: [...opening], stale: lastBeat.data.id });

  // 2. Join in; the child's turn; the shape made.
  await page.mouse.move(400, 300);
  await page.getByRole('button', { name: 'Join in with your hands' }).click();
  await page.getByRole('button', { name: 'Allow camera' }).click().catch(() => undefined);
  const turn = await page.waitForFunction(() => __sp.get('PerformancePlayer', 'inJoinIn'), null, { timeout: 120000, polling: 200 }).then(() => true, () => false);
  const atTurn = await page.evaluate(() => ({ pos: __sp.get('PerformancePlayer', 'position'), beat: __sp.get('StoryState', 'beatId'), index: __sp.get('StoryState', 'beatIndex') }));
  await sleep(3000);
  const target = await page.evaluate(() => __sp.get('ShapeRecognizer', 'target'));
  await page.evaluate((t) => {
    __sp.set('ShapeRecognizer', 'matchedHand', 'right');
    __sp.set('ShapeRecognizer', 'matchedShape', t);
  }, target);

  // 3. After the turn: on from there, never back to the start.
  const back = await page.waitForFunction(() => !__sp.get('PerformancePlayer', 'inJoinIn'), null, { timeout: 90000, polling: 250 }).then(() => true, () => false);
  let lowest = { pos: Infinity, index: Infinity, beat: '' };
  const t1 = Date.now();
  while (Date.now() - t1 < 8000) {
    const s = await page.evaluate(() => ({ pos: __sp.get('PerformancePlayer', 'position'), index: __sp.get('StoryState', 'beatIndex'), beat: __sp.get('StoryState', 'beatId'), playing: __sp.get('PerformancePlayer', 'playing') }));
    if (s.playing && s.pos < lowest.pos) lowest = s;
    await sleep(200);
  }
  check('after the child\'s turn the recording goes on from there, never back to the start', turn && back && lowest.pos >= atTurn.pos && lowest.index > atTurn.index, { target, atTurn, lowestAfter: lowest });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed || errors.length) process.exitCode = 1;
