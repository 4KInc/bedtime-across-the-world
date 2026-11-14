// Mo comes to you: when she first comes to follow your finger she leaves the
// wall, flies to the storyteller's index fingertip and perches there, then
// flies back (and the follow step is done); at the end of the story she comes
// back to the fingertip to sleep. With no hand in view she stays on the wall.
// Saves a screenshot of Mo on the fingertip.
//
//   node scripts/sim/mo-visit.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { MEDIA_DIR } from './media.mjs';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const OUT = join(MEDIA_DIR, `mo-visit-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};
const errors = [];
const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });

async function open() {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })).newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(APP + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await sleep(1500);
  await page.getByRole('button', { name: /Enter XR/i }).click();
  await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().ready, null, { timeout: 30000 });
  return page;
}
const visit = (page) => page.evaluate(() => __sp.view().moVisit);

// A. With hands (the demo player's).
{
  const page = await open();
  await page.evaluate(() => {
    __sp.set('DemoDirector', 'persona', 'perfect');
    __sp.set('DemoDirector', 'playing', true);
  });
  await page.waitForFunction(() => __sp.view().moVisit.phase === 'out', null, { timeout: 60000 });
  const out = await visit(page);
  await page.waitForFunction(() => __sp.view().moVisit.phase === 'perch', null, { timeout: 10000 });
  await sleep(800);
  const perch = await visit(page);
  await page.screenshot({ path: join(OUT, 'mo-on-the-fingertip.png') });
  console.log(`screenshot: ${join(OUT, 'mo-on-the-fingertip.png')}`);
  check('Mo flies off the wall and perches on the fingertip', out.visits === 1 && perch.fromTip >= 0 && perch.fromTip < 0.04, { out, perch });
  await page.waitForFunction(() => __sp.view().moVisit.phase === 'idle', null, { timeout: 15000 });
  await page.waitForFunction(() => __sp.get('StoryState', 'beatId') !== 'stars-follow', null, { timeout: 20000 }).catch(() => {});
  check('she flies back to the wall, and the follow step is done', (await visit(page)).phase === 'idle' && (await page.evaluate(() => __sp.get('StoryState', 'beatId'))) !== 'stars-follow', {
    beat: await page.evaluate(() => __sp.get('StoryState', 'beatId')),
  });
  await page.waitForFunction(() => __sp.get('StoryState', 'beatId') === 'stars-end', null, { timeout: 240000 }).catch(() => {});
  // The demo player puts its hands down at the end: raise a (tracked) hand, as a storyteller would.
  await page.evaluate(() => {
    __sp.set('DemoDirector', 'playing', false);
    IWER_DEVICE.remote.dispatch('set_input_mode', { mode: 'hand' });
  });
  await page.waitForFunction(() => __sp.view().moVisit.phase === 'sleep', null, { timeout: 12000 }).catch(() => {});
  const sleepy = await visit(page);
  check('at the end she comes to the fingertip to sleep', sleepy.phase === 'sleep' && sleepy.visits === 2, sleepy);
  await page.context().close();
}

// B. No hands in view: she stays on the wall.
{
  const page = await open();
  await page.evaluate(() => IWER_DEVICE.remote.dispatch('set_input_mode', { mode: 'controller' }));
  await page.evaluate(() => __sp.set('Settings', 'gazeDwell', true));
  await page.waitForFunction(() => __sp.get('StoryState', 'beatId') === 'stars-follow', null, { timeout: 60000 });
  await sleep(3000);
  check('no hand in view: Mo stays on the wall', (await visit(page)).visits === 0, await visit(page));
  await page.context().close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
