// In a live story with Take turns, a creature woken on the child's turn is
// theirs: it wakes in the child's colour (fuchsia) with their name ("Mia's
// bird") under it; on the storyteller's own turn it is the creature's usual
// colour and has no label.
//
//   node scripts/sim/child-creatures.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082 and the API server on :8787.
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

/** Enter XR, reach the bird request, set the turn, wake the bird the way a recognised shape does; answer its colour and label. */
async function wakeBird(turn) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })).newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(APP + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await page.getByRole('button', { name: /Who are the stories for|Stories for/ }).click();
  await page.getByLabel('Who are the stories for?').fill('Mia');
  await page.getByLabel('Your name, as they call you').fill('Dad');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: /Enter XR/i }).click();
  await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().ready, null, { timeout: 30000 });
  if (turn) {
    await page.evaluate(() => __sp.set('LiveSession', 'role', 'host'));
    await page.waitForFunction(() => __sp.get('LiveSession', 'code'), null, { timeout: 15000 });
  }
  await page.evaluate(() => {
    __sp.set('DemoDirector', 'persona', 'wanderer');
    __sp.set('DemoDirector', 'playing', true);
  });
  await page.waitForFunction(() => __sp.get('StoryState', 'beatId') === 'stars-want-bird', null, { timeout: 90000 });
  await sleep(1500);
  if (turn) await page.evaluate((t) => __sp.set('LiveSession', 'turn', t), turn);
  await page.evaluate(() => {
    __sp.set('ShapeRecognizer', 'matchedShape', 'bird');
    __sp.set('ShapeRecognizer', 'matchedHand', 'right');
  });
  await sleep(1500);
  const out = await page.evaluate(() => ({ body: __sp.colourOf('bird-body'), label: __sp.colourOf('child-creature-label') }));
  await page.context().close();
  return out;
}

const child = await wakeBird('guest');
check("child's turn: the bird wakes in the child's colour, with their name", child.body?.hex === 'c026d3' && child.label?.visible === true && child.label.opacity > 0.5, child);
const parent = await wakeBird('host');
check("storyteller's turn: the usual sky blue, no label", parent.body?.hex === '2f7be6' && !(parent.label?.visible), parent);
const alone = await wakeBird(null);
check('not live: the usual colour, no label', alone.body?.hex === '2f7be6' && !(alone.label?.visible), alone);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
