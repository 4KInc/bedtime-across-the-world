// While a recording plays on the headset (its hands drive the shadows), the
// player's own hands still work: a pinch on the lamp switch pauses, a pinch on
// the Shadow Journal opens it. On a Quest 3 (Nov 17) neither responded while a
// recording played, so it had to be watched to the end.
//
//   node scripts/sim/playback-hands.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { chromium } from 'playwright';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};
const errors = [];
const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })).newPage();
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(APP + '/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
await page.getByRole('button', { name: /Enter XR/i }).click();
await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().ready, null, { timeout: 30000 });
await sleep(1500);

const remote = (method, params) => page.evaluate(([m, p]) => IWER_DEVICE.remote.dispatch(m, p), [method, params]);
const where = (name) => page.evaluate((n) => __sp.where(n), name);
const eye = (await page.evaluate(() => __sp.view())).head[1];
const REST = { x: 0.05, y: eye - 0.25, z: -0.3 };
await remote('set_input_mode', { mode: 'hand' });
await sleep(500);

// Where the pinch lands relative to the hand, measured before the recording takes the stage's hands.
await remote('set_transform', { device: 'hand-right', position: REST });
await sleep(400);
await remote('set_select_value', { device: 'hand-right', value: 1 });
await sleep(400);
const p = await page.evaluate(() => __sp.pinchPoint('right'));
await remote('set_select_value', { device: 'hand-right', value: 0 });
await sleep(400);
const off = { x: p[0] - REST.x, y: p[1] - REST.y, z: p[2] - REST.z };
async function pinchAt(name) {
  const t = await where(name);
  await remote('set_transform', { device: 'hand-right', position: { x: t[0] - off.x, y: t[1] - off.y, z: t[2] - off.z } });
  await sleep(250);
  await remote('set_select_value', { device: 'hand-right', value: 1 });
  await sleep(400);
  await remote('set_select_value', { device: 'hand-right', value: 0 });
  await sleep(400);
  await remote('set_transform', { device: 'hand-right', position: REST });
  await sleep(300);
}

// Mia's goodnight (a recording: its hands drive the stage).
await page.waitForFunction(() => __sp.get('FamilyInbox', 'unwatched') > 0, null, { timeout: 30000 }).catch(() => undefined);
await page.evaluate(() => __sp.set('FamilyInbox', 'playRequested', true));
const playing = await page.waitForFunction(() => __sp.get('PerformancePlayer', 'playing'), null, { timeout: 15000 }).then(() => true, () => false);
await sleep(1500);

const lampBefore = await page.evaluate(() => __sp.get('Stage', 'lampOn'));
await pinchAt('desk-switch');
const lampAfter = await page.evaluate(() => __sp.get('Stage', 'lampOn'));
check('a recording playing: a pinch on the lamp switch works', playing && lampBefore === true && lampAfter === false, { playing, lampBefore, lampAfter });
await pinchAt('desk-switch');

await pinchAt('journal-cover-top');
const journal = await page.evaluate(() => ({ open: __sp.get('ShadowJournal', 'open'), stillPlaying: __sp.get('PerformancePlayer', 'playing') }));
check('a recording playing: a pinch on the Shadow Journal opens it', journal.open === true, journal);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
