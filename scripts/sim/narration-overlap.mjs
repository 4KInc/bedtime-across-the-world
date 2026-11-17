// Narration never overlaps itself: one line at a time, in a dreamed story (the
// server's narrator voice, lines arriving with a delay) and a library story
// (recorded clips), with the shapes made quickly, while a request line is still
// being read. On the Quest 3 (Nov 15) a beat without words after a request (Mo
// climbing on) let go of the line still playing, so the next line played over it.
//
//   node scripts/sim/narration-overlap.mjs
// Needs the dev server (npm run dev) on https://localhost:8082.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { assembleStory, checkDream } from '../../server/dream.ts';
import { cannedWords } from '../../tests/fixtures/dream-words.mjs';
const CLIP = readFileSync(new URL('../../public/narration/kind-croc-yes.mp3', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
await context.route('**/api/speak*', async (route) => {
  const text = new URL(route.request().url()).searchParams.get('text');
  if (text === null) return route.fulfill({ json: { available: true } });
  await sleep(700 + Math.random() * 900);
  return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: CLIP });
});
await context.route('**/api/dream', async (route) => {
  const req = route.request();
  if (req.method() === 'GET') return route.fulfill({ json: { available: true } });
  const body = checkDream(JSON.parse(req.postData() ?? '{}'));
  return route.fulfill({ json: assembleStory(body, cannedWords(body.shapes)) });
});
await context.addInitScript(() => {
  window.__playing = new Set();
  window.__maxPlaying = 0;
  window.__overlaps = [];
  const orig = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const el = this;
    // Narration only: the creatures' voices (sfx files) are meant to play over a line.
    if (el.src.includes('/sfx/')) return orig.call(this);
    const mark = () => {
      window.__playing.add(el);
      if (window.__playing.size > 1) window.__overlaps.push([...window.__playing].map((e) => e.src.slice(-12)));
      window.__maxPlaying = Math.max(window.__maxPlaying, window.__playing.size);
    };
    const un = () => window.__playing.delete(el);
    el.addEventListener('playing', mark);
    el.addEventListener('pause', un);
    el.addEventListener('ended', un);
    return orig.call(this);
  };
});
const page = await context.newPage();

await page.goto('https://localhost:8082/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
await sleep(1500);
await page.getByRole('button', { name: /Enter XR/i }).click();
await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().head[1] > 1 && window.__sp.view().ready, null, { timeout: 30000 });
await sleep(2000);
const remote = (m, p) => page.evaluate(([m, p]) => IWER_DEVICE.remote.dispatch(m, p), [m, p]);
for (const id of ['story-dream', 'dream-go']) {
  await page.evaluate(() => __sp.set('ShadowJournal', 'open', true)); await sleep(1000);
  await remote('set_input_mode', { mode: 'hand' }); await sleep(400);
  const t = await page.evaluate((id) => __sp.where(id), id);
  await remote('look_at', { device: 'hand-right', target: { x: t[0], y: t[1], z: t[2] } }); await sleep(300);
  await remote('set_select_value', { device: 'hand-right', value: 1 }); await sleep(250);
  await remote('set_select_value', { device: 'hand-right', value: 0 }); await sleep(400);
}
// A dreamed story waits on its title, the Journal open, for Tell it (closing the Journal tells it too).
await page.waitForFunction(() => __sp.view().dream.ready, null, { timeout: 20000 });
await page.evaluate(() => __sp.set('ShadowJournal', 'open', false));
await page.evaluate(() => { __sp.set('DemoDirector', 'persona', 'perfect'); __sp.set('DemoDirector', 'playing', true); });
for (let i = 0; i < 90; i++) { await sleep(1000); if (await page.evaluate(() => __sp.get('StoryState', 'beatId')) === 'dream-end') break; }
const dreamed = await page.evaluate(() => ({ max: window.__maxPlaying, overlaps: window.__overlaps.length, beat: __sp.get('StoryState', 'beatId') }));
const results = [];
results.push(['a dreamed story (server voice): never two lines at once', dreamed.max === 1 && /dream-/.test(dreamed.beat), dreamed]);
// A library story with recorded clips, the shapes made at once.
await page.evaluate(() => {
  window.__maxPlaying = 0;
  window.__overlaps = [];
  __sp.set('DemoDirector', 'playing', false);
  __sp.set('StoryState', 'script', 'story/the-night-garden.story.json');
});
await page.waitForFunction(() => __sp.get('StoryState', 'beatId')?.startsWith('garden'), null, { timeout: 30000 });
await page.evaluate(() => { __sp.set('DemoDirector', 'persona', 'perfect'); __sp.set('DemoDirector', 'playing', true); });
for (let i = 0; i < 200; i++) { await sleep(1000); if (await page.evaluate(() => __sp.get('StoryState', 'beatId')) === 'garden-end') break; }
const library = await page.evaluate(() => ({ max: window.__maxPlaying, overlaps: window.__overlaps.length, beat: __sp.get('StoryState', 'beatId') }));
results.push(['a library story (recorded clips): never two lines at once', library.max === 1 && library.beat === 'garden-end', library]);
for (const [name, ok, detail] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
const failed = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
await browser.close();
if (failed) process.exitCode = 1;
