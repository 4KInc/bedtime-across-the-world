// Store-ready PWA: the page links a valid web app manifest (name, start_url
// inside scope, 192 and 512 icons that load at their stated sizes). In the
// browser it waits for Enter XR as before; as the installed app (Meta's
// packaged PWAs expose getDigitalGoodsService) it enters XR by itself; the
// family viewer never does.
//
//   node scripts/sim/pwa.mjs
// Needs the dev server (npm run dev) on https://localhost:8082.
import { chromium } from 'playwright';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};
const errors = [];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-certificate-errors'] });

async function open(url, installed) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
  if (installed) await context.addInitScript(() => { window.getDigitalGoodsService = async () => ({}); });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(APP + url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  return page;
}

// The manifest and its icons.
let page = await open('/', false);
const m = await page.evaluate(async () => {
  const link = document.querySelector('link[rel="manifest"]');
  const res = await fetch(link.href);
  const json = await res.json();
  const base = new URL(link.href, location.href);
  const start = new URL(json.start_url, base).href;
  const scope = new URL(json.scope, base).href;
  const icons = await Promise.all(json.icons.map(async (i) => {
    const img = new Image();
    img.src = new URL(i.src, base).href;
    await img.decode();
    return { sizes: i.sizes, actual: `${img.naturalWidth}x${img.naturalHeight}`, purpose: i.purpose };
  }));
  return { type: res.headers.get('content-type'), name: json.name, short: json.short_name, display: json.display, start, scope, icons };
});
const sizes = new Set(m.icons.filter((i) => i.sizes === i.actual).map((i) => i.sizes));
check('a valid manifest: names, start_url inside scope, 192 and 512 icons at their sizes', !!m.name && !!m.short && m.start.startsWith(m.scope) && sizes.has('192x192') && sizes.has('512x512') && m.icons.every((i) => i.sizes === i.actual), m);

// In the browser: the first screen stays; nothing enters XR by itself.
await sleep(4000);
const browserView = await page.evaluate(() => ({ session: !!window.IWER_DEVICE?.activeSession, pwa: __sp.view().pwa }));
check('in the browser it waits for Enter XR', !browserView.session && !browserView.pwa.installed, browserView);
await page.context().close();

// As the installed app: straight into XR.
page = await open('/', true);
const entered = await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && __sp.view().ready, null, { timeout: 30000 }).then(() => true, () => false);
check('as the installed app it opens straight into XR, and the stage is set', entered, await page.evaluate(() => __sp.view().pwa));
await page.context().close();

// The family viewer (a phone or tablet), even installed: never into XR.
page = await open('/?viewer', true);
await sleep(4000);
const viewer = await page.evaluate(() => ({ session: !!window.IWER_DEVICE?.activeSession, pwa: __sp.view().pwa }));
check('the family viewer never enters XR by itself', !viewer.session && !viewer.pwa.autoEnter, viewer);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed.length || errors.length) process.exitCode = 1;
