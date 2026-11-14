// Creatures come alive in colour: a shadow while the shape is being formed,
// blooming into the creature's own colour once it wakes (the bird: sky blue),
// back to a shadow as it bows; and in high contrast they stay solid shadows.
// Saves one screenshot of a creature in colour.
//
//   node scripts/sim/creature-colours.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { MEDIA_DIR } from './media.mjs';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const OUT = join(MEDIA_DIR, `creature-colours-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};
const INK = '0a0810';
const BIRD = '2f7be6';
const errors = [];
const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });

async function run(highContrast) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })).newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(APP + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await sleep(1500);
  if (highContrast) await page.evaluate(() => __sp.set('Settings', 'highContrast', true));
  await page.getByRole('button', { name: /Enter XR/i }).click();
  await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().ready, null, { timeout: 30000 });
  // Counting Stars asks for the bird first; the slow player shows one open hand for a while, then makes it.
  await page.evaluate(() => {
    __sp.set('DemoDirector', 'persona', 'slow');
    __sp.set('DemoDirector', 'playing', true);
  });
  await page.waitForFunction(() => __sp.get('StoryState', 'beatId') === 'stars-want-bird', null, { timeout: 90000 });
  await sleep(3000);
  const forming = await page.evaluate(() => __sp.colourOf('bird-body'));
  await page.waitForFunction(() => __sp.get('StoryState', 'beatId') !== 'stars-want-bird', null, { timeout: 60000 });
  await sleep(1200);
  const alive = await page.evaluate(() => __sp.colourOf('bird-body'));
  if (!highContrast) {
    await page.screenshot({ path: join(OUT, 'bird-in-colour.png') });
    console.log(`screenshot: ${join(OUT, 'bird-in-colour.png')}`);
  }
  // The bird bows ("stars-bird-bows") and fades: sample while it is going.
  await page.waitForFunction(() => __sp.get('StoryState', 'beatId') === 'stars-bird-bows', null, { timeout: 90000 });
  let bowing = null;
  for (let i = 0; i < 40; i++) {
    const c = await page.evaluate(() => __sp.colourOf('bird-body'));
    if (c && c.opacity < 0.4 && c.opacity > 0) {
      bowing = c;
      break;
    }
    await sleep(50);
  }
  await page.context().close();
  return { forming, alive, bowing };
}

const colour = await run(false);
check('being formed: a shadow', colour.forming?.hex === INK, colour.forming);
check('awake: the bird blooms into sky blue', colour.alive?.hex === BIRD && colour.alive.opacity > 0.8, colour.alive);
check('bowing: back to a shadow before it is gone', colour.bowing === null || colour.bowing.hex === INK, colour.bowing);
const contrast = await run(true);
check('high contrast: the awake bird stays a solid shadow', contrast.alive?.hex === INK && contrast.alive.opacity > 0.8, contrast.alive);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
