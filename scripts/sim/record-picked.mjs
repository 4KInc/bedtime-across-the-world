// Record a story records the story picked in the Journal. On a Quest 3
// (Nov 17) the opening story began, the Journal was pinched, another story
// picked, and Record pressed: the old story went on being told (and recorded),
// and only after a few tries did the picked one play. Record only recorded
// whatever was playing; Tell this story was the only way to change it.
//   1. picked another story, then Record: the picked story starts at its title, recording;
//   2. not browsed, Record: tonight's story is kept (a dreamed story is never swapped for the picker's).
//
//   node scripts/sim/record-picked.mjs [--gpu]
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
  await sleep(500);
}
const state = (page) => page.evaluate(() => ({ script: __sp.get('StoryState', 'script'), beat: __sp.get('StoryState', 'beatId'), recording: __sp.get('PerformanceRecorder', 'recording') }));

const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })).newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(APP + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await sleep(1500);
  await page.getByRole('button', { name: /Enter XR/i }).click();
  await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().head[1] > 1 && window.__sp.view().ready, null, { timeout: 30000 });
  await page.evaluate(() => __sp.set('PerformanceRecorder', 'withVoice', false));
  // Hands, not controllers (the story pauses for controllers).
  await remote(page, 'set_input_mode', { mode: 'hand' });
  // The opening story is under way.
  await page.waitForFunction(() => (__sp.get('StoryState', 'beatIndex') ?? 0) >= 2, null, { timeout: 60000 });
  const opening = await state(page);

  // 1. The Journal; another story picked; Record.
  await pinch(page, 'story-next');
  await pinch(page, 'record-button');
  await page.evaluate(() => __sp.set('ShadowJournal', 'open', false));
  await page.waitForFunction((s) => __sp.get('StoryState', 'script') !== s, opening.script, { timeout: 15000 }).catch(() => undefined);
  const seen = [];
  for (let i = 0; i < 16; i++) {
    seen.push((await state(page)).beat);
    await sleep(250);
  }
  const picked = await state(page);
  check('picked another story, then Record: the picked story starts at its title, recording', picked.script !== opening.script && picked.recording === true && seen.some((b) => b?.endsWith('-title')), { opening: opening.script, picked, seen: [...new Set(seen)] });

  // Stop the recording.
  await pinch(page, 'record-button');
  await page.evaluate(() => __sp.set('ShadowJournal', 'open', false));
  await page.waitForFunction(() => /^Saved/.test(__sp.get('PerformanceRecorder', 'status') ?? ''), null, { timeout: 30000 }).catch(() => undefined);
  await sleep(3000);

  // 2. Not browsed this time: Record keeps tonight's story.
  const before = await state(page);
  await pinch(page, 'record-button');
  await page.evaluate(() => __sp.set('ShadowJournal', 'open', false));
  await sleep(3000);
  const kept = await state(page);
  check('not browsed, Record: tonight\'s story is kept', kept.script === before.script && kept.recording === true, { before: before.script, kept });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed || errors.length) process.exitCode = 1;
