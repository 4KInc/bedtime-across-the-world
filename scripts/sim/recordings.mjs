// Every recording is kept, and any of them can be replayed or sent. On a Quest 3S
// (Nov 16) two stories were recorded; Send only ever sent the newest, and after a
// reload it had nothing to send. Now the Journal has a recordings row:
//   1. two recordings, both kept, newest first ("1 of 2"), shown when made and how long;
//   2. after a reload (the next night) the row still lists both and Send is ready;
//   3. pinching < > picks the older one; Play replays it on the wall; Send sends
//      that one (it shows "sent"), not the newest;
//   4. diagnostics report each recording started, saved and sent, without the family code.
//
//   node scripts/sim/recordings.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082 and port 8787 free
// (this script runs the API server there for the sending step).
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
const remote = (page, method, params) => page.evaluate(([m, p]) => IWER_DEVICE.remote.dispatch(m, p), [method, params]);

/** Pinch a button on the Journal's settings page with the right hand (opens the Journal first). */
async function pinch(page, id) {
  await page.evaluate(() => __sp.set('ShadowJournal', 'open', true));
  await sleep(1000);
  await remote(page, 'set_input_mode', { mode: 'hand' });
  await sleep(400);
  // The Journal's page is placed beside the book once it opens (out of sight until then).
  await page.waitForFunction((id) => (__sp.where(id)?.[1] ?? -1) > 0.3, id, { timeout: 10000 }).catch(() => undefined);
  const t = await page.evaluate((id) => __sp.where(id), id);
  await remote(page, 'look_at', { device: 'hand-right', target: { x: t[0], y: t[1], z: t[2] } });
  await sleep(300);
  await remote(page, 'set_select_value', { device: 'hand-right', value: 1 });
  await sleep(250);
  await remote(page, 'set_select_value', { device: 'hand-right', value: 0 });
  await sleep(500);
  if (process.env.DEBUG) console.log('pinch', id, JSON.stringify(t), JSON.stringify(await page.evaluate(() => [__sp.presses().slice(-2), __sp.get('ShadowJournal', 'open'), __sp.view().recordings.index])));
}

const row = (page) => page.evaluate(() => __sp.view().recordings);

