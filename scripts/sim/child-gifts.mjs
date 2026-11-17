// The child's own Mo, and a drawn creature: on the family viewer the child
// picks Mo's colours and draws a creature (the goodnight's gift picker, here on
// its own: no recording, no camera); when that goodnight reaches the
// storyteller's headset, Mo takes the child's colours and the drawing walks
// onto the wall in the next story with "Mia's creature". Saves screenshots.
//
//   node scripts/sim/child-gifts.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { MEDIA_DIR } from './media.mjs';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const OUT = join(MEDIA_DIR, `child-gifts-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};
const errors = [];
const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });

// A. The family viewer: Rose for Mo, and a drawing (a round body and two legs).
const viewer = await (await browser.newContext({ viewport: { width: 900, height: 900 }, ignoreHTTPSErrors: true })).newPage();
viewer.on('pageerror', (e) => errors.push(String(e)));
await viewer.goto(APP + '/?viewer', { waitUntil: 'load' });
await viewer.waitForFunction(() => window.__sp, null, { timeout: 60000 });
await viewer.evaluate(() => __sp.giftPicker('Dad'));
await viewer.getByRole('button', { name: 'Rose' }).click();
const pad = await viewer.locator('canvas.sp-pad').boundingBox();
const at = (x, y) => [pad.x + x * pad.width, pad.y + y * pad.height];
await viewer.mouse.move(...at(0.5, 0.2));
await viewer.mouse.down();
for (let i = 0; i <= 24; i++) {
  const a = (i / 24) * Math.PI * 2;
  await viewer.mouse.move(...at(0.5 + 0.25 * Math.sin(a), 0.45 - 0.25 * Math.cos(a)));
}
await viewer.mouse.up();
for (const x of [0.4, 0.6]) {
  await viewer.mouse.move(...at(x, 0.66));
  await viewer.mouse.down();
  await viewer.mouse.move(...at(x, 0.75));
  await viewer.mouse.move(...at(x, 0.85));
  await viewer.mouse.up();
}
const gifts = await viewer.evaluate(() => window.__gifts.get());
await viewer.screenshot({ path: join(OUT, 'picker.png') });
console.log(`screenshot: ${join(OUT, 'picker.png')}`);
const strokes = await viewer.evaluate((d) => import('/src/child-gifts.ts').then((m) => m.decodeDrawing(d)?.length ?? 0), gifts.drawing);
check('the viewer: Mo in Rose and a drawing of three strokes, ready to send', gifts.mo === 'rose' && strokes === 3 && gifts.drawing.length < 4000, { mo: gifts.mo, strokes, bytes: gifts.drawing.length });
await viewer.context().close();

// B. The storyteller's headset: the goodnight arrives (as the inbox stores it), then the next story.
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })).newPage();
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(APP + '/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
const before = await page.evaluate(() => __sp.view().gifts);
await page.evaluate((g) => new Promise((resolve) => {
  const q = indexedDB.open('shadowplay');
  q.onsuccess = () => {
    const tx = q.result.transaction('recordings', 'readwrite');
    tx.objectStore('recordings').put({
      version: 'shadowplay.performance.v1', id: 'goodnight-with-gifts', title: 'A goodnight from Mia', performer: 'Mia',
      replyTo: 'abc-def-ghi-123', createdAt: Date.now(), durationMs: 1000, script: '', frameHz: 30, hands: '', frameCount: 0,
      events: [], watched: false, mo: g.mo, drawing: g.drawing,
    });
    tx.oncomplete = () => resolve(true);
  };
}), gifts);
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__sp && __sp.view().gifts.mo === 'rose', null, { timeout: 30000 }).catch(() => undefined);
const after = await page.evaluate(() => __sp.view().gifts);
check("the goodnight arrives: Mo takes Mia's colours (kept for later nights)", before.mo === 'amber' && after.mo === 'rose' && after.moFrom === 'Mia', { before, after });

await sleep(1000);
await page.getByRole('button', { name: /Enter XR/i }).click();
await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().ready, null, { timeout: 30000 });
// The story that opens (The Shy Little Shark on a first launch, Nov 17): the drawing walks on at its start.
await page.evaluate(() => {
  __sp.set('DemoDirector', 'persona', 'perfect');
  __sp.set('DemoDirector', 'playing', true);
});
const walked = await page.waitForFunction(() => __sp.view().gifts.drawn.phase === 'walk', null, { timeout: 30000 }).then(() => true, () => false);
await page.waitForFunction(() => __sp.view().gifts.drawn.phase === 'sit', null, { timeout: 15000 }).catch(() => undefined);
const drawn = (await page.evaluate(() => __sp.view().gifts)).drawn;
check("the next story: Mia's drawn creature walks onto the wall and settles, with her name", walked && drawn.phase === 'sit' && drawn.label === "Mia's creature", drawn);
const c = await page.evaluate(() => __sp.where('child-drawing'));
await page.evaluate((t) => IWER_DEVICE.remote.dispatch('look_at', { device: 'headset', target: { x: t[0] + 0.25, y: t[1] + 0.15, z: t[2] } }), c);
await sleep(800);
await page.screenshot({ path: join(OUT, 'wall.png') });
console.log(`screenshot: ${join(OUT, 'wall.png')}`);
// Then it hops back off, and does not come back in the next story (Nov 16: it stayed in every story, in the way).
const left = await page.waitForFunction(() => __sp.view().gifts.drawn.phase === 'none', null, { timeout: 25000, polling: 250 }).then(() => true, () => false);
await page.evaluate(() => __sp.set('StoryState', 'script', 'story/the-night-garden.story.json'));
await sleep(3000);
const nextStory = (await page.evaluate(() => __sp.view().gifts)).drawn.phase;
await page.evaluate(() => __sp.set('StoryState', 'script', 'story/counting-stars.story.json'));
await sleep(1500);
check("then it hops off, and stays away in the next story (once for each drawing)", left && nextStory === 'none', { left, nextStory });

// Mo at the finale glows in Rose (her wings are tinted all along).
await page.waitForFunction(() => __sp.get('StoryState', 'beatId') === 'stars-end', null, { timeout: 360000, polling: 250 });
await page.evaluate(() => __sp.set('DemoDirector', 'playing', false));
await sleep(1500);
const mo = await page.evaluate(() => __sp.colourOf('moth-body'));
check('Mo glows in Rose at the end', mo?.hex === 'ff9fd0' && mo.visible, { mo });
await page.screenshot({ path: join(OUT, 'mo-in-rose.png') });
console.log(`screenshot: ${join(OUT, 'mo-in-rose.png')}`);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
