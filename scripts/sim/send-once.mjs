// Send to family sends once, and shows that it is sending. On a Quest 3 (Nov 17)
// a 3-minute story with a voice took a while to upload; the button still said
// "Send to family", so it was pressed again, and the story was sent twice, with
// two family codes. With the upload slowed down here (4 s):
//   1. while it uploads the button says "Sending..." and the status says a long one can take a minute;
//   2. a second press during the upload sends nothing more: one upload, one family code;
//   3. diagnostics report the send once, with how long it took and how big it was;
//   4. the recorded voice is asked for at speech quality (48 kbps), not the browser's default.
//
//   node scripts/sim/send-once.mjs
// Needs the dev server (npm run dev) on https://localhost:8082. No API server: uploads are answered here.
import { chromium } from 'playwright';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};
const errors = [];
const remote = (page, method, params) => page.evaluate(([m, p]) => IWER_DEVICE.remote.dispatch(m, p), [method, params]);

async function pinch(page, id) {
  await page.evaluate(() => __sp.set('ShadowJournal', 'open', true));
  await sleep(1000);
  await remote(page, 'set_input_mode', { mode: 'hand' });
  await sleep(400);
  await page.waitForFunction((id) => (__sp.where(id)?.[1] ?? -1) > 0.3, id, { timeout: 10000 }).catch(() => undefined);
  const t = await page.evaluate((id) => __sp.where(id), id);
  await remote(page, 'look_at', { device: 'hand-right', target: { x: t[0], y: t[1], z: t[2] } });
  await sleep(300);
  await remote(page, 'set_select_value', { device: 'hand-right', value: 1 });
  await sleep(250);
  await remote(page, 'set_select_value', { device: 'hand-right', value: 0 });
  await sleep(300);
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-certificate-errors'] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
  // The recorded voice's settings, as the page asks for them (the microphone is never opened here).
  await context.addInitScript(() => {
    window.__voiceOptions = [];
    const Real = window.MediaRecorder;
    if (Real) {
      window.MediaRecorder = class extends Real {
        constructor(stream, options) {
          window.__voiceOptions.push(options ?? null);
          super(stream, options);
        }
      };
      window.MediaRecorder.isTypeSupported = Real.isTypeSupported.bind(Real);
    }
  });
  const uploads = [];
  await context.route('**/api/stories', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    uploads.push(route.request().postData()?.length ?? 0);
    await sleep(4000); // a slow connection
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: `moon-otter-lamp-${100 + uploads.length}`, expiresAt: Date.now() + 864e5 }) });
  });
  const diag = [];
  await context.route('**/api/diag', async (route) => {
    try {
      diag.push(...JSON.parse(route.request().postData() ?? '{}').items);
    } catch {}
    await route.fulfill({ status: 204, body: '' });
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(APP + '/?diag', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await page.getByRole('button', { name: /Enter XR/i }).click();
  await page.waitForFunction(() => window.__sp.view().ready && window.__sp.get('DemoDirector', 'status') !== undefined, null, { timeout: 30000 });

  // A long recording: 65 s of Counting Stars (no voice: the microphone is never opened in a test).
  await page.evaluate(() => {
    __sp.set('PerformanceRecorder', 'withVoice', false);
    __sp.set('StoryState', 'script', 'story/counting-stars.story.json');
    __sp.set('DemoDirector', 'persona', 'perfect');
    __sp.set('DemoDirector', 'playing', true);
  });
  await sleep(1500);
  await pinch(page, 'record-button');
  await page.evaluate(() => __sp.set('ShadowJournal', 'open', false));
  await sleep(65000);
  await pinch(page, 'record-button');
  await page.waitForFunction(() => /^Saved/.test(__sp.get('PerformanceRecorder', 'status') ?? ''), null, { timeout: 30000 });
  await page.evaluate(() => __sp.set('DemoDirector', 'playing', false));

  // 1-2: Send, then Send again while it uploads.
  await pinch(page, 'send-button');
  await page.waitForFunction(() => __sp.view().recordings.send === 'Sending...', null, { timeout: 3000 }).catch(() => undefined);
  const during = await page.evaluate(() => ({ label: __sp.view().recordings.send, status: __sp.get('PerformanceRecorder', 'status') }));
  await pinch(page, 'send-button');
  await page.waitForFunction(() => /^Sent!/.test(__sp.get('PerformanceRecorder', 'status') ?? ''), null, { timeout: 20000 }).catch(() => undefined);
  await sleep(6000); // time for a second upload to start, if one would
  const after = await page.evaluate(() => ({ label: __sp.view().recordings.send, status: __sp.get('PerformanceRecorder', 'status') }));
  check('while it uploads the button says Sending..., and a long story says it can take a minute', during.label === 'Sending...' && /can take a minute/.test(during.status ?? '') && after.label === 'Send to family', { during, after: after.label });
  check('a second press while sending sends nothing more: one upload, one family code', uploads.length === 1 && /moon-otter-lamp-101/.test(after.status ?? ''), { uploads: uploads.length, status: after.status });

  // 3: diagnostics.
  await page.evaluate(() => __sp.set('ShadowJournal', 'open', false));
  await sleep(16000);
  const sent = diag.filter((i) => i.k === 'ev' && i.e === 'rec' && i.what === 'sent');
  check('diagnostics report the send once, with how long it took and its size', sent.length === 1 && sent[0].ms >= 3500 && sent[0].kb > 0, sent);

  // 4: the voice's quality, asked for when a recording starts with the voice on (MediaRecorder, as the recorder makes it).
  // A silent stand-in stream: the real microphone is never opened.
  const asked = await page.evaluate(() => {
    const dest = new AudioContext().createMediaStreamDestination();
    navigator.mediaDevices.getUserMedia = async () => dest.stream;
    return true;
  });
  await page.evaluate(() => {
    __sp.set('PerformanceRecorder', 'withVoice', true);
    __sp.set('DemoDirector', 'playing', true);
  });
  await pinch(page, 'record-button');
  await sleep(1500);
  await pinch(page, 'record-button');
  const options = await page.evaluate(() => window.__voiceOptions);
  check('the recorded voice is asked for at speech quality (48 kbps opus)', asked && options.length === 1 && options[0]?.audioBitsPerSecond === 48000, options);
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed || errors.length) process.exitCode = 1;
