// A goodnight already watched can be played again. On a Quest (Nov 18), Mia's
// sample goodnight had been watched in an earlier session: the journal's
// Goodnights did nothing (only unwatched ones played), so the storyteller (or a
// judge on a second visit) could never see a goodnight again. Here the
// headset's goodnight is marked watched, the journal is opened with hands
// (IWER, no controllers) and Goodnights is pinched:
//   1. the goodnight is still counted on the device (none unwatched);
//   2. pinching Goodnights plays it again on the wall, the journal stepping aside.
//
//   node scripts/sim/journal-replay.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082 (or SIM_APP).
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
const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
  await context.addInitScript(() => performance.setResourceTimingBufferSize(5000));
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(APP + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  // Mia's sample goodnight arrives (seeded on the headset), and is then marked watched, as after an earlier visit.
  await page.waitForFunction(() => __sp.get('FamilyInbox', 'unwatched') > 0, null, { timeout: 30000, polling: 500 });
  const goodnight = await page.evaluate(async () => {
    const s = await import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/src/journal-store.ts')) ?? '/src/journal-store.ts');
    let id = '';
    for (const p of await s.listRecordings()) {
      if (!p.replyTo) continue;
      await s.saveRecording({ ...(await s.loadRecording(p.id)), watched: true });
      id = p.id;
    }
    return id;
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await sleep(3000);
  const counted = await page.evaluate(() => ({ unwatched: __sp.get('FamilyInbox', 'unwatched'), received: __sp.get('FamilyInbox', 'received') }));
  check('the watched goodnight is still on the device (none unwatched)', counted.unwatched === 0 && counted.received >= 1, counted);

  await page.getByRole('button', { name: /Enter XR/i }).click();
  await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().ready, null, { timeout: 30000 });
  const remote = (m, p) => page.evaluate(([m, p]) => IWER_DEVICE.remote.dispatch(m, p), [m, p]);
  await sleep(1500);
  await page.evaluate(() => __sp.set('ShadowJournal', 'open', true));
  await remote('set_input_mode', { mode: 'hand' });
  await sleep(1500);
  async function pinch(id) {
    const t = await page.evaluate((id) => __sp.where(id), id);
    if (!t) throw new Error(`no ${id} on the panel`);
    await remote('look_at', { device: 'hand-right', target: { x: t[0], y: t[1], z: t[2] } });
    await sleep(300);
    await remote('set_select_value', { device: 'hand-right', value: 1 });
    await sleep(250);
    await remote('set_select_value', { device: 'hand-right', value: 0 });
    await sleep(500);
  }
  const playing = () => page.waitForFunction(() => __sp.get('PerformancePlayer', 'playing'), null, { timeout: 4000 }).then(() => true, () => false);
  // (The first pinch after the hands appear can be missed, as in dream-choose: once more if nothing plays.)
  await pinch('inbox-button');
  let played = await playing();
  if (!played) {
    await pinch('inbox-button');
    played = await playing();
  }
  const now = await page.evaluate(() => ({ playing: __sp.get('PerformancePlayer', 'playing'), id: __sp.get('PerformancePlayer', 'recordingId'), journalOpen: __sp.get('ShadowJournal', 'open') }));
  check('Goodnights plays the watched goodnight again, on the wall (the journal steps aside)', played && now.id === goodnight && !now.journalOpen, { ...now, goodnight });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed || errors.length) process.exitCode = 1;
