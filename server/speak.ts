/**
 * A narrator for lines that have no recorded clip: a dreamed story's words
 * (the library stories are voiced ahead of time with Kokoro), spoken by Google
 * Cloud Text-to-Speech in one gentle storytelling voice, with the child's name
 * where the story says it. Only plain story lines that pass the content checks
 * are spoken; each is cached in the story bucket by its words, so a line is
 * made once and every later play (the headset, the family viewer, a shared
 * dreamed story) is instant. A parent recording a story is still the narrator:
 * this voice is for practising, and for stories played without one.
 *
 * Off unless STORY_TTS=google. TTS_API and TTS_TOKEN_URL point it at a local
 * test double ('' token URL sends no credentials).
 */
import { createHash } from 'node:crypto';
import { contentProblems } from '../src/story-checks.ts';

/** Gentle, British: beside the library's narrators (Kokoro bf_emma, bm_george, af_bella, af_heart). */
export const TTS_VOICE = 'en-GB-Chirp3-HD-Vindemiatrix';
const LANGUAGE = 'en-GB';
const RATE = 0.9;
/** A story line: plain words, as dreamed stories are checked (story-checks.ts), a little longer for a name. */
const PLAIN = /^[A-Za-z0-9 ,.!?'’;:-]{1,240}$/;

/** Whether this is a line we will speak: plain words, no link, passing the content checks. */
/** Never a web address or an email, even made of plain characters. */
const LINK = /www\.|https?:|\.(com|org|net|io|co)\b|@/i;

export function speakable(text: unknown): text is string {
  return typeof text === 'string' && PLAIN.test(text) && !LINK.test(text) && contentProblems(text).length === 0;
}

/** Where a spoken line is cached (by voice and words). */
export function speechKey(text: string): string {
  return `speech-${createHash('sha256').update(`${TTS_VOICE}\n${RATE}\n${text}`).digest('hex').slice(0, 40)}`;
}

export class TextToSpeech {
  private token = '';
  private tokenExpires = 0;
  private api: string;
  private tokenUrl: string;

  constructor(
    api = 'https://texttospeech.googleapis.com',
    tokenUrl = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
  ) {
    this.api = api;
    this.tokenUrl = tokenUrl;
  }

  private async auth(): Promise<Record<string, string>> {
    if (!this.tokenUrl) return {};
    if (Date.now() > this.tokenExpires - 60_000) {
      const res = await fetch(this.tokenUrl, { headers: { 'Metadata-Flavor': 'Google' } });
      if (!res.ok) throw new Error(`metadata token ${res.status}`);
      const body = (await res.json()) as { access_token: string; expires_in: number };
      this.token = body.access_token;
      this.tokenExpires = Date.now() + body.expires_in * 1000;
    }
    return { Authorization: `Bearer ${this.token}` };
  }

  /** One line as MP3. */
  async synthesize(text: string): Promise<Buffer> {
    const res = await fetch(`${this.api}/v1/text:synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await this.auth()) },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: LANGUAGE, name: TTS_VOICE },
        audioConfig: { audioEncoding: 'MP3', speakingRate: RATE },
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`text-to-speech ${res.status}`);
    const body = (await res.json()) as { audioContent?: string };
    if (!body.audioContent) throw new Error('text-to-speech: no audio');
    return Buffer.from(body.audioContent, 'base64');
  }
}
