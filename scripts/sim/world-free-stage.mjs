// The story worlds' creatures in the Shadow Journal and in Free Stage. A child who
// has met a rocket, a whale, a car and an asteroid in their worlds' stories finds
// them on the journal's page (nineteen creatures, by name), and in Free Stage
// (after The Moth) they come to play: the demo player makes a rabbit, a rocket, a
// snail, a whale, the snail's pose again and a fist, and they wake as a rabbit, a
// rocket, a snail, a whale, a car (the snail and the car take turns) and an
// asteroid. Saves a picture of the journal and of the car.
//
//   node scripts/sim/world-free-stage.mjs [--gpu]
// Needs the dev server on https://localhost:8082 (or SIM_APP).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { MEDIA_DIR } from './media.mjs';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const OUT = join(MEDIA_DIR, `world-free-stage-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(OUT, { recursive: true });
const MET = ['rocket', 'whale', 'car', 'asteroid'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};
const errors = [];
const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })).newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && !/status of 404/.test(m.text()) && errors.push(m.text()));

// The child's earlier nights: The Moth told to its Free Stage, and four world creatures met.
await page.goto(APP + '/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
await page.evaluate(async (met) => {
  const store = await import('/src/journal-store.ts');
  const moth = await (await fetch('story/the-moth.story.json')).json();
  const at = moth.beats.findIndex((b) => b.type === 'freestage');
  await store.saveProgress({ beatIndex: at, chapter: 'Free Stage', branch: '', savedAt: Date.now(), script: 'story/the-moth.story.json' });
  for (const id of met) await store.saveCreature({ id, discoveredAt: Date.now(), chapter: '' });
}, MET);
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
await sleep(1500);
await page.getByRole('button', { name: /Enter XR/i }).click();
await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().ready, null, { timeout: 30000 });
await page.waitForFunction(() => __sp.get('StoryState', 'freeStage'), null, { timeout: 30000 }).catch(() => undefined);
check('The Moth resumes at its Free Stage', Boolean(await page.evaluate(() => __sp.get('StoryState', 'freeStage'))), { beat: await page.evaluate(() => __sp.get('StoryState', 'beatId')) });

// The journal: the four met creatures are on its page.
await page.evaluate(() => __sp.set('ShadowJournal', 'open', true));
await sleep(2000);
const journal = await page.evaluate(() => __sp.get('ShadowJournal', 'discovered'));
await page.screenshot({ path: join(OUT, 'journal.png') });
check('the Shadow Journal has the world creatures met', MET.every((m) => journal.split(',').includes(m)), { journal });
await page.evaluate(() => __sp.set('ShadowJournal', 'open', false));
await sleep(1000);

// Free Stage: the demo player makes one shape after another.
await page.evaluate(() => {
  __sp.set('DemoDirector', 'persona', 'perfect');
  __sp.set('DemoDirector', 'playing', true);
});
const woke = [];
let shot = false;
const t0 = Date.now();
while (Date.now() - t0 < 30000) {
  const alive = await page.evaluate(() => __sp.puppets().filter((p) => p.state === 'alive').map((p) => p.shape));
  for (const a of alive) if (woke.at(-1) !== a) woke.push(a);
  if (!shot && alive.includes('car')) {
    shot = true;
    await sleep(600);
    await page.screenshot({ path: join(OUT, 'free-stage-car.png') });
  }
  await sleep(200);
}
const want = ['rabbit', 'rocket', 'snail', 'whale', 'car', 'asteroid'];
check(`Free Stage: ${want.join(', ')} wake in turn (the snail's pose twice: the snail, then the car)`, want.every((w, i) => woke.indexOf(w) >= 0 && (i === 0 || woke.indexOf(w) > woke.indexOf(want[i - 1]))), { woke });
check('no page errors', errors.length === 0, errors.slice(0, 3));
console.log(`pictures: ${OUT}`);
await browser.close();
const failed = results.filter((r) => !r).length;
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
