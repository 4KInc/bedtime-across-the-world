// After a goodnight, both hands cast shadows again. On a Quest (Nov 18), after Goodnights the right
// hand cast no shadow and its shapes were never accepted until a reload: the goodnight's rabbit took
// the right hand's shadow, and nothing gave it back when the goodnight was left before the rabbit bowed.
//   1. while the goodnight plays, its creature has the right hand's shadow;
//   2. a hand left without its shadow (as on the Quest) has it again when the next story starts.
//
//   node scripts/sim/goodnight-shadow-hand.mjs [--gpu]
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
const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
try {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => performance.setResourceTimingBufferSize(5000));
  const p = await ctx.newPage();
  await p.goto(APP + '/', { waitUntil: 'load' });
  await p.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await p.getByRole('button', { name: /Enter XR/i }).click();
  await p.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().ready, null, { timeout: 30000 });
  await p.evaluate(async () => {
    const f = (x) => performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes(x)) ?? x;
    window.__rt = await import(f('/src/stage-runtime.ts'));
  });
  await p.waitForFunction(() => __sp.get('FamilyInbox', 'unwatched') > 0 || __sp.get('FamilyInbox', 'received') > 0, null, { timeout: 30000 });
  const hands = () => p.evaluate(() => ({ left: __rt.handRuntime.left.hideCasters, right: __rt.handRuntime.right.hideCasters, playing: __sp.get('PerformancePlayer', 'playing') }));

  await sleep(2000);
  await p.evaluate(() => __sp.set('FamilyInbox', 'playRequested', true));
  await sleep(5000);
  const mid = await hands();
  check("while the goodnight plays, its rabbit has the right hand's shadow", mid.playing && mid.right, mid);
  await p.waitForFunction(() => !__sp.get('PerformancePlayer', 'playing'), null, { timeout: 60000 });

  // As on the Quest: the goodnight was left with the right hand still without its shadow.
  await p.evaluate(() => {
    __rt.handRuntime.right.hideCasters = true;
    __sp.set('ShapeRecognizer', 'matchedHand', 'right');
    __sp.set('ShapeRecognizer', 'matchedShape', 'rabbit');
  });
  await p.evaluate(() => __sp.set('StoryState', 'script', 'story/bumpy-road.story.json'));
  await p.waitForFunction(() => String(__sp.get('StoryState', 'beatId')).startsWith('bump-'), null, { timeout: 30000 });
  await sleep(500);
  const next = await hands();
  check('the next story starts with both hands casting shadows', !next.left && !next.right, next);
  const held = await p.evaluate(() => __sp.get('ShapeRecognizer', 'matchedHand'));
  check('...and with no hand still holding a creature from before (so its shapes are heard)', held === 'none', { held });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) process.exitCode = 1;
