// The world creatures (src/world-creatures.ts) in their stories: two more stories in
// each world but Wonder and Nature, with a rocket, an alien and an asteroid in space,
// a shark, an octopus and a whale in the sea, a car, an aeroplane and a digger on the
// road, and a T. rex and a pterodactyl with the dinosaurs. The demo player tells each
// story to The End with the hand poses (a fist for the asteroid, the crocodile's jaws
// for the T. rex); every creature asked for wakes as itself, carries Mo, and leaves
// a lantern of itself on the desk. Saves a picture of each creature on the wall.
// With --viewer, the first story is recorded and sent, and a phone that has never
// seen these creatures plays it: each wakes there too.
//
//   node scripts/sim/world-creatures.mjs [--gpu] [--only moon-rocks,gentle-shark] [--viewer]
// Needs the dev server on https://localhost:8082 (or SIM_APP). Sending stays in the
// browser (the family-code server is stood in for), so no API server is needed.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { MEDIA_DIR } from './media.mjs';

const ALL = ['moon-rocks', 'alien-lullaby', 'gentle-shark', 'whale-song', 'bumpy-road', 'long-way-home', 'gentle-trex', 'sky-ride'];
const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const onlyAt = process.argv.indexOf('--only');
const STORIES = onlyAt > 0 ? process.argv[onlyAt + 1].split(',') : ALL;
const VIEWER = process.argv.includes('--viewer');
const OUT = join(MEDIA_DIR, `world-creatures-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};
const errors = [];
const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
/** The family-code server, stood in for: a sent story is kept here and handed back by its code. */
const CODE = 'sim-world-creatures-1';
let sent = null;
async function familyServer(context) {
  await context.route('**/api/stories', async (route) => {
    sent = route.request().postData();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: CODE, expiresAt: Date.now() + 864e5 }) });
  });
  await context.route(`**/api/stories/${CODE}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: `{"code":"${CODE}","performance":${sent}}` }));
}
const headset = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
await familyServer(headset);
const page = await headset.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && !/status of 404/.test(m.text()) && errors.push(m.text()));
// A missing file is an error (no server here: the /api voice is not needed, every line has its clip).
page.on('response', (r) => r.status() === 404 && !/\/api\//.test(r.url()) && errors.push(`404 ${r.url()}`));

await page.goto(APP + '/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
await sleep(1500);
await page.getByRole('button', { name: /Enter XR/i }).click();
await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().ready, null, { timeout: 30000 });
await page.waitForFunction(() => __sp.get('StoryState', 'script'), null, { timeout: 30000 });
await sleep(2000);

for (const id of STORIES) {
  const script = `story/${id}.story.json`;
  const story = await page.evaluate(async (s) => (await (await fetch(s)).json()), script);
  const asked = story.beats.filter((b) => b.type === 'request' && b.shape !== 'cup').map((b) => b.shape);
  const prefix = story.beats[0].id.split('-')[0] + '-';
  await page.evaluate((s) => {
    __sp.set('DemoDirector', 'playing', false);
    __sp.set('StoryState', 'script', s);
  }, script);
  await page.waitForFunction((p) => __sp.get('StoryState', 'beatId')?.startsWith(p), prefix, { timeout: 30000 }).catch(() => undefined);
  const recordIt = VIEWER && id === STORIES[0];
  await page.evaluate((rec) => {
    __sp.set('DemoDirector', 'persona', 'perfect');
    __sp.set('DemoDirector', 'playing', true);
    if (rec) {
      __sp.set('PerformanceRecorder', 'withVoice', false);
      __sp.set('PerformanceRecorder', 'recording', true);
    }
  }, recordIt);
  const t0 = Date.now();
  const woke = {};
  const lanterns = new Set();
  let beat = '';
  while (Date.now() - t0 < 480000) {
    const s = await page.evaluate(() => ({ beat: __sp.get('StoryState', 'beatId'), puppets: __sp.puppets(), onDesk: __sp.view().lanterns.onDesk }));
    beat = s.beat ?? '';
    for (const l of s.onDesk) lanterns.add(l);
    // Once a creature asked for has woken (Mo climbs on): which one is awake. (The first ride
    // can end as it starts: a creature that wakes past its mark has already carried Mo there.)
    const m = beat.match(/^[a-z]+-([a-z]+)-yes$/);
    if (m && !woke[m[1]]) {
      const alive = s.puppets.filter((p) => p.state === 'alive').map((p) => p.shape);
      woke[m[1]] = alive;
      await sleep(1200);
      await page.screenshot({ path: join(OUT, `${id}-${m[1]}.png`) });
    }
    if (beat === `${prefix}end`) break;
    await sleep(250);
  }
  const minutes = +((Date.now() - t0) / 60000).toFixed(1);
  check(`${id}: told to The End`, beat === `${prefix}end`, { last: beat, minutes });
  const wrong = asked.filter((shape) => !(woke[shape] ?? []).includes(shape));
  check(`${id}: every creature asked for woke as itself (${asked.join(', ')})`, wrong.length === 0, { woke });
  const missing = asked.filter((shape) => !lanterns.has(shape));
  check(`${id}: each left a lantern of itself on the desk`, missing.length === 0, { lanterns: [...lanterns] });
  if (recordIt) {
    await sleep(2000);
    await page.evaluate(() => __sp.set('PerformanceRecorder', 'recording', false));
    await page.waitForFunction(() => /^Saved/.test(__sp.get('PerformanceRecorder', 'status') ?? ''), null, { timeout: 20000 }).catch(() => undefined);
    await page.evaluate(() => __sp.set('PerformanceRecorder', 'shareRequested', true));
    await page.waitForFunction(() => /^Sent!|^Could not/.test(__sp.get('PerformanceRecorder', 'status') ?? ''), null, { timeout: 30000 }).catch(() => undefined);
    await viewerPlays(id, asked, await page.evaluate(() => __sp.get('PerformanceRecorder', 'status')));
  }
}

/** A phone opens the family code and watches: every creature asked for wakes on its wall too. */
async function viewerPlays(id, asked, status) {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, ignoreHTTPSErrors: true });
  await familyServer(context);
  const phone = await context.newPage();
  phone.on('pageerror', (e) => errors.push(`viewer: ${e}`));
  await phone.goto(`${APP}/?viewer`, { waitUntil: 'load' });
  await phone.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await phone.getByRole('textbox', { name: 'Family code' }).fill(CODE);
  await phone.getByRole('button', { name: 'Open' }).click();
  // The story arrives at the top of the list ("... is here. Tap it to watch."); tap it.
  await phone.waitForFunction(() => /is here/.test(document.querySelector('.sp-note')?.textContent ?? ''), null, { timeout: 20000 }).catch(() => undefined);
  const note = await phone.evaluate(() => document.querySelector('.sp-note')?.textContent);
  await phone.locator('.sp-card').first().click();
  await phone.waitForFunction(() => __sp.get('PerformancePlayer', 'playing'), null, { timeout: 30000 }).catch(() => undefined);
  const seen = new Set();
  let shot = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    const s = await phone.evaluate(() => ({ playing: __sp.get('PerformancePlayer', 'playing'), alive: __sp.puppets().filter((p) => p.state === 'alive').map((p) => p.shape) }));
    for (const a of s.alive) seen.add(a);
    if (!shot && s.alive.some((a) => asked.includes(a))) {
      shot = true;
      await sleep(800);
      await phone.screenshot({ path: join(OUT, `${id}-viewer.png`) });
    }
    if (!s.playing && Date.now() - t0 > 5000) break;
    await sleep(250);
  }
  const missed = asked.filter((a) => !seen.has(a));
  check(`viewer: the sent ${id} plays on a phone, and every creature wakes there (${asked.join(', ')})`, /^Sent!/.test(status ?? '') && missed.length === 0, { status, note, seen: [...seen] });
  await context.close();
}
check('no page errors', errors.length === 0, errors.slice(0, 3));
console.log(`pictures: ${OUT}`);
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
