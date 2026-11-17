// The app is called Bedtime Across the World (renamed Nov 17). Everywhere a
// person reads the name:
//   1. the tab title, the loading screen and the first caption on the start page;
//   2. the install name and the short name under the icon;
//   3. the family viewer, including the camera note a grown-up reads before Join in;
//   4. the old name appears nowhere on either page's visible text.
//
//   node scripts/sim/app-name.mjs
// Needs the dev server (npm run dev) on https://localhost:8082.
import { chromium } from 'playwright';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const NAME = 'Bedtime Across the World';
const results = [];
const check = (name, ok, detail = {}) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};
const errors = [];

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-certificate-errors'] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));

  // 1. The start page: the loading screen first, then the caption on the stage.
  await page.goto(APP + '/', { waitUntil: 'domcontentloaded' });
  const loading = await page.evaluate(() => document.querySelector('#sp-loading .title')?.textContent ?? '');
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await page.waitForFunction(() => (__sp.get('StoryState', 'caption') ?? '').length > 0, null, { timeout: 30000 }).catch(() => undefined);
  const start = await page.evaluate(() => ({ title: document.title, caption: __sp.get('StoryState', 'caption') ?? '', text: document.body.innerText }));
  check('start page: the tab, the loading screen and the first caption say Bedtime Across the World', start.title === NAME && loading === NAME && start.caption.startsWith(NAME), { title: start.title, loading, caption: start.caption });

  // 2. Installed from the Quest Browser menu.
  const manifest = await page.evaluate(async () => (await fetch('/manifest.webmanifest')).json());
  check('install name and the short name under the icon', manifest.name === NAME && manifest.short_name === 'Bedtime', { name: manifest.name, short: manifest.short_name });

  // 3. The family viewer, and the camera note shown before Join in.
  const viewer = await context.newPage();
  viewer.on('pageerror', (e) => errors.push(String(e)));
  await viewer.goto(APP + '/?viewer', { waitUntil: 'load' });
  await viewer.waitForFunction(() => window.__sp && document.querySelector('.sp-card'), null, { timeout: 60000 });
  // Join in on the sample story asks a grown-up first; the sheet is read, then "Not now" (the camera is never turned on).
  await viewer.getByRole('button', { name: /Watch A story from far away from Dad/ }).first().click();
  await viewer.getByRole('button', { name: 'Join in with your hands' }).click();
  const sheet = viewer.getByRole('dialog', { name: 'Allow the camera' });
  const note = await sheet.waitFor({ timeout: 10000 }).then(() => sheet.innerText(), () => '');
  await sheet.getByRole('button', { name: 'Not now' }).click().catch(() => undefined);
  const v = await viewer.evaluate(() => ({ title: document.title, text: document.body.innerText }));
  check('family viewer: titled Bedtime Across the World, and the camera note uses the name', v.title === NAME && note.includes(`To play along, ${NAME} uses`), { title: v.title, note: note.slice(0, 80) });

  // 4. The old name nowhere a person reads it.
  const old = /shadowplay/i;
  check('the old name appears in no visible text', !old.test(start.text) && !old.test(start.title) && !old.test(start.caption) && !old.test(v.text) && !old.test(note) && !old.test(manifest.name + manifest.short_name), {
    start: old.test(start.text),
    viewer: old.test(v.text),
  });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed || errors.length) process.exitCode = 1;
