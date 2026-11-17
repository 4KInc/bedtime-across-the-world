// A child asks for tomorrow's story. On the family viewer, with a goodnight,
// Sam types "Dad, tell me an Elsa story about Mo at the carnival" (Elsa is
// left out, and the grown-up is told why) and picks a dog in pictures; the
// goodnight goes to the server under the story's code. On the storyteller's
// headset the request arrives with the goodnight: the story's caption says so,
// the journal's chooser shows "Sam asked: ..." and "Dream Sam's story", which
// plans it into the closest place the app has (the carnival, in the meadow)
// and dreams it there; the request is then answered. Mo's suggestions for Sam,
// from Sam's taste, are on the panel, and one goes into the chooser.
// Mia's sample goodnight asks for a carnival story too (for someone alone).
// Across the world: the viewer is in India, the headset in Chicago; Sam's
// goodnight carries only the phone's offset (UTC+5:30), and the headset's
// journal shows Sam's time there.
//
//   node scripts/sim/story-request.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082 (or SIM_APP).
// The server's answers (stories, plans, suggestions, dreams) are the real
// server's own functions, called here, so no model or API server is needed.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { assembleStory, checkDream, checkTaste, planByWords, suggestByTaste } from '../../server/dream.ts';
import { checkPerformance } from '../../server/guard.ts';
import { checkAsk } from '../../src/story-checks.ts';
import { clockText, localMinutes } from '../../src/bedtime-clock.ts';
import { cannedWords } from '../../tests/fixtures/dream-words.mjs';
import { MEDIA_DIR } from './media.mjs';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const OUT = join(MEDIA_DIR, `story-request-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};
const errors = [];
const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });

// The server, as far as this needs it: one shared story's goodnights, plans, suggestions and dreams.
const CODE = 'lantern-otter-moss-417';
const replies = [];
const dreams = [];
const plans = [];
const tastes = [];
async function serve(context) {
  await context.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const body = () => JSON.parse(req.postData() ?? '{}');
    if (path === `/api/stories/${CODE}/replies`) {
      if (req.method() === 'GET') return route.fulfill({ json: { code: CODE, replies } });
      const perf = body();
      const problem = checkPerformance(perf, 4_000_000);
      if (problem) return route.fulfill({ status: 400, json: { error: problem } });
      replies.push({ ...perf, ask: checkAsk(perf.ask) ?? undefined });
      return route.fulfill({ status: 201, json: { ok: true } });
    }
    if (path === '/api/dream/plan') {
      const asked = checkDream({ wish: '', ...body() });
      const plan = planByWords(asked);
      plans.push(plan);
      return route.fulfill({ json: { theme: plan.theme, shapes: plan.shapes, ...(plan.setting ? { setting: plan.setting } : {}), by: 'words' } });
    }
    if (path === '/api/dream/suggest') {
      const taste = checkTaste(body());
      tastes.push(taste);
      return taste ? route.fulfill({ json: { ideas: suggestByTaste(taste), by: 'taste' } }) : route.fulfill({ status: 400, json: {} });
    }
    if (path === '/api/dream') {
      if (req.method() === 'GET') return route.fulfill({ json: { available: true } });
      const asked = checkDream(body());
      dreams.push(asked);
      return route.fulfill({ json: assembleStory(asked, cannedWords(asked.shapes)) });
    }
    if (path === '/api/voice') return route.fulfill({ json: { available: false } });
    if (path === '/api/speak') return route.fulfill({ status: 404, body: '' });
    return route.continue();
  });
}

// A. The family viewer: Sam's goodnight asks for tomorrow's story.
const vctx = await browser.newContext({ viewport: { width: 900, height: 1100 }, ignoreHTTPSErrors: true, timezoneId: 'Asia/Kolkata' });
await serve(vctx);
const viewer = await vctx.newPage();
viewer.on('pageerror', (e) => errors.push(String(e)));
await viewer.goto(APP + '/?viewer', { waitUntil: 'load' });
await viewer.waitForFunction(() => window.__sp, null, { timeout: 60000 });
await viewer.evaluate(() => __sp.giftPicker('Dad'));
await viewer.locator('[data-idea]').fill('Dad, tell me an Elsa story about Mo at the carnival');
await viewer.getByRole('button', { name: 'Dog' }).click();
const note = await viewer.locator('[data-idea-note]').textContent();
const canHear = await viewer.evaluate(() => import('/src/wish-listener.ts').then((m) => m.canHearWishes()));
const sayShown = await viewer.locator('[data-act="say-idea"]').isVisible();
const gifts = await viewer.evaluate(() => window.__gifts.get());
await viewer.locator('.sp-ask').screenshot({ path: join(OUT, 'viewer-ask.png') });
check('the viewer: Elsa is left out (and the grown-up told why), the rest of the idea and a dog are asked for', gifts.ask?.words === 'Dad, tell me a story about Mo at the carnival' && gifts.ask.shapes?.join() === 'dog' && /leave out "elsa"/.test(note), { ask: gifts.ask, note });
check('the viewer: "Say it" is there exactly where the browser can hear an idea (else type it or pick pictures)', sayShown === canHear, { sayShown, canHear });
// The goodnight itself (a few hand frames, as the viewer records it), sent with the request.
const sent = await viewer.evaluate(async ([code, ask]) => {
  const perf = {
    version: 'shadowplay.performance.v1', id: 'goodnight-from-sam', title: 'A goodnight from Sam', performer: 'Sam', createdAt: Date.now(),
    durationMs: 2000, script: '', frameHz: 30, hands: btoa(String.fromCharCode(...new Uint8Array(2 * 151 * 2))), frameCount: 2,
    events: [{ t: 500, type: 'wake', data: { shape: 'whale', hand: 'right', twoHanded: false } }], audio: null, ask,
    tz: (await import('/src/bedtime-clock.ts')).deviceTz(),
  };
  const r = await fetch(`/api/stories/${code}/replies`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(perf) });
  return r.status;
}, [CODE, gifts.ask]);
check('the goodnight with its request is accepted by the server, the request checked', sent === 201 && replies[0]?.ask?.words === gifts.ask.words, { status: sent, ask: replies[0]?.ask });
check("the goodnight carries the phone's offset from UTC (India: +5:30), not a place", replies[0]?.tz === 330, { tz: replies[0]?.tz });
await vctx.close();

// B. The storyteller's headset: the story was sent with CODE; the goodnight and the request arrive.
const hctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true, timezoneId: 'America/Chicago' });
await serve(hctx);
const page = await hctx.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && !/status of 404/.test(m.text()) && errors.push(m.text()));
await page.goto(APP + '/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
await page.evaluate((code) => import('/src/journal-store.ts').then((s) => s.saveRecording({
  version: 'shadowplay.performance.v1', id: 'sent-to-sam', title: 'A story for Sam', performer: 'Dad', child: 'Sam', shareCode: code,
  createdAt: Date.now() - 86_400_000, durationMs: 1000, script: 'story/counting-stars.story.json', frameHz: 30, hands: '', frameCount: 0, events: [],
})), CODE);
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
await page.evaluate(() => import('/src/story-requests.ts').then((m) => (window.__req = m.requestsRuntime)));
const req = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__req)));
await page.waitForFunction(() => window.__req.pending && window.__req.child, null, { timeout: 30000, polling: 500 }).catch(() => undefined);
const arrived = await req();
check("the requests arrive with the goodnights: Mia's sample asks for the carnival, and Sam's too", arrived.pending?.from === 'Mia' && arrived.child === 'Sam', { pending: arrived.pending, child: arrived.child });

await sleep(1000);
await page.getByRole('button', { name: /Enter XR/i }).click();
await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().ready, null, { timeout: 30000 });
// Across the world: the journal shows what time it is for Sam, in India.
await page.waitForFunction(() => /for Sam\./.test(__sp.view().dream.shown.clock), null, { timeout: 20000, polling: 500 }).catch(() => undefined);
const clock = await page.evaluate(() => __sp.view().dream.shown.clock);
const india = [0, 1].map((m) => clockText(localMinutes(Date.now() - m * 60_000, 330)));
check("the headset's journal shows Sam's time (in India, from a headset in Chicago)", india.some((t) => clock.startsWith(`It's ${t} for Sam.`)), { clock, india });
const remote = (m, p) => page.evaluate(([m, p]) => IWER_DEVICE.remote.dispatch(m, p), [m, p]);
async function pinch(id) {
  const t = await page.evaluate((id) => __sp.where(id), id);
  if (!t) throw new Error(`no ${id} on the panel`);
  await remote('look_at', { device: 'hand-right', target: { x: t[0], y: t[1], z: t[2] } });
  await sleep(300);
  await remote('set_select_value', { device: 'hand-right', value: 1 });
  await sleep(250);
  await remote('set_select_value', { device: 'hand-right', value: 0 });
  await sleep(500);
}
const shown = () => page.evaluate(() => __sp.view().dream.shown);
const status = async () => (await shown()).status;
await sleep(1500);
await page.evaluate(() => __sp.set('ShadowJournal', 'open', true));
await remote('set_input_mode', { mode: 'hand' });
await sleep(1200);
/** "Dream a new one", once more if the first pinch after the hands appear is missed (as in dream-choose). */
async function openChooser() {
  // (It toggles: wait to see the first pinch land before trying again.)
  for (let i = 0; i < 2; i++) {
    await pinch('story-dream');
    if (await page.waitForFunction(() => __sp.view().dream.chooser.open, null, { timeout: 3000 }).then(() => true, () => false)) return;
  }
}
await openChooser();
await page.waitForFunction(() => window.__req.ideas.length > 0, null, { timeout: 15000, polling: 300 }).catch(() => undefined);
await sleep(800);
const opened = { status: await status(), ask: (await shown()).ask, go: (await shown()).askButton };
check('the chooser: "Mia asked: ...", and "Dream Mia\'s story"', /Mia asked: "Dad, tell me a story about Mo at the carnival"/.test(opened.ask) && opened.go === "Dream Mia's story" && /Mia asked for a story/.test(opened.status), opened);
const ideas = (await req()).ideas;
const ideasLabel = (await shown()).ideasLabel;
check("Mo's suggestions for Sam, from Sam's taste (no name sent)", ideas.length >= 2 && ideasLabel === 'Sam might like' && tastes.length > 0 && !JSON.stringify(tastes).includes('Sam'), { ideas: ideas.map((i) => i.title), ideasLabel, taste: tastes.at(-1) });
await page.screenshot({ path: join(OUT, 'headset-chooser.png') });

await pinch('dream-ask-go');
await page.waitForFunction(() => /carnival in the meadow/.test(__sp.view().dream.shown.status), null, { timeout: 15000 }).catch(() => undefined);
const planned = { status: await status(), chooser: await page.evaluate(() => __sp.view().dream.chooser) };
check("Dream Mia's story: planned into the closest place (the carnival, in the meadow), shown before dreaming", planned.chooser.theme === 'meadow' && planned.chooser.shapes.length >= 2 && /at a little carnival in the meadow/.test(planned.status), planned);
await page.screenshot({ path: join(OUT, 'headset-planned.png') });
await pinch('dream-go');
await page.waitForFunction(() => /^dreamed:/.test(__sp.get('StoryState', 'script') ?? ''), null, { timeout: 20000 }).catch(() => undefined);
const dreamed = dreams.at(-1);
check('the story is dreamed at the carnival, from Mia\'s words, in the meadow', dreamed?.theme === 'meadow' && /carnival/.test(dreamed?.wish ?? '') && /carnival/.test(dreamed?.setting ?? ''), dreamed);
await page.waitForFunction(() => window.__req.pending?.from === 'Sam', null, { timeout: 10000, polling: 300 }).catch(() => undefined);
const next = await req();
check("Mia's request is answered; Sam's waits next", next.pending?.from === 'Sam' && /carnival/.test(next.pending.words) && next.pending.shapes?.join() === 'dog', next.pending);
await page.screenshot({ path: join(OUT, 'headset-dreamed.png') });

// Sam's request, from the caption at the story's next pause, and one of Mo's suggestions into the chooser.
await page.evaluate(() => __sp.set('ShadowJournal', 'open', true));
await sleep(1200);
await openChooser();
await page.waitForFunction(() => window.__req.ideas.length > 0, null, { timeout: 15000, polling: 300 }).catch(() => undefined);
await sleep(800);
await pinch('dream-idea-1');
await sleep(500);
const idea = { status: await status(), chooser: await page.evaluate(() => __sp.view().dream.chooser), first: (await req()).ideas[0] };
check("one of Mo's suggestions goes into the chooser (its place and shapes), with why Sam would like it", idea.chooser.theme === idea.first.theme && idea.chooser.shapes.join() === idea.first.shapes.join() && idea.status.includes(idea.first.why), idea);
await pinch('dream-go');
await sleep(1500);
check('a suggestion dreams with its idea as the words (and leaves Sam\'s request waiting)', dreams.at(-1)?.wish === idea.first.idea && (await req()).pending?.from === 'Sam', { dreamed: dreams.at(-1) });

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
console.log(`pictures: ${OUT}`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
