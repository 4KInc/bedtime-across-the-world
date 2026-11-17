// Story worlds: the journal's "Where should we go tonight?" row steps through
// the worlds that have stories (by hand-ray pinch); the story arrows stay inside
// the chosen world; "Tell this story" starts Cars and Adventure's first story,
// Mo and the Midnight Moon Buggy, which the demo player then tells to The End:
// the moon road appears, the buggy follows Mo along it and rolls home to its
// garage at the finale. The first launch still opens Counting Stars.
//
//   node scripts/sim/story-worlds.mjs [--gpu] [--shot path.png]
// Needs the dev server (npm run dev) on https://localhost:8082 (or SIM_APP).
import { chromium } from 'playwright';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const shotAt = process.argv.indexOf('--shot');
const SHOT = shotAt > 0 ? process.argv[shotAt + 1] : null;
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
page.on('console', (m) => m.type() === 'error' && !/status of 404/.test(m.text()) && errors.push(m.text()));
// A missing file is an error, except the server's voice (no server here) for lines with no recorded clip.
page.on('response', (r) => r.status() === 404 && !/\/api\//.test(r.url()) && errors.push(`404 ${r.url()}`));
const remote = (m, p) => page.evaluate(([m, p]) => IWER_DEVICE.remote.dispatch(m, p), [m, p]);
const get = (c, f) => page.evaluate(([c, f]) => __sp.get(c, f), [c, f]);
/** Aim the hand ray at a panel button and pinch; again if the press did not land (the ray can still be settling). */
async function pinch(id) {
  // The panel glides into place beside the journal: wait until the button holds still.
  let t = null;
  for (let i = 0; i < 20; i++) {
    const now = await page.evaluate((id) => __sp.where(id), id);
    if (now && t && Math.hypot(now[0] - t[0], now[1] - t[1], now[2] - t[2]) < 0.002) break;
    t = now;
    await sleep(250);
  }
  if (!t) throw new Error(`no ${id} on the panel`);
  for (let tries = 0; tries < 3; tries++) {
    t = await page.evaluate((id) => __sp.where(id), id);
    const before = (await page.evaluate(() => __sp.presses())).length;
    await remote('look_at', { device: 'hand-right', target: { x: t[0], y: t[1], z: t[2] } });
    await sleep(300);
    await remote('set_select_value', { device: 'hand-right', value: 1 });
    await sleep(250);
    await remote('set_select_value', { device: 'hand-right', value: 0 });
    await sleep(500);
    const after = await page.evaluate(() => __sp.presses());
    if (after.length > before && after.at(-1) === id) return;
  }
  console.log(`(pinch on ${id} did not land after 3 tries)`);
}
/** Distance along the road (horizontal: the buggy rides on the ground, the garage window sits above it). */
const dist = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[2] - b[2]) : NaN);

await page.goto(APP + '/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
await sleep(1500);
await page.getByRole('button', { name: /Enter XR/i }).click();
await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().ready, null, { timeout: 30000 });
await page.waitForFunction(() => __sp.get('StoryState', 'script'), null, { timeout: 30000 });
check('the first launch still opens Counting Stars', (await get('StoryState', 'script')) === 'story/counting-stars.story.json', {
  script: await get('StoryState', 'script'),
});

// Pick the world and the story by hand ray, as a parent would.
await page.evaluate(() => __sp.set('DemoDirector', 'playing', false));
await page.evaluate(() => __sp.set('ShadowJournal', 'open', true));
await sleep(1200);
await remote('set_input_mode', { mode: 'hand' });
await sleep(800);
await pinch('world-next');
// Cars and Adventure has three stories, The Little Car's Long Way Home first (its own creatures lead,
// Nov 17): the arrows go round them and stay in the world; one past the round is the Moon Buggy.
for (let i = 0; i < 4; i++) await pinch('story-next');
await pinch('story-start');
await page.waitForFunction(() => __sp.get('StoryState', 'beatId')?.startsWith('buggy-'), null, { timeout: 30000 }).catch(() => undefined);
const presses = await page.evaluate(() => __sp.presses());
check('Where should we go tonight? > Cars and Adventure > Tell this story starts the Moon Buggy', (await get('StoryState', 'script')) === 'story/moon-buggy.story.json', {
  script: await get('StoryState', 'script'),
  presses,
});

// Tell it to The End with the demo player.
await page.evaluate(() => {
  __sp.set('DemoDirector', 'persona', 'perfect');
  __sp.set('DemoDirector', 'playing', true);
});
const t0 = Date.now();
let beat = '';
let sawRoad = false;
let start = null;
let mid = null;
let shot = false;
while (Date.now() - t0 < 420000) {
  const s = await page.evaluate(() => ({
    beat: __sp.get('StoryState', 'beatId'),
    set: __sp.get('Scenery', 'set'),
    buggy: __sp.where('scenery-moon-road-buggy'),
    garage: __sp.where('scenery-moon-road-garage-window'),
  }));
  beat = s.beat ?? '';
  if (s.set === 'moon-road') sawRoad = true;
  if (beat === 'buggy-want-dog' && !start) start = dist(s.buggy, s.garage);
  if (beat === 'buggy-dark' && !mid) mid = dist(s.buggy, s.garage);
  if (beat === 'buggy-bird-carry' && SHOT && !shot) {
    shot = true;
    await sleep(1500);
    await page.screenshot({ path: SHOT });
  }
  if (beat === 'buggy-end') break;
  await sleep(250);
}
const end = await page.evaluate(() => [__sp.where('scenery-moon-road-buggy'), __sp.where('scenery-moon-road-garage-window')]);
const home = dist(end[0], end[1]);
check('the Moon Buggy is told to The End', beat === 'buggy-end', { last: beat, minutes: +((Date.now() - t0) / 60000).toFixed(1) });
check('the moon road is on the wall', sawRoad);
check('the buggy follows Mo along the road and rolls home to its garage', start > mid && home < 0.03, {
  start: +start?.toFixed(3), mid: +mid?.toFixed(3), home: +home.toFixed(3),
});
check('no page errors', errors.length === 0, errors.slice(0, 3));

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
