// "Say it" hears a child's story wish on an iPad. On an iPad (Nov 18), asking
// for tomorrow's story in a goodnight back, every try ended "Mo did not hear
// that": Safari's own speech recognition ended without words. Here the page
// behaves like that iPad (Safari's vendor and user agent, touch, and a recognition that
// ends with no words), the microphone is a stand-in tone the sim switches on
// (no microphone is opened) and the speech server is answered by the sim:
//   1. iPad: the first Say it is heard (through the server; Safari's own is not used), as WAV where WebM cannot be recorded;
//   2. elsewhere: a browser recognition that hears nothing says so once, and the next try goes through the server.
//
//   node scripts/sim/say-it-ipad.mjs [--gpu]
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
const WISH = 'a story about Mo at the carnival';
const IPAD_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

const browser = await chromium.launch({ args: [...RENDER, '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'] });

/** A family viewer with the goodnight's gift picker open; the speech server answered by the sim. */
async function viewer(options, touchPoints = 0, noWebm = false) {
  const context = await browser.newContext({ viewport: { width: 900, height: 1000 }, ignoreHTTPSErrors: true, ...options });
  // An iPad: Safari (vendor Apple) with five touch points (it says it is a Mac).
  if (touchPoints) {
    await context.addInitScript((n) => {
      Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => n });
      Object.defineProperty(Navigator.prototype, 'vendor', { get: () => 'Apple Computer, Inc.' });
    }, touchPoints);
  }
  // A browser that cannot record WebM/Opus.
  if (noWebm) await context.addInitScript(() => (MediaRecorder.isTypeSupported = () => false));
  await context.addInitScript(() => {
    performance.setResourceTimingBufferSize(5000);
    window.__said = { browserStarts: 0 };
    // The browser's own recognition, as on the iPad: it starts, then ends with no words.
    window.webkitSpeechRecognition = window.SpeechRecognition = class {
      start() {
        window.__said.browserStarts++;
        setTimeout(() => this.onend?.(), 1500);
      }
      stop() {}
      abort() {}
    };
    // The microphone: a tone the sim speaks with for a second and a half, then silence.
    navigator.mediaDevices.getUserMedia = async () => {
      const ac = new AudioContext();
      const osc = ac.createOscillator();
      osc.frequency.value = 220;
      const gain = ac.createGain();
      gain.gain.value = 0.3;
      gain.gain.setValueAtTime(0, ac.currentTime + 1.5);
      const dest = ac.createMediaStreamDestination();
      osc.connect(gain).connect(dest);
      osc.start();
      return dest.stream;
    };
  });
  const sent = [];
  await context.route(/\/api\/voice(\?.*)?$/, async (route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ json: { available: true } });
    sent.push({ type: req.headers()['content-type'], bytes: req.postDataBuffer()?.length ?? 0, wish: req.url().includes('for=wish') });
    return route.fulfill({ json: { text: WISH } });
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(APP + '/?viewer', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sp, null, { timeout: 60000 });
  await page.evaluate(() => __sp.giftPicker('Dad'));
  const say = page.getByRole('button', { name: 'Say it' });
  await say.waitFor({ state: 'visible', timeout: 10000 });
  return { page, sent, say };
}

/** Press Say it and wait for the outcome: the idea's words and the note. */
async function sayIt(v) {
  await v.say.click();
  await v.page.waitForFunction(() => document.querySelector('[data-act="say-idea"]')?.textContent === 'Say it', null, { timeout: 20000 });
  return v.page.evaluate(() => ({ idea: document.querySelector('[data-idea]').value, note: document.querySelector('[data-idea-note]').textContent, browserStarts: window.__said.browserStarts }));
}

try {
  // 1. The iPad.
  const ipad = await viewer({ userAgent: IPAD_UA, hasTouch: true }, 5);
  const first = await sayIt(ipad);
  check("iPad: the first Say it is heard, through the server (Safari's own recognition is not used)", first.idea === WISH && first.browserStarts === 0 && ipad.sent.length === 1 && ipad.sent[0].wish, { first, sent: ipad.sent });
  await ipad.page.context().close();
  // ...and an iPad that cannot record WebM: the raw audio, as 16 kHz WAV under the server's limit (224 KB).
  const wav = await viewer({ userAgent: IPAD_UA, hasTouch: true }, 5, true);
  const w = await sayIt(wav);
  check('iPad without WebM recording: heard, sent as WAV under the limit', w.idea === WISH && wav.sent[0]?.type === 'audio/wav' && wav.sent[0].bytes < 224 * 1024, { w, sent: wav.sent });
  await wav.page.context().close();

  // 2. Elsewhere: the browser's own recognition first; when it hears nothing, the server next time.
  const desk = await viewer({});
  const one = await sayIt(desk);
  const two = await sayIt(desk);
  check('elsewhere: an empty browser recognition says so once, and the next try is heard through the server', one.idea === '' && /did not hear/.test(one.note) && two.idea === WISH && two.browserStarts === 1 && desk.sent.length === 1, { one, two, sent: desk.sent });
  await desk.page.context().close();
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed, ${errors.length} page errors`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (failed || errors.length) process.exitCode = 1;
