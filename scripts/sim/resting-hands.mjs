// Hands put down between shapes cast no shadow. On a Quest 3 (Nov 16), hands
// lowered while no shape was asked for still put their shadows on the wall,
// which distracted from the story. A hand held up in front (where shapes are
// made) casts; lowered below that (more than about 42 cm under the eyes) it
// does not; raised again, it casts again.
//
//   node scripts/sim/resting-hands.mjs [--gpu]
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
await page.evaluate(() => IWER_DEVICE.remote.dispatch('set_input_mode', { mode: 'hand' }));
await sleep(1000);

const { head, center } = await page.evaluate(() => ({ head: __sp.view().head, center: __sp.view().center }));
const len = Math.hypot(center[0] - head[0], center[2] - head[2]);
/** The right hand 38 cm in front of the eyes, `below` metres under them. */
async function handAt(below) {
  const p = { x: head[0] + ((center[0] - head[0]) / len) * 0.38, y: head[1] - below, z: head[2] + ((center[2] - head[2]) / len) * 0.38 };
  await page.evaluate((p) => IWER_DEVICE.remote.dispatch('set_transform', { device: 'hand-right', position: p }), p);
  // The emulator takes a moment to move the hand there.
  await sleep(1500);
  return page.evaluate(() => ({ tracked: __sp.hands().right, casting: __sp.audit().casters.some((c) => c.startsWith('hand-caster-right')) }));
}

const up = await handAt(0.15);
check('a hand held up in front casts its shadow', up.tracked && up.casting, up);
const down = await handAt(0.55);
check('lowered to rest (55 cm under the eyes), it casts none, still tracked', down.tracked && !down.casting, down);
const edge = await handAt(0.39);
check('at the edge (39 cm under the eyes) it stays as it was, resting: no flicker', edge.tracked && !edge.casting, edge);
const again = await handAt(0.2);
check('raised again, it casts again', again.tracked && again.casting, again);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
