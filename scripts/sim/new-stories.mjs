// The newer library stories, each told to the end by the demo player in the
// headset emulator, with their narration playing (each read by its own
// narrator): The Night Garden, The Kind Crocodile, The Little Rainstorm.
//
//   node scripts/sim/new-stories.mjs [--gpu]
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

for (const [file, prefix, title] of [
  ['the-night-garden', 'garden', 'The Night Garden'],
  ['the-kind-crocodile', 'kind', 'The Kind Crocodile'],
  ['the-little-rainstorm', 'rain', 'The Little Rainstorm'],
]) {
  await page.evaluate((f) => {
    __sp.set('DemoDirector', 'playing', false);
    __sp.set('StoryState', 'script', `story/${f}.story.json`);
  }, file);
  await page.waitForFunction((p) => __sp.get('StoryState', 'beatId')?.startsWith(p), prefix, { timeout: 30000 });
  await page.evaluate(() => {
    __sp.set('DemoDirector', 'persona', 'perfect');
    __sp.set('DemoDirector', 'playing', true);
  });
  // Narration: count the beats whose clip was voiced.
  const t0 = Date.now();
  const voiced = new Set();
  let beat = '';
  while (Date.now() - t0 < 420000) {
    const s = await page.evaluate(() => ({ beat: __sp.get('StoryState', 'beatId'), voice: __sp.get('StoryState', 'voiceBeat') }));
    beat = s.beat;
    if (s.voice?.startsWith(prefix)) voiced.add(s.voice);
    if (beat === `${prefix}-end`) break;
    await sleep(250);
  }
  const caption = await page.evaluate(() => __sp.get('StoryState', 'caption'));
  check(`${title}: told to The End, with its narration`, beat === `${prefix}-end` && voiced.size >= 15, {
    last: beat, voiced: voiced.size, minutes: +((Date.now() - t0) / 60000).toFixed(1), caption,
  });
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
