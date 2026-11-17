// The night light. On a phone, the sample story from Dad is watched to the end;
// the goodnight card offers "Night light", and the phone becomes one: Mo asleep
// under the moon, "Goodnight, Mia.", the lullaby softly. A tap only shows a
// Close button (a sleepy hand does not end it). The light and the music fade,
// then the screen goes dark (shortened here with ?nightms). Close ends it.
// Saves screenshots.
//
//   node scripts/sim/night-light.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082 (or SIM_APP).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { MEDIA_DIR } from './media.mjs';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const OUT = join(MEDIA_DIR, `night-light-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(OUT, { recursive: true });
/** The light lasts this long here (ten minutes in the app). */
const NIGHT_MS = 14000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};
const errors = [];
const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true, hasTouch: true });
// The app's own copy of night-light.ts is read below: after a hot reload the dev server serves it with a version
// stamp, and importing the plain path gives an empty second copy (all files loaded are listed, past the default 250).
await context.addInitScript(() => performance.setResourceTimingBufferSize(5000));
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${APP}/?viewer&nightms=${NIGHT_MS}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
await page.waitForFunction(() => document.querySelector('.sp-card'), null, { timeout: 30000 }).catch(() => undefined);
await page.evaluate(() => import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/src/night-light.ts')) ?? '/src/night-light.ts').then((m) => (window.__night = m.nightLightRuntime)));
const night = () => page.evaluate(() => ({ ...window.__night, shown: !!document.querySelector('.sp-night'), text: document.querySelector('.sp-night')?.innerText ?? '' }));

// Dad's sample story, to the end (skipping ahead to its last seconds).
const card = page.getByRole('button', { name: /Watch A story from far away from Dad/ }).first();
await card.waitFor({ timeout: 30000 });
await card.click();
await page.waitForFunction(() => __sp.get('PerformancePlayer', 'position') > 2, null, { timeout: 30000 });
await page.evaluate(() => __sp.set('PerformancePlayer', 'position', __sp.get('PerformancePlayer', 'duration') - 3));
const goodnight = await page.waitForFunction(() => document.querySelector('.sp-goodnight'), null, { timeout: 240000, polling: 250 }).then(() => true, () => false);
await sleep(1500);
const buttons = await page.evaluate(() => [...document.querySelectorAll('.sp-goodnight .sp-btn')].map((b) => b.textContent));
await page.screenshot({ path: join(OUT, 'goodnight-card.png') });
check('the goodnight card at the end of the story offers a Night light', goodnight && buttons.includes('Night light'), { buttons });

// The night light.
await page.locator('.sp-goodnight .sp-btn', { hasText: 'Night light' }).click();
// (It fades in over three seconds.)
await sleep(3500);
const lit = await night();
await page.screenshot({ path: join(OUT, 'night-light.png') });
check('the phone becomes a night light: Mo asleep, "Goodnight, Mia.", Dad\'s love, the lullaby softly', lit.shown && lit.phase === 'lit' && /Goodnight, Mia\./.test(lit.text) && /Love, Dad/.test(lit.text) && lit.music > 0, lit);

// Alive, not a still picture (Nov 17, an iPad): stars twinkling out of step, a glow swelling around Mo, the z's drifting.
const alive = await page.evaluate(() => {
  const running = (el) => el?.getAnimations().filter((a) => a.playState === 'running').length ?? 0;
  const stars = [...document.querySelectorAll('.sp-night-stars i')];
  const glow = document.querySelector('.sp-night-halo');
  const zs = [...document.querySelectorAll('.sp-night-z')];
  const opacity = stars.slice(0, 12).map((s) => Number(getComputedStyle(s).opacity).toFixed(2));
  return { stars: stars.length, twinkling: stars.filter((s) => running(s) > 0).length, outOfStep: new Set(opacity).size, glow: running(glow), zs: zs.filter((z) => running(z) > 0).length };
});
check('alive: stars twinkling out of step, a glow swelling around Mo, the z\'s drifting', alive.stars >= 30 && alive.twinkling === alive.stars && alive.outOfStep >= 4 && alive.glow >= 1 && alive.zs === 3, alive);
// With Reduce Motion: the twinkle and the glow stay (only brightness changes), nothing moves.
await page.emulateMedia({ reducedMotion: 'reduce' });
await sleep(300);
const calm = await page.evaluate(() => {
  const running = (el) => el?.getAnimations().filter((a) => a.playState === 'running').length ?? 0;
  return { twinkling: [...document.querySelectorAll('.sp-night-stars i')].filter((s) => running(s) > 0).length, glow: running(document.querySelector('.sp-night-halo')), zs: [...document.querySelectorAll('.sp-night-z')].filter((z) => running(z) > 0).length, mo: running(document.querySelector('.sp-night svg')) };
});
check('with Reduce Motion: stars and glow still glow, nothing moves', calm.twinkling >= 30 && calm.glow >= 1 && calm.zs === 0 && calm.mo === 0, calm);
await page.emulateMedia({ reducedMotion: 'no-preference' });

// A sleepy tap shows Close, and nothing more.
await page.locator('.sp-night').click({ position: { x: 195, y: 300 } });
await sleep(500);
const tapped = await page.evaluate(() => ({ ask: document.querySelector('.sp-night')?.classList.contains('ask'), open: window.__night.open }));
check('a tap on the screen only shows Close (the night light stays on)', tapped.ask && tapped.open, tapped);

// It fades, then lights out.
await sleep(NIGHT_MS * 0.6);
const fading = await night();
const starsDim = await page.evaluate(() => Number(document.querySelector('.sp-night-stars').style.opacity));
check('the light and the music fade, the stars with them', fading.phase === 'lit' && fading.light < 0.75 && fading.music < 0.6 && starsDim < 0.75, { ...fading, starsDim });
await page.waitForFunction(() => window.__night.phase === 'dark', null, { timeout: NIGHT_MS * 2, polling: 200 }).catch(() => undefined);
await sleep(2500);
const dark = await night();
await page.screenshot({ path: join(OUT, 'lights-out.png') });
const starsOut = await page.evaluate(() => Number(getComputedStyle(document.querySelector('.sp-night-stars')).opacity));
check('then lights out: the screen goes dark, the stars too, and the music stops', dark.phase === 'dark' && dark.light === 0 && dark.music === 0 && dark.shown && starsOut === 0, { ...dark, starsOut });

// Close ends it.
await page.locator('.sp-night').click({ position: { x: 195, y: 300 } });
await sleep(500);
await page.getByRole('button', { name: 'Close the night light' }).click();
await sleep(500);
const closed = await night();
check('Close ends the night light', !closed.shown && !closed.open, closed);

await browser.close();
console.log(`screenshots: ${OUT}`);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
