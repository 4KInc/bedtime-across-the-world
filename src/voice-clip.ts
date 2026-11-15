/**
 * Spoken commands as clips that begin before the speech is detected. The
 * detector needs a moment of loudness, so a recorder started on detection cut
 * the start of a short word: "fish" went out as "ish" and "cup" as "up", and
 * neither was understood, while "the fish" worked (Quest 3, Nov 15). The
 * microphone is kept as raw audio with the last half second always at hand; a
 * clip starts with it, and is sent as 16 kHz WAV. No DOM, no Web Audio here.
 */

/** Audio kept from before the speech is detected (s). */
export const PREROLL_SECONDS = 0.5;
/** What the speech service is sent: mono 16-bit at this rate. */
export const CLIP_RATE = 16000;

/** The last `seconds` of audio, overwritten in a circle. */
export class PcmRing {
  private data: Float32Array;
  private at = 0;
  private filled = 0;

  constructor(rate: number, seconds = PREROLL_SECONDS) {
    this.data = new Float32Array(Math.max(1, Math.round(rate * seconds)));
  }

  push(samples: Float32Array): void {
    const n = this.data.length;
    for (let i = 0; i < samples.length; i++) {
      this.data[this.at] = samples[i];
      this.at = (this.at + 1) % n;
    }
    this.filled = Math.min(n, this.filled + samples.length);
  }

  /** What is held, oldest first (a copy). */
  snapshot(): Float32Array {
    const n = this.data.length;
    const out = new Float32Array(this.filled);
    const start = (this.at - this.filled + n) % n;
    for (let i = 0; i < this.filled; i++) out[i] = this.data[(start + i) % n];
    return out;
  }
}

/** Parts one after another. */
export function joinParts(parts: readonly Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** To `to` Hz, averaging the samples each output sample covers (a simple low-pass). */
export function downsample(samples: Float32Array, from: number, to = CLIP_RATE): Float32Array {
  if (from === to) return samples;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = a; j < b; j++) sum += samples[j];
    out[i] = b > a ? sum / (b - a) : 0;
  }
  return out;
}

/** Mono 16-bit PCM WAV. */
export function encodeWav(samples: Float32Array, rate = CLIP_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(bytes.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i);
  };
  text(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
  }
  return bytes;
}
