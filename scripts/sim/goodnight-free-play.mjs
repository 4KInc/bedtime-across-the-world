// After a goodnight plays on the headset, stories ask for their shapes again.
// On a Quest (Nov 18), after Goodnights, a dreamed story and The Bumpy Road
// stayed in the goodnight's free play: the car was asked for, the snail's two
// fingers were made again and again, and the car never woke. Here (IWER, hands)
// a goodnight plays as the journal's Goodnights plays it, and ends:
//   1. while it plays, it is free play (every creature free to wake);
//   2. when it ends (the story still waiting on its title), its free play ends with it;
//   3. ...and the next story asks for its own shapes.
//
//   node scripts/sim/goodnight-free-play.mjs [--gpu]
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
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })).newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(APP + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await page.getByRole('button', { name: /Enter XR/i }).click();
  await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().ready, null, { timeout: 30000 });
  // Mia's sample goodnight has arrived.
  await page.waitForFunction(() => __sp.get('FamilyInbox', 'unwatched') > 0 || __sp.get('FamilyInbox', 'received') > 0, null, { timeout: 30000 });
  const state = () => page.evaluate(() => ({ free: __sp.get('ShapeRecognizer', 'freeMode'), playing: __sp.get('PerformancePlayer', 'playing'), beat: __sp.get('StoryState', 'beatId') }));
  await page.evaluate(() => __sp.set('FamilyInbox', 'playRequested', true));
  await page.waitForFunction(() => __sp.get('PerformancePlayer', 'playing'), null, { timeout: 10000 });
  await sleep(1500);
  const during = await state();
  check('while the goodnight plays, it is free play', during.playing && during.free === true, during);
  // It ends while the story waits on its title (as on the Quest, between two goodnights), and nothing else restarts the story.
  await page.evaluate(() => __sp.set('PerformancePlayer', 'playing', false));
  await sleep(3000);
  const after = await state();
  check('when the goodnight ends, its free play ends with it', !after.playing && after.free === false, after);
  // Then a dreamed story or another story is told from its title: still not free play.
  await page.evaluate(() => IWER_DEVICE.remote.dispatch('set_input_mode', { mode: 'hand' }));
  await page.evaluate(() => __sp.set('StoryState', 'script', 'story/bumpy-road.story.json'));
  await page.waitForFunction(() => __sp.get('StoryState', 'beatId') === 'bump-intro1', null, { timeout: 30000 }).catch(() => undefined);
  const later = await state();
  check('...and the next story asks for its own shapes (not free play)', later.free === false && /^bump-/.test(later.beat), later);
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed || errors.length) process.exitCode = 1;
