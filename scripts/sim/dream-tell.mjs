// A dreamed story waits for the parent: Tell it, or Record and tell it. On a
// Quest 3 (Nov 17) a dreamed story began as soon as it was dreamed, so there was
// no moment to press Record before it. Now it waits on its title, the Journal
// open at "Mo dreamed ...":
//   1. Record and tell it (pinched): the Journal closes, the recording starts, and the story begins at its title;
//   2. stopped and saved, the recording has the story from its title;
//   3. hands-free: another dream, and "tell it" said with Voice commands on: told, not recording.
//
//   node scripts/sim/dream-tell.mjs [--gpu]
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
const state = (page) =>
  page.evaluate(() => ({
    open: __sp.get('ShadowJournal', 'open'),
    ready: __sp.view().dream.ready,
    beat: __sp.get('StoryState', 'beatId'),
    index: __sp.get('StoryState', 'beatIndex'),
    recording: __sp.get('PerformanceRecorder', 'recording'),
  }));

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
  await context.route('**/api/voice', (route) => route.fulfill({ json: { available: false } }));
  // Voice commands through the browser's recogniser, said here (no microphone is opened).
  await context.addInitScript(() => {
    window.SpeechRecognition = class {
      start() {
        window.__rec = this;
      }
      abort() {}
      stop() {}
    };
    window.__say = (t) => window.__rec?.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: t }], { isFinal: true })] });
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(APP + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await sleep(1500);
  await page.getByRole('button', { name: /Enter XR/i }).click();
  await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().head[1] > 1 && window.__sp.view().ready, null, { timeout: 30000 });
  await page.evaluate(() => __sp.set('PerformanceRecorder', 'withVoice', false));
  await sleep(1500);

  // 1. Record and tell it.
  await pinch(page, 'story-dream');
  await pinch(page, 'dream-go');
  await page.waitForFunction(() => __sp.view().dream.ready, null, { timeout: 20000 });
  const waiting = await state(page);
  await pinch(page, 'dream-record');
  const seen = [];
  for (let i = 0; i < 20; i++) {
    seen.push((await state(page)).beat);
    await sleep(250);
  }
  const told = await state(page);
  check('Record and tell it: the Journal closes, recording, and the story begins at its title', waiting.open && waiting.ready && !waiting.recording && told.open === false && told.ready === '' && told.recording === true && seen.find((b) => b?.startsWith('dream-')) === 'dream-title', { waiting, seen: [...new Set(seen)], told });

  // 2. Saved: the recording has the story from its title.
  await page.waitForFunction(() => (__sp.get('StoryState', 'beatIndex') ?? 0) >= 3, null, { timeout: 30000 });
  await pinch(page, 'record-button');
  await page.waitForFunction(() => /^Saved/.test(__sp.get('PerformanceRecorder', 'status') ?? ''), null, { timeout: 30000 }).catch(() => undefined);
  const made = await page.evaluate(() => ({ ...__sp.view().recordings.made, status: __sp.get('PerformanceRecorder', 'status') }));
  const restarts = await page.evaluate(() => import('/src/story-script.ts').then((m) => m.storyRuntime.restartedForRecording).catch(() => -1));
  check('the recording is saved, from the title (no restart was needed)', /^Saved/.test(made.status ?? '') && made.script === 'dreamed' && made.seconds >= 5 && restarts <= 0, { made, restarts });
  await page.evaluate(() => __sp.set('ShadowJournal', 'open', false));

  // 3. Hands-free: a dream by voice, then "tell it".
  await page.evaluate(() => __sp.set('Settings', 'voiceCommands', true));
  await sleep(1000);
  await page.evaluate(() => window.__say('Dream a story about the sea with a shark and a whale'));
  await page.waitForFunction(() => __sp.get('StoryState', 'script') === 'dreamed:2' && __sp.view().dream.ready, null, { timeout: 20000 }).catch(() => undefined);
  const byVoice = await state(page);
  await sleep(500);
  await page.evaluate(() => window.__say('tell it'));
  await page.waitForFunction(() => (__sp.get('StoryState', 'beatId') ?? '').startsWith('dream-') && !__sp.get('ShadowJournal', 'open'), null, { timeout: 15000 }).catch(() => undefined);
  const spoken = await state(page);
  check('by voice: a dream waits too, and "tell it" tells it, not recording', byVoice.open && !!byVoice.ready && spoken.open === false && spoken.ready === '' && spoken.recording === false && spoken.beat?.startsWith('dream-'), { byVoice, spoken, heard: await page.evaluate(() => __sp.view().voice?.heard) });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed || errors.length) process.exitCode = 1;
