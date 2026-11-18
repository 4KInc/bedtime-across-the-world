// A library story's caption says what its narrator says. On a Quest (Nov 18)
// with "Mia" saved as the child's name, the opening story's caption read
// "Tonight, Mia, ..." while the recorded narrator (voiced ahead of time) said
// "Tonight, little one, ...". Here the headset has Mia's name saved and The Shy
// Little Shark opens in XR (IWER):
//   1. the title line is voiced by its recorded clip, and its caption says "little one", not "Mia".
//
//   node scripts/sim/narrator-names.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082 (or SIM_APP).
import { chromium } from 'playwright';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const results = [];
const check = (name, ok, detail = {}) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};
const errors = [];
const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
  await context.addInitScript(() => performance.setResourceTimingBufferSize(5000));
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(APP + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  // The child's name, as "Who are the stories for?" saves it on this headset.
  await page.evaluate(() =>
    import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/src/journal-store.ts')) ?? '/src/journal-store.ts').then((s) =>
      s.saveFamily({ child: 'Mia', performer: 'Dad' }),
    ),
  );
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await page.getByRole('button', { name: /Enter XR/i }).click();
  await page.waitForFunction(() => window.IWER_DEVICE?.activeSession && window.__sp.view().ready, null, { timeout: 30000 });
  // Hands, not controllers (the story waits for them).
  await page.evaluate(() => IWER_DEVICE.remote.dispatch('set_input_mode', { mode: 'hand' }));
  await page.waitForFunction(() => /flying out over the sea/.test(__sp.get('StoryState', 'caption') ?? ''), null, { timeout: 30000 });
  await page.waitForFunction(() => __sp.get('StoryState', 'voiceSource'), null, { timeout: 10000 }).catch(() => undefined);
  const line = await page.evaluate(() => ({ caption: __sp.get('StoryState', 'caption'), voice: __sp.get('StoryState', 'voiceSource') }));
  check('the opening line is the recorded narrator, and its caption says "little one" as the voice does, not "Mia"', line.voice === 'clip' && /little one/.test(line.caption) && !/Mia/.test(line.caption), line);
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed || errors.length) process.exitCode = 1;
