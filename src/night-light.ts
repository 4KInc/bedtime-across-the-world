import { Lullaby, startLullaby, wakeAudio } from './sfx.js';

/**
 * The night light: the end of a bedtime story on the family's phone or
 * tablet. The screen becomes a warm, dim glow with Mo asleep under the moon and
 * the storyteller's goodnight, and the lullaby plays softly. Over ten minutes
 * the light and the music fade, then the screen goes dark and the phone is
 * allowed to sleep. The screen stays awake until then (Screen Wake Lock, where
 * the browser has it).
 *
 * A tap only shows a Close button for a few seconds, so a sleepy hand on the
 * screen does not end it. DOM only, for the family viewer (viewer-ui.ts,
 * viewer-reply.ts).
 */

/** How long the light lasts before the screen goes dark (?nightms= shortens it, for sims). */
const DURATION_MS = Number(new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('nightms')) || 10 * 60_000;
/** The music fades out over the last part of the light. */
const MUSIC_FADE_FROM = 0.5;
const MUSIC_LEVEL = 0.6;
/** The light at its dimmest, just before the screen goes dark (a share of full). */
const DIMMEST = 0.25;
const CLOSE_SHOWN_MS = 6000;

/** For tests: whether the night light is showing, and how far it has faded. */
export const nightLightRuntime = { open: false, phase: '' as '' | 'lit' | 'dark', light: 0, music: 0 };

const STYLE = `
.sp-night { position: fixed; inset: 0; z-index: 960; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 14px; padding: 24px; text-align: center; background: radial-gradient(circle at 50% 42%, #3a2716 0%, #1a110b 45%, #050407 100%);
  font-family: Georgia, 'Times New Roman', serif; color: #f6e3bd; animation: sp-night-in 3s ease-out; user-select: none; touch-action: none; }
.sp-night .sp-night-glow { display: flex; flex-direction: column; align-items: center; gap: 14px; transition: opacity 2s linear, filter 2s linear; }
.sp-night svg { width: min(60vw, 280px); height: auto; animation: sp-night-breathe 7s ease-in-out infinite; }
.sp-night b { font-size: clamp(26px, 7vw, 46px); font-style: italic; font-weight: 600; color: #f2c47a; }
.sp-night span { font-size: clamp(16px, 4vw, 22px); color: #d9c7a3; }
.sp-night .sp-btn { position: absolute; bottom: calc(28px + env(safe-area-inset-bottom, 0px)); opacity: 0; pointer-events: none; transition: opacity 0.4s; }
.sp-night.ask .sp-btn { opacity: 1; pointer-events: auto; }
.sp-night.dark { background: #000; cursor: none; }
.sp-night.dark .sp-night-glow, .sp-night.dark .sp-night-stars { opacity: 0 !important; }
@keyframes sp-night-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes sp-night-breathe { 0%, 100% { opacity: 0.82; transform: scale(1); } 50% { opacity: 1; transform: scale(1.025); } }
/* Stars twinkling behind, a glow that swells around Mo and the moon, the z's drifting up (Nov 17: on an iPad it
   looked like a still picture). Twinkle and glow change only brightness, so they stay with Reduce Motion. */
.sp-night .sp-night-stars { position: absolute; inset: 0; pointer-events: none; transition: opacity 2s linear; }
.sp-night .sp-night-stars i { position: absolute; border-radius: 50%; background: #fff4d6; box-shadow: 0 0 6px 1px rgba(255, 236, 190, 0.7);
  opacity: 0.25; animation: sp-night-twinkle 5s ease-in-out infinite; }
.sp-night .sp-night-glow { position: relative; }
.sp-night .sp-night-halo { animation: sp-night-halo 6s ease-in-out infinite; }
.sp-night .sp-night-z { animation: sp-night-z 6s ease-in-out infinite; }
.sp-night .sp-night-z:nth-child(2) { animation-delay: 2s; }
.sp-night .sp-night-z:nth-child(3) { animation-delay: 4s; }
@keyframes sp-night-twinkle { 0%, 100% { opacity: 0.2; } 50% { opacity: 1; } }
@keyframes sp-night-halo { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
@keyframes sp-night-z { 0% { opacity: 0; transform: translate(0, 6px); } 30% { opacity: 0.85; } 100% { opacity: 0; transform: translate(6px, -14px); } }
@media (prefers-reduced-motion: reduce) { .sp-night svg, .sp-night .sp-night-z { animation: none; } }
`;

/** The stars: the same sky every night (a small fixed pattern, not random), twinkling out of step. */
const STAR_COUNT = 42;
function starField(): string {
  let seed = 7;
  const next = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  let out = '';
  for (let i = 0; i < STAR_COUNT; i++) {
    const x = (next() * 100).toFixed(1);
    const y = (next() * 100).toFixed(1);
    const size = (1.5 + next() * 2.5).toFixed(1);
    const duration = (3 + next() * 5).toFixed(1);
    const delay = (next() * 6).toFixed(1);
    out += `<i style="left:${x}%;top:${y}%;width:${size}px;height:${size}px;animation-duration:${duration}s;animation-delay:-${delay}s"></i>`;
  }
  return `<div class="sp-night-stars" aria-hidden="true">${out}</div>`;
}

