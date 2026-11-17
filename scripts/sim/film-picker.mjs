// With ?film the Journal opens on tonight's story, and pressing it tells it.
// On a Quest 3 (Nov 17) ?film opened the Journal on another story; browsing to
// The Shy Little Shark (tonight's) showed "Telling this story tonight", and
// pressing it did nothing: the Journal stayed open, holding the story.
//   1. a first launch with ?film: the Journal opens on The Shy Little Shark, tonight's story;
//   2. another night (tonight's story is now The Little Car's Long Way Home): ?film opens on that one;
//   3. pressing "Telling this story tonight": the Journal closes and the story is told.
//
//   node scripts/sim/film-picker.mjs [--gpu]
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

const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })).newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  const remote = (m, p) => page.evaluate(([m, p]) => IWER_DEVICE.remote.dispatch(m, p), [m, p]);
  const enterFilm = async () => {
    await page.goto(APP + '/?film', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
    await sleep(1500);
    await page.getByRole('button', { name: /Enter XR/i }).click();
    await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().head[1] > 1 && window.__sp.view().ready, null, { timeout: 30000 });
    await remote('set_input_mode', { mode: 'hand' });
    await page.waitForFunction(() => __sp.get('ShadowJournal', 'open') === true, null, { timeout: 20000 });
    await sleep(2500);
    return page.evaluate(() => ({ picker: __sp.view().picker.script, tonight: __sp.get('StoryState', 'script') }));
  };

  // 1. A first launch.
  const first = await enterFilm();
  check('a first launch with ?film: the Journal opens on The Shy Little Shark, tonight\'s story', first.picker === 'story/gentle-shark.story.json' && first.tonight === first.picker, first);

  // 2. Another night: tonight's story is now the car story (its progress saved), then ?film again.
  await page.evaluate(() => __sp.set('StoryState', 'script', 'story/long-way-home.story.json'));
  await page.waitForFunction(() => __sp.get('StoryState', 'beatId')?.startsWith('lane-'), null, { timeout: 30000 }).catch(() => undefined);
  await sleep(1500);
  const next = await enterFilm();
  check('another night: ?film opens the Journal on tonight\'s story (the car story)', next.tonight === 'story/long-way-home.story.json' && next.picker === next.tonight, next);

  // 3. "Telling this story tonight", pressed: the Journal closes and the story is told.
  const before = await page.evaluate(() => __sp.get('StoryState', 'beatIndex'));
  const t = await page.evaluate(() => __sp.where('story-start'));
  await remote('look_at', { device: 'hand-right', target: { x: t[0], y: t[1], z: t[2] } });
  await sleep(300);
  await remote('set_select_value', { device: 'hand-right', value: 1 });
  await sleep(250);
  await remote('set_select_value', { device: 'hand-right', value: 0 });
  const closed = await page.waitForFunction(() => __sp.get('ShadowJournal', 'open') === false, null, { timeout: 5000 }).then(() => true, () => false);
  const told = await page.waitForFunction((b) => (__sp.get('StoryState', 'beatIndex') ?? -1) > b, before, { timeout: 20000 }).then(() => true, () => false);
  check('pressing "Telling this story tonight": the Journal closes and the story is told', closed && told, { closed, told, presses: await page.evaluate(() => __sp.presses().slice(-2)) });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed || errors.length) process.exitCode = 1;
