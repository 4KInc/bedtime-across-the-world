/**
 * Voice commands, when the headset browser has no speech recognition of its
 * own: a short spoken clip (a few seconds of WebM/Opus, recorded only while
 * Voice commands is on and someone is speaking) is sent to Google Cloud
 * Speech-to-Text with the command phrases as hints, and only the text comes
 * back. Nothing is stored or logged.
 *
 * Off unless VOICE_STT=google. STT_API and STT_TOKEN_URL point it at a local
 * test double ('' token URL sends no credentials).
 */
import { COMMAND_PHRASES, wishPhrases } from '../src/voice-commands.ts';

/** A command clip of up to 6 s plus its half second from before the speech, as 16 kHz WAV (about 208 KB), or WebM. */
export const MAX_CLIP_BYTES = 224 * 1024;
/** WAV header length: the speech service is sent the samples after it. */
const WAV_HEADER = 44;

/**
 * What a clip is for: a short command (the command phrases as hints), or a
 * story asked for in plain words, "Tell Mo your idea" (up to about ten
 * seconds of ordinary speech; the places and shapes as hints).
 */
export type ClipPurpose = 'command' | 'wish';
const WISH_PHRASES = wishPhrases();

export class SpeechToText {
  private token = '';
  private tokenExpires = 0;

  private api: string;
  private tokenUrl: string;

  constructor(
    api = 'https://speech.googleapis.com',
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

  /**
   * The best transcript of one clip ('' when nothing was understood): 16 kHz mono
   * WAV (what the app sends: it starts half a second before the speech) or WebM/Opus.
   */
  async transcribe(clip: Buffer, format: 'wav' | 'webm' = 'webm', purpose: ClipPurpose = 'command'): Promise<string> {
    const wav = format === 'wav';
    const wish = purpose === 'wish';
    const res = await fetch(`${this.api}/v1/speech:recognize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await this.auth()) },
      body: JSON.stringify({
        config: {
          encoding: wav ? 'LINEAR16' : 'WEBM_OPUS',
          sampleRateHertz: wav ? 16000 : 48000,
          languageCode: 'en-US',
          model: wish ? 'latest_short' : 'command_and_search',
          maxAlternatives: 1,
          profanityFilter: true,
          speechContexts: [{ phrases: wish ? WISH_PHRASES : COMMAND_PHRASES, boost: wish ? 10 : 15 }],
        },
        audio: { content: (wav ? clip.subarray(WAV_HEADER) : clip).toString('base64') },
      }),
      signal: AbortSignal.timeout(wish ? 12000 : 8000),
    });
    if (!res.ok) throw new Error(`speech ${res.status}`);
    const body = (await res.json()) as { results?: { alternatives?: { transcript?: string }[] }[] };
    return (body.results ?? [])
      .map((r) => r.alternatives?.[0]?.transcript ?? '')
      .join(' ')
      .trim()
      .slice(0, 240);
  }
}
