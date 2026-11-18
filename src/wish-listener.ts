/**
 * "Say your idea": listens for one spoken story idea ("I need a forest story
 * with a dog and a rabbit") and gives back the words. The microphone is open
 * only from the press until the idea is said (it stops after a pause, after
 * MAX_SECONDS, or on a second press), never otherwise.
 *
 * Uses the browser's own speech recognition where it has one and it works;
 * otherwise records the idea and the server turns it into words
 * (/api/voice?for=wish, Cloud Speech-to-Text; nothing is stored). On an iPad
 * (Nov 18) Safari's own recognition ended with no words every time ("Mo did not
 * hear that"), so on iPads and iPhones the server is used from the start, and
 * elsewhere a browser recognition that hears nothing hands over to the server
 * for the next try.
 */
import { downsample, encodeWav, joinParts } from './voice-clip.js';


/** Long enough for a sentence or two; a pause this long after speaking ends it. */
const MAX_SECONDS = 10;
const END_SILENCE_SECONDS = 1.2;
/** Nothing said at all for this long: give up. */
const NO_SPEECH_SECONDS = 6;
const SPEECH_RMS = 0.025;
/** Shorter than this, a press and a second press is not an idea. */
const MIN_SECONDS = 0.6;
const TICK_MS = 50;
/** WAV (where the browser cannot record WebM/Opus) is 32 KB a second: kept under the server's 224 KB. */
const MAX_WAV_SECONDS = 6.5;
const WEBM = 'audio/webm;codecs=opus';

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionClass = new () => Recognition;

/**
 * The last listen, for tests and diagnostics (never the words): how long, how loud at most, whether
 * speech was heard, bytes sent, how, the browser's error, whether words came back; and the count.
 */
export const wishListenRuntime = {
  seconds: 0,
  peak: 0,
  heard: false,
  bytes: 0,
  how: '' as '' | 'browser' | 'server',
  format: '' as '' | 'webm' | 'wav',
  error: '',
  understood: false,
  tries: 0,
  /** Listens whose outcome is known (words or none). */
  finished: 0,
};

/** The browser's own recognition heard nothing here once: the server listens from then on. */
let browserFailed = false;

export interface WishListening {
  /** The words said ('' when nothing was understood); rejects when the microphone could not be used. */
  words: Promise<string>;
  /** Resolves when the microphone stops (a pause, the time limit, or Done); the words may take a moment more. */
  stopped: Promise<void>;
  /** Finish now (the second press): what was said so far is used. */
  finish(): void;
  /** Stop without using it. */
  cancel(): void;
}

/** Whether there is any way to hear an idea here (the browser's own, or the server's). */
export async function canHearWishes(): Promise<boolean> {
  // Asked as the Say it button is shown, so the first press already knows whether the server can hear.
  const server = serverHears().then((ok) => (serverHearing = ok));
  if (browserRecognition()) return true;
  return server;
}

let serverAnswer: Promise<boolean> | null = null;
/** Whether the server can turn speech into words (asked once). */
function serverHears(): Promise<boolean> {
  serverAnswer ??= askServer();
  return serverAnswer;
}

async function askServer(): Promise<boolean> {
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') return false;
  try {
    const r = await fetch('/api/voice');
    return r.ok && Boolean(((await r.json()) as { available?: boolean }).available);
  } catch {
    return false;
  }
}

function browserRecognition(): RecognitionClass | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/**
 * An iPad or iPhone: every browser there is Safari's WebKit (vendor Apple), and an iPad says it is a
 * Mac, so it is told apart by its touch screen.
 */
function appleTouch(): boolean {
  return (navigator.vendor === 'Apple Computer, Inc.' || /iPad|iPhone|iPod/.test(navigator.userAgent)) && navigator.maxTouchPoints > 1;
}

export function listenForWish(): WishListening {
  const Recognition = browserRecognition();
  // The server when the browser's own recognition is missing, unreliable here (an iPad: unless the
  // server is known not to hear), or has failed once (when the server is known to hear).
  const useServer = !Recognition || (appleTouch() && serverHearing !== false) || (browserFailed && serverHearing === true);
  wishListenRuntime.tries++;
  return useServer ? withServer() : withBrowser(Recognition);
}

/** Whether the server can hear (canHearWishes asks as the Say it button is shown; undefined until it answers). */
let serverHearing: boolean | undefined;