/** Mo asleep on a crescent moon, little z's rising. */
const SLEEPING_MO = `
<svg viewBox="0 0 200 170" aria-hidden="true">
  <defs><radialGradient id="sp-night-halo"><stop offset="0" stop-color="#f2c47a" stop-opacity="0.45"/><stop offset="1" stop-color="#f2c47a" stop-opacity="0"/></radialGradient></defs>
  <circle class="sp-night-halo" cx="100" cy="92" r="78" fill="url(#sp-night-halo)"/>
  <path d="M130 30 A62 62 0 1 0 150 140 A50 50 0 1 1 130 30 Z" fill="#f2d79a"/>
  <g transform="translate(78 92) rotate(-8)">
    <ellipse cx="-17" cy="-4" rx="20" ry="13" fill="#e7b46a" transform="rotate(-18 -17 -4)"/>
    <ellipse cx="17" cy="-4" rx="20" ry="13" fill="#e7b46a" transform="rotate(18 17 -4)"/>
    <ellipse cx="-12" cy="10" rx="11" ry="8" fill="#d39a52"/>
    <ellipse cx="12" cy="10" rx="11" ry="8" fill="#d39a52"/>
    <ellipse cx="0" cy="2" rx="6" ry="16" fill="#8a5a2b"/>
    <path d="M-3 -10 q-6 -10 -12 -12 M3 -10 q6 -10 12 -12" stroke="#8a5a2b" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M-4 -4 q2 2 4 0 M1 -4 q2 2 4 0" stroke="#3a2716" stroke-width="1.4" fill="none" stroke-linecap="round"/>
  </g>
  <g fill="#f6e3bd" font-family="Georgia, serif" font-style="italic">
    <text class="sp-night-z" x="108" y="64" font-size="14">z</text>
    <text class="sp-night-z" x="120" y="50" font-size="18">z</text>
    <text class="sp-night-z" x="136" y="32" font-size="22">z</text>
  </g>
</svg>`;

let style: HTMLStyleElement | null = null;
let lullaby: Lullaby | null = null;
let close: (() => void) | null = null;

/** The night light, for `child` (their name, or ''), with a goodnight from `from` (the storyteller, or ''). */
export function openNightLight(child: string, from: string): void {
  close?.();
  if (!style) {
    style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
  }
  const el = document.createElement('div');
  el.className = 'sp-night';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Night light');
  el.innerHTML = `${starField()}<div class="sp-night-glow">${SLEEPING_MO}<b></b><span></span></div><button class="sp-btn">Close the night light</button>`;
  el.querySelector('b')!.textContent = child ? `Goodnight, ${child}.` : 'Goodnight.';
  el.querySelector('span')!.textContent = from && from !== 'them' ? `Sweet dreams. Love, ${from}` : 'Sweet dreams.';
  const glow = el.querySelector<HTMLDivElement>('.sp-night-glow')!;
  const stars = el.querySelector<HTMLDivElement>('.sp-night-stars')!;
  document.body.appendChild(el);

  // A tap shows Close for a moment; only that button ends the night light.
  let askTimer: ReturnType<typeof setTimeout> | null = null;
  el.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.sp-btn')) return;
    el.classList.add('ask');
    if (askTimer) clearTimeout(askTimer);
    askTimer = setTimeout(() => el.classList.remove('ask'), CLOSE_SHOWN_MS);
  });
  el.querySelector('.sp-btn')!.addEventListener('click', () => close?.());
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close?.();
  };
  document.addEventListener('keydown', onKey);

  // Keep the screen awake while the light is on (and again if the page comes back to the front).
  let lock: { release(): Promise<void> } | null = null;
  const keepAwake = async () => {
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
      if (wl && document.visibilityState === 'visible' && nightLightRuntime.phase === 'lit') lock = await wl.request('screen');
    } catch {
      // Not allowed here (low battery, an older browser): the light still works, the phone may just sleep sooner.
    }
  };
  const onVisible = () => void keepAwake();
  document.addEventListener('visibilitychange', onVisible);
  const letSleep = () => {
    void lock?.release().catch(() => undefined);
    lock = null;
  };

  // The music: the lullaby the story played under, softly (the open was a tap, so sound may start).
  wakeAudio();
  const music = (level: number) => {
    lullaby ??= startLullaby();
    lullaby?.setLevel(level);
    nightLightRuntime.music = lullaby ? Math.round(level * 100) / 100 : 0;
  };

  const start = performance.now();
  nightLightRuntime.open = true;
  nightLightRuntime.phase = 'lit';
  nightLightRuntime.light = 1;
  void keepAwake();
  music(MUSIC_LEVEL);
  const fade = setInterval(() => {
    const t = Math.min(1, (performance.now() - start) / DURATION_MS);
    const light = 1 - (1 - DIMMEST) * t;
    glow.style.filter = `brightness(${light.toFixed(3)})`;
    stars.style.opacity = light.toFixed(3);
    nightLightRuntime.light = Math.round(light * 100) / 100;
    music(t < MUSIC_FADE_FROM ? MUSIC_LEVEL : MUSIC_LEVEL * Math.max(0, (1 - t) / (1 - MUSIC_FADE_FROM)));
    if (t >= 1) {
      // Lights out: the screen goes dark, and the phone may sleep.
      clearInterval(fade);
      el.classList.add('dark');
      nightLightRuntime.phase = 'dark';
      nightLightRuntime.light = 0;
      music(0);
      letSleep();
    }
  }, Math.min(2000, Math.max(100, DURATION_MS / 200)));

  close = () => {
    clearInterval(fade);
    if (askTimer) clearTimeout(askTimer);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVisible);
    letSleep();
    music(0);
    el.remove();
    nightLightRuntime.open = false;
    nightLightRuntime.phase = '';
    nightLightRuntime.light = 0;
    close = null;
  };
}

/** Closes the night light if it is showing (the viewer closing, a new story starting). */
export function closeNightLight(): void {
  close?.();
}
