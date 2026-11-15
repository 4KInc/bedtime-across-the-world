// The headset waking (or the system menu blurring the view) is not counted as
// the app running slowly: with ?diag, the session is hidden, the page is held
// for most of a second (as the Quest holds frames back while it wakes), then
// blurred and visible again. The frame-rate windows then hold only the app's own
// frames, the held-back ones are reported apart (transFrames, transWorstMs), and
// entering XR (the app's own work) is not a transition.
//
//   node scripts/sim/diag-wake.mjs [--gpu]
// Needs the dev server on https://localhost:8082 (or SIM_APP).
import { chromium } from 'playwright';
import { transitionWindows } from './../diag/windows.mjs';

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
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
const rows = [];
await context.route('**/api/diag', async (route) => {
  const body = JSON.parse(route.request().postData() ?? '{}');
  for (const r of body.items ?? body.rows ?? (Array.isArray(body) ? body : [])) rows.push(r);
  return route.fulfill({ status: 204 });
});
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && !/status of 404/.test(m.text()) && errors.push(m.text()));

await page.goto(APP + '/?diag', { waitUntil: 'load' });
await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
await sleep(1500);
await page.getByRole('button', { name: /Enter XR/i }).click();
await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().ready, null, { timeout: 30000 });
await sleep(12000);
const awake = rows.length;

// Asleep, held, then waking: blurred for a moment, then visible.
await page.evaluate(() => IWER_DEVICE.updateVisibilityState('hidden'));
await sleep(300);
await page.evaluate(() => {
  const end = performance.now() + 900;
  while (performance.now() < end);
});
await page.evaluate(() => IWER_DEVICE.updateVisibilityState('visible-blurred'));
await sleep(400);
await page.evaluate(() => IWER_DEVICE.updateVisibilityState('visible'));
await sleep(14000);

const snaps = rows.filter((r) => r.k === 'snap' && r.vis && r.vis !== 'non-immersive');
const before = snaps.filter((s) => rows.indexOf(s) < awake);
const after = snaps.filter((s) => rows.indexOf(s) >= awake);
const held = after.filter((s) => s.transFrames > 0);
const longest = Math.max(0, ...held.map((s) => s.transWorstMs));
check('entering XR is the app\'s own work: not held out', before.length > 0 && before.every((s) => !s.transFrames), { windows: before.length });
check('the held-back wake frames are reported apart, with the long one', held.length >= 1 && longest >= 800, { held: held.map((s) => [s.transFrames, s.transWorstMs]) });
check('the frame-rate windows after waking do not contain the long frame', after.every((s) => s.worstMs < 800), { worst: after.map((s) => s.worstMs) });
const t = transitionWindows(rows);
check('the summary counts the wake as a system transition, not as play', held.every((s) => t.has(s)) && before.every((s) => !t.has(s)), { transitions: t.size });
check('no page errors', errors.length === 0, errors.slice(0, 3));

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
