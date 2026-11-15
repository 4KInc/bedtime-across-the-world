// Hands where people hold them: a comfortable spot about 38 cm in front of the
// eyes and a little low, not on the line from the lamp's bulb to the stage
// (on a Quest 3, Nov 15, hands counted in the lamp's light about 20% of the
// time: the lamp stands at about the depth a hand is held). Counting Stars is
// told to the end: every shape, the carries, cupping the falling star and
// opening the hands to let it go (with flat hands, fingers together).
//
//   node scripts/sim/comfortable-hands.mjs [--gpu] [--only story-id ...]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { chromium } from 'playwright';

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
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })).newPage();
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(APP + '/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
await sleep(1500);
await page.getByRole('button', { name: /Enter XR/i }).click();
await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().ready, null, { timeout: 30000 });
// Every story with a shape in it, so every shape is made with comfortable hands.
const STORIES = [
  ['counting-stars', 'stars'], ['the-night-garden', 'garden'], ['the-kind-crocodile', 'kind'],
  ['the-slow-letter', 'letter'], ['the-brave-little-dog', 'brave'], ['the-little-rainstorm', 'rain'],
  ['across-the-sea', 'sea'],
];
// --only <story> [story...]: just those.
const only = process.argv.includes('--only') ? process.argv.slice(process.argv.indexOf('--only') + 1).filter((a) => !a.startsWith('--')) : null;
for (const [file, prefix] of STORIES.filter(([f]) => !only || only.includes(f))) {
  await page.evaluate((f) => {
    __sp.set('DemoDirector', 'playing', false);
    __sp.set('StoryState', 'script', `story/${f}.story.json`);
  }, file);
  await page.waitForFunction((p) => __sp.get('StoryState', 'beatId')?.startsWith(p), prefix, { timeout: 30000 });
  await page.evaluate(() => {
    __sp.set('DemoDirector', 'persona', 'comfortable');
    __sp.set('DemoDirector', 'playing', true);
  });
  const t0 = Date.now();
  const took = {};
  let beat = '';
  let since = Date.now();
  let maxAssist = 0;
  while (Date.now() - t0 < 420000) {
    const s = await page.evaluate(() => ({ beat: __sp.get('StoryState', 'beatId'), assist: __sp.get('StoryState', 'assist') }));
    if (s.beat !== beat) {
      if (/want|letgo/.test(beat)) took[beat.replace(`${prefix}-`, '')] = +((Date.now() - since) / 1000).toFixed(1);
      beat = s.beat;
      since = Date.now();
    }
    if (/want|letgo/.test(beat)) maxAssist = Math.max(maxAssist, s.assist ?? 0);
    if (beat === `${prefix}-end` || beat === 'free-stage') break;
    await sleep(200);
  }
  check(`${file}: told to the end with comfortable hands; every shape within 15 s, no assist`, (beat === `${prefix}-end` || beat === 'free-stage') && Object.values(took).every((t) => t <= 15) && maxAssist === 0, { last: beat, took, maxAssist, minutes: +((Date.now() - t0) / 60000).toFixed(1) });
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
