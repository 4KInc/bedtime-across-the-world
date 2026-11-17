// Full screen once a story has started. On an iPad and a computer (Nov 17) the
// Full screen button was only on the story list's panel, so once a story
// began it could not be chosen. Now an icon sits in the top-left corner while
// a story plays. On a tablet and a laptop, watching the sample story from Dad:
//   1. the icon shows in the top-left corner, clear of the caption and of the Pause/Join in/Stop pill;
//   2. pressing it goes full screen (its picture changes to "exit"); pressing again comes back;
//   3. it fades with the other controls when the story is left alone, and comes back on a touch.
//
//   node scripts/sim/viewer-fullscreen.mjs [--gpu]
// Needs the dev server (npm run dev) on https://localhost:8082.
import { chromium } from 'playwright';

const APP = process.env.SIM_APP ?? 'https://localhost:8082';
const RENDER = process.argv.includes('--gpu')
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = {}) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
};
const errors = [];
const overlap = (a, b) => a && b && a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const box = (r) => r && [r.left, r.top, r.right, r.bottom].map(Math.round);

const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });
try {
  for (const [device, viewport] of [['tablet', { width: 1180, height: 820 }], ['laptop', { width: 1440, height: 900 }]]) {
    const page = await (await browser.newContext({ viewport, ignoreHTTPSErrors: true })).newPage();
    page.on('pageerror', (e) => errors.push(`${device}: ${e}`));
    await page.goto(APP + '/?viewer', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__sp && document.querySelector('.sp-card'), null, { timeout: 60000 });
    const before = await page.evaluate(() => getComputedStyle(document.querySelector('.sp-fs-corner')).display);
    await page.getByRole('button', { name: /Watch A story from far away from Dad/ }).first().click();
    await page.waitForFunction(() => __sp.get('PerformancePlayer', 'position') > 3, null, { timeout: 30000 });
    await page.mouse.move(600, 400);
    await sleep(700);

    // 1. Where it is.
    const at = await page.evaluate(() => {
      const icon = document.querySelector('.sp-fs-corner');
      const r = icon.getBoundingClientRect();
      const pill = document.querySelector('.sp-viewer .sp-panel').getBoundingClientRect();
      return { display: getComputedStyle(icon).display, icon: [r.left, r.top, r.right, r.bottom], pill: [pill.left, pill.top, pill.right, pill.bottom], caption: __sp.onScreen('story-caption') };
    });
    const icon = at.icon.map(Math.round);
    check(`${device}: while the story plays, a full-screen icon in the top-left corner, clear of the caption and the controls`, before === 'none' && at.display === 'flex' && icon[0] < 40 && icon[1] < 40 && !overlap(icon, at.caption) && !overlap(icon, at.pill), { before, icon, caption: at.caption, pill: box({ left: at.pill[0], top: at.pill[1], right: at.pill[2], bottom: at.pill[3] }) });

    // 2. On, and off.
    const corner = page.locator('.sp-fs-corner');
    await corner.click();
    const on = await page.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 3000 }).then(() => true, () => false);
    const picture = await page.evaluate(() => ({ full: document.querySelector('.sp-fs-corner').classList.contains('full'), label: document.querySelector('.sp-fs-corner').getAttribute('aria-label') }));
    await page.mouse.move(620, 420);
    await corner.click();
    await sleep(600);
    const off = await page.evaluate(() => !document.fullscreenElement);
    const playing = await page.evaluate(() => __sp.get('PerformancePlayer', 'playing'));
    check(`${device}: the icon goes full screen (and shows "exit"), and back, with the story still playing`, on && picture.full && picture.label === 'Exit full screen' && off && playing, { on, picture, off, playing });

    // 3. Left alone, it fades with the controls; a touch brings it back.
    await sleep(4500);
    const faded = await page.evaluate(() => Number(getComputedStyle(document.querySelector('.sp-fs-corner')).opacity));
    await page.mouse.move(200, 200);
    await page.mouse.move(260, 240);
    await sleep(900);
    const back = await page.evaluate(() => Number(getComputedStyle(document.querySelector('.sp-fs-corner')).opacity));
    check(`${device}: it fades with the controls, and comes back on a touch`, faded < 0.05 && back > 0.95, { faded, back });
    await page.context().close();
  }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed || errors.length) process.exitCode = 1;
