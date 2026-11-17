// "Say your idea": in the dream chooser, the grown-up says what story they
// would like in their own words, and Mo writes it. Pressed by hand-ray pinch.
//   1. With the browser's own speech recognition: "I need a forest story with
//      dog and rabbit" -> a forest story asking for the dog, then the rabbit,
//      with the idea in the model's prompt.
//   2. As on the Quest Browser (no speech recognition): the microphone records
//      until the second press, the clip goes to /api/voice?for=wish, and an
//      idea that names nothing ("a story about being brave") is completed by
//      the model's pick.
// The dream itself runs the server's own code (server/dream.ts Dreamer) with a
// stand-in model, in the page's network routes.
//
//   node scripts/sim/dream-wish.mjs [--gpu] [--shot chooser.png]
// Needs the dev server on https://localhost:8082 (or SIM_APP).
import { chromium } from 'playwright';
import { checkDream, Dreamer } from '../../server/dream.ts';
import { cannedWords } from '../../tests/fixtures/dream-words.mjs';

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
// A fake microphone (a tone) for the recording path.
const browser = await chromium.launch({
  args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});

/** The stand-in model: a meadow with a dog and a bird when asked to pick; canned words for a story. */
const prompts = [];
const llm = {
  label: 'stand-in',
  text: async ({ system, user }) => {
    prompts.push({ system, user });
    if (/grown-up's idea/.test(system)) return '{"theme":"meadow","shapes":["dog","bird"]}';
    return cannedWords([...user.matchAll(/"shape":"([a-z]+)"/g)].map((m) => m[1]));
  },
};
const dreamer = new Dreamer(llm, 'writer', 'picker');

async function session({ browserSpeech }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true, permissions: ['microphone'] });
  const asked = [];
  const clips = [];
  await context.route('**/api/dream', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ json: { available: true } });
    const body = JSON.parse(req.postData() ?? '{}');
    asked.push(body);
    const story = await dreamer.dream(checkDream(body));
    return route.fulfill({ json: story });
  });
  await context.route('**/api/voice**', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ json: { available: true } });
    clips.push({ url: req.url(), bytes: req.postDataBuffer()?.length ?? 0, type: req.headers()['content-type'] });
    // A moment to work out the words, as the server takes (the button says Got it meanwhile):
    // long enough for the check below to see it on a slow machine.
    await sleep(4000);
    return route.fulfill({ json: { text: 'Can we have a story about being brave' } });
  });
  await context.addInitScript((browserSpeech) => {
    if (!browserSpeech) {
      // As on the Quest Browser: no speech recognition of its own.
      delete window.SpeechRecognition;
      delete window.webkitSpeechRecognition;
      return;
    }
    window.SpeechRecognition = class {
      start() {
        window.__rec = this;
      }
      stop() {
        this.onend?.();
      }
      abort() {
        this.onend?.();
      }
    };
    window.__say = (t) => {
      window.__rec?.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: t }], { isFinal: true })] });
      window.__rec?.onend?.();
    };
  }, browserSpeech);
  const page = await context.newPage();
  if (process.env.DEBUG) {
    page.on('request', (r) => /\/api\//.test(r.url()) && console.log('  >', r.method(), r.url()));
    page.on('console', (m) => console.log('  [page]', m.type(), m.text().slice(0, 160)));
  }
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/status of 404/.test(m.text()) && errors.push(m.text()));
  page.on('response', (r) => r.status() === 404 && !/\/api\//.test(r.url()) && errors.push(`404 ${r.url()}`));
  const remote = (m, p) => page.evaluate(([m, p]) => IWER_DEVICE.remote.dispatch(m, p), [m, p]);
  /** Aim the hand ray at a panel button and pinch; again if the press did not land (the ray can still be settling). */
  async function pinch(id) {
    // The panel glides into place beside the journal: wait until the button holds still.
    let t = null;
    for (let i = 0; i < 20; i++) {
      const now = await page.evaluate((id) => __sp.where(id), id);
      if (now && t && Math.hypot(now[0] - t[0], now[1] - t[1], now[2] - t[2]) < 0.002) break;
      t = now;
      await sleep(250);
    }
    if (!t) throw new Error(`no ${id} on the panel`);
    for (let tries = 0; tries < 3; tries++) {
      t = await page.evaluate((id) => __sp.where(id), id);
      const before = (await page.evaluate(() => __sp.presses())).length;
      await remote('look_at', { device: 'hand-right', target: { x: t[0], y: t[1], z: t[2] } });
      await sleep(300);
      await remote('set_select_value', { device: 'hand-right', value: 1 });
      await sleep(250);
      await remote('set_select_value', { device: 'hand-right', value: 0 });
      await sleep(500);
      const after = await page.evaluate(() => __sp.presses());
      if (after.length > before && after.at(-1) === id) return;
    }
    console.log(`(pinch on ${id} did not land after 3 tries)`);
  }
  await page.goto(APP + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await sleep(1500);
  await page.getByRole('button', { name: /Enter XR/i }).click();
  await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().ready, null, { timeout: 30000 });
  await sleep(1500);
  await page.evaluate(() => __sp.set('DemoDirector', 'playing', false));
  await page.evaluate(() => __sp.set('ShadowJournal', 'open', true));
  await sleep(1200);
  await remote('set_input_mode', { mode: 'hand' });
  await sleep(800);
  await pinch('story-dream');
  return { page, pinch, asked, clips, context };
}