async function enter(page) {
  await page.goto(APP + '/?diag', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await page.getByRole('button', { name: /Enter XR/i }).click();
  await page.waitForFunction(() => window.__sp.view().ready && window.__sp.get('DemoDirector', 'status') !== undefined, null, { timeout: 30000 });
  await page.evaluate(() => __sp.set('PerformanceRecorder', 'withVoice', false));
}

/** Tell a few seconds of a story with the record button pinched on and off. */
async function record(page, script, seconds) {
  await page.evaluate((s) => {
    __sp.set('StoryState', 'script', s);
    __sp.set('DemoDirector', 'persona', 'perfect');
    __sp.set('DemoDirector', 'playing', true);
  }, script);
  await sleep(1500);
  await pinch(page, 'record-button');
  await page.evaluate(() => __sp.set('ShadowJournal', 'open', false));
  await sleep(seconds * 1000);
  await pinch(page, 'record-button');
  // Saving waits for the recording to be written (slower on a busy machine).
  await page.waitForFunction(() => /^Saved/.test(__sp.get('PerformanceRecorder', 'status') ?? ''), null, { timeout: 30000 });
  await page.evaluate(() => __sp.set('DemoDirector', 'playing', false));
}

const server = spawn(process.execPath, ['server/main.ts'], {
  env: { ...process.env, PORT: '8787', DATA_DIR: mkdtempSync(join(tmpdir(), 'sp-recordings-')) },
  stdio: 'ignore',
});
await sleep(1000);
const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
  // Every diagnostics item the page sends (what the bucket would get).
  const diag = [];
  await context.route('**/api/diag', async (route) => {
    try {
      diag.push(...JSON.parse(route.request().postData() ?? '{}').items);
    } catch {}
    await route.fulfill({ status: 204, body: '' });
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await enter(page);
  const empty = await row(page);

  // 1. Two recordings, both kept.
  await record(page, 'story/counting-stars.story.json', 8);
  await record(page, 'story/the-brave-little-dog.story.json', 6);
  await page.waitForFunction(() => __sp.view().recordings.count === 2, null, { timeout: 5000 }).catch(() => undefined);
  const two = await row(page);
  const newest = await page.evaluate(() => __sp.get('PerformanceRecorder', 'lastId'));
  check('two recordings: both kept, newest first and chosen for Send', empty.count === 0 && two.count === 2 && two.index === 0 && two.chosen === newest && /^1 of 2/.test(two.title) && /^Today .* · 0:\d\d · not sent yet$/.test(two.info), { empty, two });

  // 2. The next night: reload, and both are still there, with Send ready.
  await enter(page);
  await page.waitForFunction(() => __sp.view().recordings.count === 2, null, { timeout: 10000 }).catch(() => undefined);
  const after = await row(page);
  const ready = await page.evaluate(() => __sp.get('PerformanceRecorder', 'lastId'));
  check('after a reload: both still listed, and Send has the newest ready', after.count === 2 && ready === two.chosen, { after, ready });

  // 3. Pick the older one, play it, send it.
  await pinch(page, 'rec-next');
  const older = await row(page);
  const chosen = await page.evaluate(() => __sp.get('PerformanceRecorder', 'lastId'));
  check('pinching > picks the older recording, and Send will send it', older.index === 1 && /^2 of 2: Counting Stars/.test(older.title) && chosen === older.chosen && chosen !== two.chosen, older);
  await pinch(page, 'rec-play');
  const played = await page.waitForFunction((id) => __sp.get('PerformancePlayer', 'playing') && __sp.get('PerformancePlayer', 'recordingId') === id, chosen, { timeout: 8000 }).then(() => true, () => false);
  // It plays on the wall, so the Journal steps aside (its pages covered the playback, Nov 16).
  const journalClosed = (await page.evaluate(() => __sp.get('ShadowJournal', 'open'))) === false;
  const playingRow = await row(page);
  await pinch(page, 'rec-play');
  const stopped = await page.waitForFunction(() => !__sp.get('PerformancePlayer', 'playing'), null, { timeout: 5000 }).then(() => true, () => false);
  check('Play replays the chosen recording on the wall, the Journal steps aside; pinching again stops it', played && journalClosed && playingRow.playing === chosen && stopped, { played, journalClosed, playing: playingRow.playing, stopped });
  await pinch(page, 'send-button');
  await page.waitForFunction(() => /^Sent!|^Could not/.test(__sp.get('PerformanceRecorder', 'status') ?? ''), null, { timeout: 20000 }).catch(() => undefined);
  const status = await page.evaluate(() => __sp.get('PerformanceRecorder', 'status'));
  const code = status.match(/Family code: (\S+)/)?.[1] ?? '';
  await page.waitForFunction(() => / · sent$/.test(__sp.view().recordings.info), null, { timeout: 5000 }).catch(() => undefined);
  const sent = await row(page);
  const fetched = code ? await page.evaluate(async (c) => (await (await fetch(`/api/stories/${c}`)).json()).performance?.id, code) : '';
  await page.evaluate(() => __sp.set('ShadowJournal', 'open', true));
  await sleep(1200);
  const t = await page.evaluate(() => __sp.where('rec-next'));
  await page.evaluate((t) => IWER_DEVICE.remote.dispatch('look_at', { device: 'headset', target: { x: t[0], y: t[1], z: t[2] } }), t);
  await sleep(800);
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  // The row shows its family code, to give again (Nov 17: the codes were nowhere to be found).
  check('Send sends the chosen (older) recording, and the row shows its family code', Boolean(code) && fetched === chosen && sent.chosen === chosen && sent.info.endsWith(` · family code ${code}`), { status, fetched, chosen, sent });

  // 4. Diagnostics: started, saved, sent; never the code.
  await page.evaluate(() => __sp.set('ShadowJournal', 'open', false));
  await sleep(16000); // events are sent every 15 s
  const recs = diag.filter((i) => i.k === 'ev' && i.e === 'rec');
  const whats = recs.map((r) => r.what);
  const leaked = code && JSON.stringify(diag).includes(code);
  const saved = recs.filter((r) => r.what === 'saved');
  check('diagnostics report each recording started, saved (with its story and length) and sent, never the code', whats.join(',') === 'start,saved,start,saved,sent' && saved[0]?.script === 'counting-stars.story.json' && saved[0].seconds >= 7 && !leaked, { whats, saved, leaked });
} finally {
  await browser.close();
  server.kill();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed || errors.length) process.exitCode = 1;
