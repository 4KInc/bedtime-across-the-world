// Dinosaurs and Discovery, Space and Exploration: each world now has its first
// story, so the journal's "Where should we go tonight?" row reaches them by hand-ray
// pinch. The demo player tells the story to The End: its scenery appears, its
// character (the little dinosaur, Pip's spaceship) follows Mo and goes home at the
// finale, and the wall's sky takes the scene's colours, not the default ones.
//
//   node scripts/sim/dino-space.mjs dino|space [--gpu] [--shot path.png]
// Needs the dev server on https://localhost:8082 (or SIM_APP).
import { chromium } from 'playwright';

const STORIES = {
  dino: {
    nexts: 3, script: 'story/sleepy-dinosaur.story.json', prefix: 'dino-', set: 'dino-valley',
    who: 'scenery-dino-valley-dino', home: 'scenery-dino-valley-cave-door', midBeat: 'dino-dark', shotBeat: 'dino-bird-carry',
  },
  space: {
    nexts: 4, script: 'story/lost-spaceship.story.json', prefix: 'space-', set: 'star-port',
    who: 'scenery-star-port-ship', home: 'scenery-star-port-home-window', midBeat: 'space-dark', shotBeat: 'space-swan-carry',
  },
};
const S = STORIES[process.argv[2]];
if (!S) throw new Error('usage: dino-space.mjs dino|space');
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
// A missing file is an error, except the server's voice (no server here) for lines with no recorded clip yet.
page.on('response', (r) => r.status() === 404 && !/\/api\//.test(r.url()) && errors.push(`404 ${r.url()}`));
const missing = [];
page.on('response', (r) => r.status() === 404 && missing.push(r.url()));
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
/** Distance in the wall's plane (the character and its home's light). */
const dist = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : NaN);

await page.goto(APP + '/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
await sleep(1500);
await page.getByRole('button', { name: /Enter XR/i }).click();
await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().ready, null, { timeout: 30000 });
await page.waitForFunction(() => __sp.get('StoryState', 'script'), null, { timeout: 30000 });
await sleep(3000);
const firstSky = await page.evaluate(() => __sp.view().twilight);

await page.evaluate(() => __sp.set('DemoDirector', 'playing', false));
await page.evaluate(() => __sp.set('ShadowJournal', 'open', true));
await sleep(1200);
await remote('set_input_mode', { mode: 'hand' });
await sleep(800);
for (let i = 0; i < S.nexts; i++) await pinch('world-next');
await pinch('story-start');
await page.waitForFunction((p) => __sp.get('StoryState', 'beatId')?.startsWith(p), S.prefix, { timeout: 30000 }).catch(() => undefined);
check(`Where should we go tonight? > world ${S.nexts + 1} > Tell this story starts ${S.script}`, (await get('StoryState', 'script')) === S.script, {
  script: await get('StoryState', 'script'),
  presses: await page.evaluate(() => __sp.presses()),
});

await page.evaluate(() => {
  __sp.set('DemoDirector', 'persona', 'perfect');
  __sp.set('DemoDirector', 'playing', true);
});
const t0 = Date.now();
let beat = '';
let sawSet = false;
let start = null;
let mid = null;
let sceneSky = null;
let shot = false;
while (Date.now() - t0 < 480000) {
  const s = await page.evaluate(([who, home]) => ({
    beat: __sp.get('StoryState', 'beatId'),
    set: __sp.get('Scenery', 'set'),
    who: __sp.where(who),
    home: __sp.where(home),
    sky: __sp.view().twilight,
  }), [S.who, S.home]);
  beat = s.beat ?? '';
  if (s.set === S.set) sawSet = true;
  if (beat === `${S.prefix}want-croc` || beat === `${S.prefix}want-rabbit`) start ??= dist(s.who, s.home);
  if (beat === S.midBeat) {
    mid ??= dist(s.who, s.home);
    sceneSky ??= s.sky;
  }
  if (beat === S.shotBeat && SHOT && !shot) {
    shot = true;
    await sleep(1500);
    await page.screenshot({ path: SHOT });
  }
  if (beat === `${S.prefix}end`) break;
  await sleep(250);
}
const end = await page.evaluate(([who, home]) => [__sp.where(who), __sp.where(home)], [S.who, S.home]);
const home = dist(end[0], end[1]);
check('told to The End', beat === `${S.prefix}end`, { last: beat, minutes: +((Date.now() - t0) / 60000).toFixed(1) });
check(`the ${S.set} scenery is on the wall`, sawSet);
check('the character follows Mo and goes home at the finale', start > mid && home < 0.05, {
  start: +start?.toFixed(3), mid: +mid?.toFixed(3), home: +home.toFixed(3),
});
check("the wall's sky takes the scene's colours (not the first launch's)", !!sceneSky && sceneSky.top !== firstSky.top && sceneSky.intensity > 0, {
  first: firstSky, scene: sceneSky,
});
check('no page errors', errors.length === 0, errors.slice(0, 3));
console.log('404s:', [...new Set(missing)].slice(0, 5));

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