/** The dreamed story now playing: its shapes in order and its first scenery. */
async function playing(page) {
  await page.waitForFunction(() => /^dreamed:/.test(__sp.get('StoryState', 'script')), null, { timeout: 20000 }).catch(() => {});
  return page.evaluate(() => ({ script: __sp.get('StoryState', 'script'), dream: __sp.view().dream }));
}
const shapesOf = (story) => ({
  shapes: story.beats.filter((b) => b.type === 'request').map((b) => b.shape),
  scenery: story.beats.find((b) => b.type === 'scenery')?.set,
});

// 1. The browser's own speech recognition.
{
  const { page, pinch, asked, context } = await session({ browserSpeech: true });
  const shotAt = process.argv.indexOf('--shot');
  if (shotAt > 0) await page.screenshot({ path: process.argv[shotAt + 1] });
  await pinch('dream-say');
  const listening = await page.evaluate(() => __sp.view().dream.wish.state);
  await page.evaluate(() => window.__say('I need a forest story with dog and rabbit'));
  const now = await playing(page);
  const story = asked.length ? await dreamer.dream(checkDream(asked[0])) : null;
  const prompt = prompts.filter((p) => !/grown-up's idea/.test(p.system)).at(-1)?.user ?? '';
  check('Say your idea listens after the press', listening === 'listening', { listening });
  check('"I need a forest story with dog and rabbit" is asked for in those words', asked.length === 1 && asked[0].wish === 'I need a forest story with dog and rabbit', { asked });
  check('Mo dreams a forest story asking for the dog, then the rabbit', !!story && JSON.stringify(shapesOf(story)) === JSON.stringify({ shapes: ['dog', 'rabbit'], scenery: 'forest' }), story && shapesOf(story));
  check('the idea reaches the model in plain words', prompt.includes('I need a forest story with dog and rabbit'));
  check('the dreamed story starts and the chooser closes', /^dreamed:/.test(now.script) && !now.dream.chooser.open && now.dream.wish.state === '', now);
  await context.close();
}

// 2. As on the Quest Browser: recorded, understood by the server, completed by the model's pick.
{
  const before = prompts.length;
  const { page, pinch, asked, clips, context } = await session({ browserSpeech: false });
  await pinch('dream-say');
  // Soon after the press: the emulator's fake microphone plays a tone, which counts as speech, so
  // listening can end by itself after a pause.
  await sleep(800);
  const listening = await page.evaluate(() => __sp.view().dream.wish.state);
  const whileListening = await page.evaluate(() => __sp.view().dream.wish.label);
  if (process.env.DEBUG) console.log('  presses', await page.evaluate(() => __sp.presses()));
  if (listening === 'listening') await pinch('dream-say'); // done
  // The microphone is off and the words are being worked out.
  await page.waitForFunction(() => __sp.view().dream.wish.state === 'understanding', null, { timeout: 4000, polling: 50 }).catch(() => undefined);
  const afterDone = await page.evaluate(() => ({ ...__sp.view().dream.wish, listen: undefined }));
  if (process.env.DEBUG) {
    for (let i = 0; i < 8; i++) {
      console.log('  wish', JSON.stringify(await page.evaluate(() => __sp.view().dream.wish)), await page.evaluate(() => __sp.presses().slice(-3)));
      await sleep(500);
    }
  }
  const now = await playing(page);
  const picked = prompts.slice(before).filter((p) => /grown-up's idea/.test(p.system));
  const story = asked.length ? await dreamer.dream(checkDream(asked[0])) : null;
  check('Quest path: the microphone records until the second press', listening === 'listening', { listening });
  // Quest 3, Nov 16: the hint said to press Done, but no button said Done, and nothing showed the listening had ended.
  check('Quest path: the button says Done while listening, then Got it while the words are worked out', whileListening === 'Done' && afterDone.state === 'understanding' && afterDone.label === 'Got it', { whileListening, afterDone });
  check('Quest path: one clip goes to /api/voice?for=wish as audio/webm', clips.length === 1 && /for=wish/.test(clips[0].url) && clips[0].bytes > 1000 && /audio\/webm/.test(clips[0].type), clips);
  check('Quest path: what it heard is dreamed as the idea', asked.length === 1 && asked[0].wish === 'Can we have a story about being brave', { asked });
  check('an idea that names nothing: the model picks the place and shapes', picked.length >= 1 && !!story && JSON.stringify(shapesOf(story)) === JSON.stringify({ shapes: ['dog', 'bird'], scenery: 'field' }), story && shapesOf(story));
  check('Quest path: the dreamed story starts', /^dreamed:/.test(now.script) && now.dream.wish.state === '', now);
  await context.close();
}

// 3. A creature the chooser does not offer, named in the idea (Quest 3, Nov 15: the crocodile came back as a dog).
{
  const { page, pinch, asked, context } = await session({ browserSpeech: true });
  await pinch('dream-say');
  await page.evaluate(() => window.__say('Tell me a story with a fish and a crocodile'));
  const now = await playing(page);
  const story = asked.length ? await dreamer.dream(checkDream(asked[0])) : null;
  const sets = story ? story.beats.filter((b) => b.type === 'scenery').map((b) => b.set) : [];
  check('"a fish and a crocodile" is asked for in those words', asked.length === 1 && asked[0].wish === 'Tell me a story with a fish and a crocodile', { asked });
  check('Mo dreams the fish, then the crocodile (no dog added), by the river', !!story && JSON.stringify(shapesOf(story).shapes) === '["fish","crocodile"]' && sets.at(-1) === 'river', { ...(story && shapesOf(story)), sets });
  check('the fish-and-crocodile story starts', /^dreamed:/.test(now.script), now);
  await context.close();
}

// 4. The story worlds' creatures, named in an idea (Quest 3, Nov 17: a T. rex and a pterodactyl were dropped),
//    then played by the demo player: both wake on the wall.
{
  const { page, pinch, asked, context } = await session({ browserSpeech: true });
  await pinch('dream-say');
  await page.evaluate(() => window.__say('a story with a T. rex and a pterodactyl'));
  const now = await playing(page);
  const story = asked.length ? await dreamer.dream(checkDream(asked[0])) : null;
  check('"a T. rex and a pterodactyl": both in the dreamed story', !!story && JSON.stringify(shapesOf(story).shapes) === '["trex","pterodactyl"]', story && shapesOf(story));
  await page.evaluate(() => {
    __sp.set('DemoDirector', 'persona', 'perfect');
    __sp.set('DemoDirector', 'playing', true);
  });
  const woke = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 240000 && woke.size < 2) {
    const m = await page.evaluate(() => (__sp.get('ShapeRecognizer', 'matchedHand') !== 'none' ? __sp.get('ShapeRecognizer', 'matchedShape') : ''));
    if (m === 'trex' || m === 'pterodactyl') woke.add(m);
    await sleep(250);
  }
  check('the T. rex and the pterodactyl both wake on the wall', /^dreamed:/.test(now.script) && woke.size === 2, { woke: [...woke] });
  await context.close();
}

check('no page errors', errors.length === 0, errors.slice(0, 3));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
