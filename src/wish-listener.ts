/**
 * "Say your idea": listens for one spoken story idea ("I need a forest story
 * with a dog and a rabbit") and gives back the words. The microphone is open
 * only from the press until the idea is said (it stops after a pause, after
 * MAX_SECONDS, or on a second press), never otherwise.
 *
 * Uses the browser's own speech recognition where it has one; otherwise
 * records the idea and the server turns it into words (/api/voice?for=wish,
 * Cloud Speech-to-Text; nothing is stored).
 */

/** Long enough for a sentence or two; a pause this long after speaking ends it. */
const MAX_SECONDS = 10;
const END_SILENCE_SECONDS = 1.2;
/** Nothing said at all for this long: give up. */
const NO_SPEECH_SECONDS = 6;
const SPEECH_RMS = 0.025;
/** Shorter than this, a press and a second press is not an idea. */
const MIN_SECONDS = 0.6;
const TICK_MS = 50;

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

/** The last listen, for tests and diagnostics: how long, how loud at most, whether speech was heard, bytes sent. */
export const wishListenRuntime = { seconds: 0, peak: 0, heard: false, bytes: 0, how: '' as '' | 'browser' | 'server' };

export interface WishListening {
  /** The words said ('' when nothing was understood); rejects when the microphone could not be used. */
  words: Promise<string>;
  /** Finish now (the second press): what was said so far is used. */
  finish(): void;
  /** Stop without using it. */
  cancel(): void;
}

/** Whether there is any way to hear an idea here (the browser's own, or the server's). */
export async function canHearWishes(): Promise<boolean> {
  if (browserRecognition()) return true;
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return false;
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

export function listenForWish(): WishListening {
  const Recognition = browserRecognition();
  return Recognition ? withBrowser(Recognition) : withServer();
}

function withBrowser(Recognition: RecognitionClass): WishListening {
  const r = new Recognition();
  r.continuous = false;
  r.interimResults = false;
  r.lang = 'en-US';
  let said = '';
  let cancelled = false;
  Object.assign(wishListenRuntime, { seconds: 0, peak: 0, heard: false, bytes: 0, how: 'browser' });
  const words = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => r.stop(), MAX_SECONDS * 1000);
    r.onresult = (e) => {
      said = Array.from(e.results, (res) => res[0]?.transcript ?? '').join(' ').trim();
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') reject(new Error('microphone'));
    };
    r.onend = () => {
      clearTimeout(timer);
      resolve(cancelled ? '' : said);
    };
    r.start();
  });
  return {
    words,
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
  const words = (async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const audio = new AudioContext();
    void audio.resume();
    const analyser = audio.createAnalyser();
    analyser.fftSize = 1024;
    audio.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    // Speech needs little: 32 kbit/s keeps ten seconds well under the server's limit (MAX_CLIP_BYTES, 96 KB).
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    let heard = false;
    let cancelled = false;
    Object.assign(wishListenRuntime, { seconds: 0, peak: 0, heard: false, bytes: 0, how: 'server' });
    const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
    recorder.start();
    // Real time (a busy frame can delay the ticks).
    const started = performance.now();
    let last = started;
    let quiet = 0;
    let byHand = false;
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
      if (t >= MAX_SECONDS || (heard && quiet >= END_SILENCE_SECONDS) || (!heard && t >= NO_SPEECH_SECONDS)) stop();
    }, TICK_MS);
    const stop = () => recorder.state !== 'inactive' && recorder.stop();
    finish = () => {
      byHand = true;
      stop();
    };
    cancel = () => {
      cancelled = true;
      stop();
    };
    await stopped;
    clearInterval(tick);
    wishListenRuntime.seconds = (performance.now() - started) / 1000;
    stream.getTracks().forEach((track) => track.stop());
    void audio.close();
    wishListenRuntime.heard = heard;
    // Ended by hand, the speech service decides whether anything was said; on its own, only when it heard speech.
    if (cancelled || !(heard || (byHand && wishListenRuntime.seconds >= MIN_SECONDS))) return '';
    wishListenRuntime.bytes = chunks.reduce((n, c) => n + c.size, 0);
    const res = await fetch('/api/voice?for=wish', { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: new Blob(chunks, { type: 'audio/webm' }) });
    return res.ok ? (((await res.json()) as { text?: string }).text ?? '').trim() : '';
  })();
  return { words, finish: () => finish(), cancel: () => cancel() };
}
