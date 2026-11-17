// What steps off the wall reaches the child too. In the headset, a creature let
// go hops onto the real desk as a lantern, a story told to the end leaves a star
// in the keepsake jar, and Mo comes down to sleep. A phone, tablet or computer
// has no desk, so the family viewer has a shelf under the stage, below the
// caption, and they land there. On a tablet (landscape) and a phone (portrait),
// watching the sample story from Dad:
//   1. the shelf is on screen, under the caption, clear of the Pause/Join in/Stop pill;
//   2. the caption is never covered by the viewer's controls;
//   3. the first creature let go hops onto the shelf, and stays;
//   4. at the end, a star flies into the jar on the shelf and Mo sleeps there.
// Saves screenshots.
//
//   node scripts/sim/viewer-shelf.mjs [--gpu] [--only tablet|phone]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { MEDIA_DIR } from './media.mjs';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : '';
const OUT = join(MEDIA_DIR, `viewer-shelf-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};
const errors = [];
const overlap = (a, b) => a && b && a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
// The middle of a box (its soft glow reaches further than the creature itself).
const mid = (a) => a && [(a[0] + a[2]) / 2, (a[1] + a[3]) / 2];
const inside = (p, b) => p && b && p[0] > b[0] && p[0] < b[2] && p[1] > b[1] && p[1] < b[3];

const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
for (const [device, viewport] of [['tablet', { width: 1180, height: 820 }], ['phone', { width: 390, height: 844 }]]) {
  if (ONLY && ONLY !== device) continue;
  const page = await (await browser.newContext({ viewport, ignoreHTTPSErrors: true, hasTouch: device === 'phone' })).newPage();
  page.on('pageerror', (e) => errors.push(`${device}: ${e}`));
  await page.goto(APP + '/?viewer', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  // Full screen, where the browser allows it (Nov 17): on, then off again.
  const fsBtn = page.locator('.sp-small-row [data-act="fullscreen"]');
  await fsBtn.waitFor({ timeout: 15000 }).catch(() => undefined);
  // (Once the page has settled: a click while it is still starting can be lost.)
  await page.waitForFunction(() => document.querySelector('.sp-card'), null, { timeout: 30000 }).catch(() => undefined);
  await fsBtn.click();
  const fsOn = await page.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 3000 }).then(() => true, () => false);
  await fsBtn.click();
  await sleep(600);
  const fsOff = await page.evaluate(() => !document.fullscreenElement);
  check(`${device}: Full screen goes full screen, and back`, fsOn && fsOff, { fsOn, fsOff });

  const card = page.getByRole('button', { name: /Watch A story from far away from Dad/ }).first();
  await card.waitFor({ timeout: 30000 });
  await card.click();
  await page.waitForFunction(() => __sp.get('PerformancePlayer', 'position') > 2 && __sp.view().shelf.on, null, { timeout: 30000 });
  await sleep(1200);

  // 1-2: the layout while a story plays.
  const layout = await page.evaluate(() => {
    const r = document.querySelector('.sp-viewer .sp-panel').getBoundingClientRect();
    return { shelf: __sp.onScreen('shelf-plank'), caption: __sp.onScreen('story-caption'), pill: [r.left, r.top, r.right, r.bottom].map(Math.round), w: innerWidth, h: innerHeight };
  });
  const s = layout.shelf;
  check(`${device}: the shelf is on screen, under the caption`, s && s[0] >= -40 && s[2] <= layout.w + 40 && s[1] >= 0 && s[3] <= layout.h && s[1] >= layout.caption[1] + (layout.caption[3] - layout.caption[1]) * 0.6, layout);
  // The caption's drawn box is narrower than its quad: the middle 84% of the stage-wide quad.
  const c = layout.caption;
  const cw = c[2] - c[0];
  const drawn = [c[0] + cw * 0.08, c[1] + (c[3] - c[1]) * 0.25, c[2] - cw * 0.08, c[3] - (c[3] - c[1]) * 0.1];
  check(`${device}: the viewer's controls never cover the caption`, !overlap(drawn, layout.pill), { caption: drawn.map(Math.round), pill: layout.pill });

  // No lamp hum on the viewer: there is no lamp on its screen (Nov 17: a constant buzz from the speakers).
  const sound = await page.evaluate(() => __sp.view().sound);
  check(`${device}: no lamp hum on the family viewer`, sound.hum === false && sound.lullabyNotes >= 0, sound);

  // The controls fade while the recording plays untouched (they sometimes covered the caption, Nov 16),
  // and come back on a mouse move or a tap.
  const pill = () => page.evaluate(() => {
    const el = document.querySelector('.sp-viewer .sp-panel');
    return { opacity: Number(getComputedStyle(el).opacity), clickable: getComputedStyle(el).pointerEvents !== 'none' };
  });
  await sleep(4500);
  const faded = await pill();
  await page.mouse.move(200, 200);
  await page.mouse.move(260, 240);
  await sleep(900);
  const back = await pill();
  check(`${device}: the controls fade while the story plays untouched, and come back on a touch`, faded.opacity < 0.05 && !faded.clickable && back.opacity > 0.95 && back.clickable, { faded, back });

  // 3: the first creature let go (the rabbit, about 42 s in) hops onto the shelf.
  const hopped = await page.waitForFunction(() => __sp.view().lanterns.onDesk.length > 0, null, { timeout: 90000, polling: 200 }).then(() => true, () => false);
  await sleep(600);
  const lan = await page.evaluate(() => ({ ...__sp.view().lanterns, shelf: __sp.view().shelf.centre }));
  const onShelf = Math.abs(lan.last[1] - lan.shelf[1]) < 0.1 && Math.abs(lan.last[2] - lan.shelf[2]) < 0.05;
  const pillNow = await page.evaluate(() => {
    const r = document.querySelector('.sp-viewer .sp-panel').getBoundingClientRect();
    return [r.left, r.top, r.right, r.bottom].map(Math.round);
  });
  const lanBox = await page.evaluate((shape) => __sp.onScreen(`lantern-${shape}`), lan.onDesk[0]);
  check(`${device}: a creature let go hops off the wall onto the shelf, on screen and clear of the controls`, hopped && onShelf && lanBox && mid(lanBox)[1] < layout.h && !inside(mid(lanBox), pillNow), { onDesk: lan.onDesk, last: lan.last, shelf: lan.shelf, box: lanBox, pill: pillNow });
  await page.screenshot({ path: join(OUT, `${device}-lantern.png`) });

  // 4: to the end (about two minutes), a star for the jar, and Mo asleep on the shelf.
  const jarBefore = await page.evaluate(() => __sp.view().keepsakes.count);
  const ended = await page.waitForFunction((n) => __sp.view().keepsakes.count > n && !__sp.view().keepsakes.flying && __sp.view().moVisit.phase === 'sleep', jarBefore, { timeout: 180000, polling: 250 }).then(() => true, () => false);
  await sleep(1500);
  const end = await page.evaluate(() => ({ keepsakes: __sp.view().keepsakes, mo: __sp.view().moVisit, lanterns: __sp.view().lanterns.onDesk, shelf: __sp.view().shelf, jar: __sp.onScreen('keepsake-jar'), moBox: __sp.onScreen('mo-visit') }));
  check(`${device}: a story watched to the end leaves a star in the jar on the shelf`, ended && end.keepsakes.count === jarBefore + 1 && Math.abs(end.keepsakes.jar[1] - end.shelf.centre[1]) < 0.02 && end.jar && end.jar[3] <= layout.h, { before: jarBefore, after: end.keepsakes.count, jar: end.jar });
  check(`${device}: Mo comes down and sleeps on the shelf, and the lanterns are still there`, end.mo.phase === 'sleep' && end.moBox && mid(end.moBox)[1] < layout.h && !inside(mid(end.moBox), layout.pill) && end.lanterns.length >= 1, { mo: end.mo, moBox: end.moBox, lanterns: end.lanterns });
  await page.screenshot({ path: join(OUT, `${device}-end.png`) });
  // The ending stays in view: no story list or goodnight over the shelf yet (Nov 16: they covered Mo and the jar
  // at once); then, a few seconds later, the list of stories again.
  const covered = () => page.evaluate(() => ({ list: !document.querySelector('.sp-list')?.hidden, goodnight: !!document.querySelector('.sp-goodnight') }));
  // Measured from when the recording finishes playing (that is when they used to appear).
  await page.waitForFunction(() => !__sp.get('PerformancePlayer', 'playing'), null, { timeout: 120000, polling: 100 });
  await sleep(1500);
  const atEnd = await covered();
  await sleep(8000);
  const later = await covered();
  check(`${device}: the ending stays in view, then the stories come back`, !atEnd.list && !atEnd.goodnight && later.list, { atEnd, later });
  await page.context().close();
}
await browser.close();

console.log(`screenshots: ${OUT}`);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
