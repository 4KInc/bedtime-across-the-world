// Growing a creature as people can: "bring your hand back toward you". With the
// lamp behind the viewer, a hand pulled back toward the chest makes the creature
// bigger. On a Quest 3 (Nov 16) both of The Moth's grow steps waited for the
// story's 30 s help: they needed the hand nearly at the chin. The comfortable bot
// pulls its hand back about 12 cm; each grow step must finish by hand within 15 s.
//
//   node scripts/sim/grow.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { chromium } from 'playwright';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
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
await page.waitForTimeout(1500);
await page.getByRole('button', { name: /Enter XR/i }).click();
await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().ready, null, { timeout: 30000 });
await page.evaluate(() => {
  __sp.set('StoryState', 'script', 'story/the-moth.story.json');
  __sp.set('DemoDirector', 'persona', 'comfortable');
  __sp.set('DemoDirector', 'playing', true);
});

for (const step of ['grow-fish', 'dog-grow']) {
  const reached = await page.waitForFunction((s) => __sp.get('StoryState', 'beatId') === s, step, { timeout: 420000, polling: 100 }).then(() => true, () => false);
  if (!reached) {
    check(`${step}: grown by hand`, false, { reached: false, beat: await page.evaluate(() => __sp.get('StoryState', 'beatId')) });
    continue;
  }
  const t0 = Date.now();
  let assist = 0;
  const went = await page
    .waitForFunction((s) => __sp.get('StoryState', 'beatId') !== s, step, { timeout: 40000, polling: 100 })
    .then(() => true, () => false);
  const seconds = +((Date.now() - t0) / 1000).toFixed(1);
  assist = await page.evaluate(() => __sp.get('StoryState', 'assist'));
  // Under 15 s is by hand: the story's help finishes a grow step only at 30 s.
  check(`${step}: a hand pulled back about 12 cm grows the creature, by hand within 15 s`, went && seconds <= 15, { seconds, went, assistAfter: assist });
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