function withBrowser(Recognition: RecognitionClass): WishListening {
  const r = new Recognition();
  r.continuous = false;
  // Interim results too: some browsers end without a final one (the last words heard are kept).
  r.interimResults = true;
  r.lang = 'en-US';
  let said = '';
  let cancelled = false;
  Object.assign(wishListenRuntime, { seconds: 0, peak: 0, heard: false, bytes: 0, how: 'browser', format: '', error: '', understood: false });
  const started = performance.now();
  const words = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => r.stop(), MAX_SECONDS * 1000);
    r.onresult = (e) => {
      said = Array.from(e.results, (res) => res[0]?.transcript ?? '').join(' ').trim();
    };
    r.onerror = (e) => {
      wishListenRuntime.error = e.error;
      if (e.error === 'not-allowed') reject(new Error('microphone'));
    };
    r.onend = () => {
      clearTimeout(timer);
      wishListenRuntime.seconds = (performance.now() - started) / 1000;
      wishListenRuntime.understood = !cancelled && said !== '';
      // Nothing heard (an error, or no words at all): the server listens next time, if it can.
      if (!cancelled && said === '') browserFailed = true;
      wishListenRuntime.finished++;
      resolve(cancelled ? '' : said);
    };
    try {
      r.start();
    } catch {
      browserFailed = true;
      resolve('');
    }
  });
  return {
    words,
    stopped: words.then(
      () => undefined,
      () => undefined,
    ),
    finish: () => r.stop(),
    cancel: () => {
      cancelled = true;
      r.abort();
    },
  };
}

function withServer(): WishListening {
  let finish = () => {};
  let cancel = () => {};
  let micStopped = () => {};
  const stoppedSignal = new Promise<void>((resolve) => (micStopped = resolve));
  const words = (async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const audio = new AudioContext();
    void audio.resume();
    const analyser = audio.createAnalyser();
    analyser.fftSize = 1024;
    const source = audio.createMediaStreamSource(stream);
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    // WebM/Opus where the browser records it (speech needs little: 32 kbit/s keeps ten seconds well under
    // the server's limit, MAX_CLIP_BYTES, 224 KB); otherwise the raw audio, sent as 16 kHz WAV.
    const webm = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(WEBM);
    const maxSeconds = webm ? MAX_SECONDS : MAX_WAV_SECONDS;
    const chunks: Blob[] = [];
    const parts: Float32Array[] = [];
    let recorder: MediaRecorder | null = null;
    let capture: ScriptProcessorNode | null = null;
    let ended = () => {};
    const stopped = new Promise<void>((resolve) => (ended = resolve));
    if (webm) {
      recorder = new MediaRecorder(stream, { mimeType: WEBM, audioBitsPerSecond: 32000 });
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = () => ended();
      recorder.start();
    } else {
      capture = audio.createScriptProcessor(2048, 1, 1);
      capture.onaudioprocess = (e) => parts.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      source.connect(capture);
      // (It only runs while connected to an output; it writes silence.)
      capture.connect(audio.destination);
    }
    let heard = false;
    let cancelled = false;
    let done = false;
    Object.assign(wishListenRuntime, { seconds: 0, peak: 0, heard: false, bytes: 0, how: 'server', format: webm ? 'webm' : 'wav', error: '', understood: false });
    // Real time (a busy frame can delay the ticks).
    const started = performance.now();
    let last = started;
    let quiet = 0;
    let byHand = false;
    const stop = () => {
      if (done) return;
      done = true;
      if (recorder) recorder.state !== 'inactive' ? recorder.stop() : ended();
      else ended();
    };
    const tick = setInterval(() => {
      const now = performance.now();
      const t = (now - started) / 1000;
      const dt = (now - last) / 1000;
      last = now;
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
      const rms = Math.sqrt(sum / samples.length);
      const speaking = rms > SPEECH_RMS;
      wishListenRuntime.peak = Math.max(wishListenRuntime.peak, rms);
      heard ||= speaking;
      quiet = speaking ? 0 : quiet + dt;
      if (t >= maxSeconds || (heard && quiet >= END_SILENCE_SECONDS) || (!heard && t >= NO_SPEECH_SECONDS)) stop();
    }, TICK_MS);
    finish = () => {
      byHand = true;
      stop();
    };
    cancel = () => {
      cancelled = true;
      stop();
    };
    await stopped;
    micStopped();
    clearInterval(tick);
    capture?.disconnect();
    wishListenRuntime.seconds = (performance.now() - started) / 1000;
    stream.getTracks().forEach((track) => track.stop());
    const rate = audio.sampleRate;
    void audio.close();
    wishListenRuntime.heard = heard;
    // Ended by hand, the speech service decides whether anything was said; on its own, only when it heard speech.
    if (cancelled || !(heard || (byHand && wishListenRuntime.seconds >= MIN_SECONDS))) {
      wishListenRuntime.finished++;
      return '';
    }
    const body = webm ? new Blob(chunks, { type: 'audio/webm' }) : new Blob([encodeWav(downsample(joinParts(parts), rate)) as BlobPart], { type: 'audio/wav' });
    wishListenRuntime.bytes = body.size;
    const res = await fetch('/api/voice?for=wish', { method: 'POST', headers: { 'Content-Type': body.type }, body });
    const text = res.ok ? (((await res.json()) as { text?: string }).text ?? '').trim() : '';
    if (!res.ok) wishListenRuntime.error = `server ${res.status}`;
    wishListenRuntime.understood = text !== '';
    wishListenRuntime.finished++;
    return text;
  })();
  // A microphone that never started counts as stopped too.
  words.catch(() => micStopped());
  return { words, stopped: stoppedSignal, finish: () => finish(), cancel: () => cancel() };
}
