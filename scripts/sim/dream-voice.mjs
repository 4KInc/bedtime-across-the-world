// A dreamed story has a voice: its lines have no recorded clip, so the
// narrator asks the server to speak them (/api/speak, Google Text-to-Speech in
// production; here a stand-in that answers with a real clip and counts the
// lines), with the child's name, and fetches the next lines ahead. Library
// stories keep their recorded clips. Without a voice on the server the story
// still runs (captions and reading time).
//
//   node scripts/sim/dream-voice.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { assembleStory, checkDream } from '../../server/dream.ts';
import { cannedWords } from '../../tests/fixtures/dream-words.mjs';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const CLIP = readFileSync(new URL('../../public/narration/garden-hello.mp3', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};
const errors = [];
const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });

async function session(voice) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
  const spoken = [];
  await context.route('**/api/speak*', async (route) => {
    const text = new URL(route.request().url()).searchParams.get('text');
    if (text === null) return route.fulfill({ json: { available: voice } });
    spoken.push(text);
    return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: CLIP, headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } });
  });
  await context.route('**/api/dream', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ json: { available: true } });
    const body = checkDream(JSON.parse(req.postData() ?? '{}'));
    return route.fulfill({ json: assembleStory(body, cannedWords(body.shapes)) });
  });
  await context.route('**/api/coach', (route) => route.fulfill({ json: { available: false } }));
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(APP + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  // The family's names (as the first screen saves them), then a fresh start.
  await page.evaluate(() => new Promise((resolve) => {
    const q = indexedDB.open('shadowplay');
    q.onsuccess = () => {
      const tx = q.result.transaction('progress', 'readwrite');
      tx.objectStore('progress').put({ child: 'Mia', performer: 'Dad' }, 'family');
      tx.oncomplete = () => resolve(true);
    };
  }));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await sleep(1500);
  await page.getByRole('button', { name: /Enter XR/i }).click();
  await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().head[1] > 1 && window.__sp.view().ready, null, { timeout: 30000 });
  await sleep(2000);
  return { context, page, spoken };
}
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
async function dream(page) {
  // After a reload the stage may settle onto last night's wall a moment after entering
  // (moving the panel): press again until the chooser is open.
  for (let i = 0; i < 4 && !(await page.evaluate(() => __sp.view().dream.chooser.open)); i++) {
    await pinch(page, 'story-dream');
    await sleep(500);
  }
  for (let i = 0; i < 3 && !/^dreamed:/.test(await page.evaluate(() => __sp.get('StoryState', 'script'))); i++) {
    await pinch(page, 'dream-go');
    await sleep(1500);
  }
  await page.waitForFunction(() => /^dreamed:/.test(__sp.get('StoryState', 'script')) && __sp.get('StoryState', 'beatId')?.startsWith('dream-'), null, { timeout: 15000 });
}

// A. With a narrator voice on the server.
{
  const { context, page, spoken } = await session(true);
  await dream(page);
  await page.evaluate(() => {
    __sp.set('DemoDirector', 'persona', 'perfect');
    __sp.set('DemoDirector', 'playing', true);
  });
  const sources = new Set();
  for (let i = 0; i < 60; i++) {
    const s = await page.evaluate(() => ({ source: __sp.get('StoryState', 'voiceSource'), beat: __sp.get('StoryState', 'beatId') }));
    if (s.source) sources.add(s.source);
    if (s.beat === 'dream-end') break;
    await sleep(1000);
  }
  check('a dreamed story is narrated by the server voice', sources.has('server') && spoken.length >= 5, { sources: [...sources], lines: spoken.length });
  check("with the child's name where the story says it", spoken.some((t) => /\bMia\b/.test(t)), { sample: spoken.filter((t) => /Mia|little one/.test(t)).slice(0, 2) });
  check('each line is asked for once (fetched ahead, then played from the cache)', new Set(spoken).size === spoken.length, { asked: spoken.length, distinct: new Set(spoken).size });
  // A library story keeps its recorded clips.
  const before = spoken.length;
  await page.evaluate(() => {
    __sp.set('DemoDirector', 'playing', false);
    __sp.set('StoryState', 'script', 'story/counting-stars.story.json');
  });
  await page.waitForFunction(() => __sp.get('StoryState', 'voiceSource') === 'clip', null, { timeout: 30000 }).catch(() => {});
  const lib = await page.evaluate(() => __sp.get('StoryState', 'voiceSource'));
  check('a library story still plays its recorded clips', lib === 'clip' && spoken.length === before, { source: lib, extra: spoken.slice(before) });
  await context.close();
}

// B. Without a voice on the server: the dreamed story still runs.
{
  const { context, page, spoken } = await session(false);
  await dream(page);
  await page.evaluate(() => {
    __sp.set('DemoDirector', 'persona', 'perfect');
    __sp.set('DemoDirector', 'playing', true);
  });
  await sleep(8000);
  const beat = await page.evaluate(() => __sp.get('StoryState', 'beatId'));
  check('no voice on the server: the dreamed story still runs (captions, reading time)', spoken.length === 0 && beat !== 'dream-title', { beat, asked: spoken.length });
  await context.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
