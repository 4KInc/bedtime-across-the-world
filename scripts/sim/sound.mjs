// Sound: the lullaby plays under the story (notes keep being scheduled),
// ducks under the narrator, is half as loud while paused, silent while the
// storyteller records with voice, and off with Music off; each creature has a
// little voice from where it is (the bird chirps when it wakes).
//
//   node scripts/sim/sound.mjs [--gpu]
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
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
// Which sound files actually start playing (creature voices are files, like the narration).
await context.addInitScript(() => {
  window.__played = [];
  const orig = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    window.__played.push(this.src);
    return orig.call(this);
  };
});
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
const sound = () => page.evaluate(() => __sp.view().sound);
await page.goto(APP + '/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
await sleep(1500);
await page.getByRole('button', { name: /Enter XR/i }).click();
await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().ready, null, { timeout: 30000 });
await page.evaluate(() => {
  __sp.set('DemoDirector', 'persona', 'perfect');
  __sp.set('DemoDirector', 'playing', true);
});

// Under the narrator.
await page.waitForFunction(() => __sp.get('StoryState', 'voiceBeat') === __sp.get('StoryState', 'beatId') && !__sp.get('StoryState', 'voiceDone'), null, { timeout: 60000 });
await sleep(1200);
const under = await sound();
await sleep(3000);
const later = await sound();
check('the lullaby plays (notes keep coming), ducked under the narrator', later.lullabyNotes > under.lullabyNotes && under.lullabyNotes > 0 && under.lullabyLevel === 0.35, { under, later });
check('in the headset, the lamp hums faintly', later.hum === true, { hum: later.hum });

// The bird wakes: its voice.
await page.waitForFunction(() => __sp.get('StoryState', 'beatId') === 'stars-bird-carry', null, { timeout: 90000 });
await sleep(800);
const birdFile = await page.evaluate(() => window.__played.some((src) => src.includes('sfx/creature-bird.mp3')));
check('the bird has its own voice when it wakes, played as a sound file like the narration', ((await sound()).creature.bird ?? 0) >= 1 && birdFile, { ...(await sound()).creature, birdFile });

// Paused (journal open): half as loud.
await page.evaluate(() => __sp.set('ShadowJournal', 'open', true));
await sleep(800);
check('paused: half as loud', (await sound()).lullabyLevel === 0.5, await sound());
await page.evaluate(() => __sp.set('ShadowJournal', 'open', false));
await sleep(800);

// Recording with voice: silent (it must not get into the recording).
await page.evaluate(() => {
  __sp.set('PerformanceRecorder', 'withVoice', true);
  __sp.set('PerformanceRecorder', 'recording', true);
});
await sleep(800);
const recording = await sound();
await page.evaluate(() => __sp.set('PerformanceRecorder', 'recording', false));
await sleep(500);
check('recording with voice: silent', recording.lullabyLevel === 0, recording);

// Music off.
await page.evaluate(() => __sp.set('Settings', 'music', false));
await sleep(800);
check('Music off: silent', (await sound()).lullabyLevel === 0, await sound());

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
