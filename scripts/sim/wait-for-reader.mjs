// Recording with their voice, the parent reads each line, and the story waits
// for them to finish it. On a Quest 3 (Nov 17) the story went on by reading
// time alone, so a slower reader was cut off mid-sentence by the next caption,
// and the recording kept the cut (the family viewer then sounded broken). Here
// the microphone is a stand-in tone the sim turns on and off (no microphone is
// opened), while recording Counting Stars with the voice on:
//   1. reading on past a line's reading time: the next line waits, and comes soon after the reader stops;
//   2. not reading aloud: lines go on at their reading time, as before;
//   3. never stuck: a voice that never stops (a noisy room) still lets the story go on, at the old cap.
//
//   node scripts/sim/wait-for-reader.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
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
/** Reading time (story-script.ts readingSeconds). */
const reading = (text) => Math.max(2.5, text.trim().split(/\s+/u).length / 3 + 1.2);

const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
  // The microphone: a tone the sim switches on ("reading aloud") and off. No real microphone is opened.
  await context.addInitScript(() => {
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => {
      if (!c?.audio) return real(c);
      const ac = new AudioContext();
      const osc = ac.createOscillator();
      osc.frequency.value = 220;
      const gain = ac.createGain();
      gain.gain.value = 0;
      const dest = ac.createMediaStreamDestination();
      osc.connect(gain).connect(dest);
      osc.start();
      window.__speak = (on) => gain.gain.setValueAtTime(on ? 0.3 : 0, ac.currentTime);
      return dest.stream;
    };
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(APP + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await sleep(1500);
  await page.getByRole('button', { name: /Enter XR/i }).click();
  await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().head[1] > 1 && window.__sp.view().ready, null, { timeout: 30000 });
  await page.evaluate(() => {
    __sp.set('PerformanceRecorder', 'withVoice', true);
    __sp.set('StoryState', 'script', 'story/counting-stars.story.json');
  });
  await page.waitForFunction(() => __sp.get('StoryState', 'beatId')?.startsWith('stars-'), null, { timeout: 30000 });
  await pinch(page, 'record-button');
  await page.evaluate(() => __sp.set('ShadowJournal', 'open', false));
  await page.waitForFunction(() => __sp.view().reader?.listening && window.__speak, null, { timeout: 15000 });

  const beatNow = () => page.evaluate(() => __sp.get('StoryState', 'beatId'));
  const at = () => page.evaluate(() => performance.now());
  /** Wait until the story is on this beat; when it got there (page time). */
  const reach = async (id, timeout = 120000) => {
    await page.waitForFunction((b) => __sp.get('StoryState', 'beatId') === b, id, { timeout, polling: 50 });
    return at();
  };
  /** Wait until the story leaves this beat; when (page time). */
  const leave = async (id, timeout) => {
    await page.waitForFunction((b) => __sp.get('StoryState', 'beatId') !== b, id, { timeout, polling: 50 });
    return at();
  };
  // The demo player makes the shapes; the lines are the parent's to read.
  await page.evaluate(() => {
    __sp.set('DemoDirector', 'persona', 'perfect');
    __sp.set('DemoDirector', 'playing', true);
  });

  // 1. stars-shh (13 words): read on 6 s past its reading time.
  const t1 = await reach('stars-shh');
  const r1 = reading(await page.evaluate(() => __sp.get('StoryState', 'caption') ?? ''));
  await page.evaluate(() => window.__speak(true));
  await sleep((r1 + 6) * 1000);
  const stillOn = await beatNow();
  const stoppedAt = await page.evaluate(() => { window.__speak(false); return performance.now(); });
  const left1 = await leave('stars-shh', 15000);
  const gap = (left1 - stoppedAt) / 1000;
  check('reading on past the reading time: the line waits, and the story goes on soon after the reader stops', stillOn === 'stars-shh' && gap >= 0.5 && gap < 2.5, { reading: +r1.toFixed(1), readFor: +(r1 + 6).toFixed(1), stillOn, wentOnAfterStop: +gap.toFixed(2), sinceLine: +((left1 - t1) / 1000).toFixed(1) });

  // 2. stars-one (9 words): not read aloud.
  const t2 = await reach('stars-one');
  const left2 = await leave('stars-one', 30000);
  const took = (left2 - t2) / 1000;
  const r2 = reading('one two three four five six seven eight nine');
  check('not reading aloud: the line goes on at its reading time, as before', took >= r2 - 0.3 && took < r2 + 1.5, { reading: +r2.toFixed(1), took: +took.toFixed(2) });

  // 3. stars-two (7 words): a voice that never stops (a noisy room).
  const r3 = reading('one two three four five six seven');
  const t3 = await reach('stars-two');
  await page.evaluate(() => window.__speak(true));
  const left3 = await leave('stars-two', (r3 * 3 + 12) * 1000).catch(() => null);
  await page.evaluate(() => window.__speak(false));
  const capped = left3 ? (left3 - t3) / 1000 : -1;
  check('a voice that never stops: the story still goes on, at the cap', left3 !== null && capped >= r3 * 3 + 4 && capped <= r3 * 3 + 7, { reading: +r3.toFixed(1), took: +capped.toFixed(2), cap: +(r3 * 3 + 5).toFixed(1) });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed || errors.length) process.exitCode = 1;
