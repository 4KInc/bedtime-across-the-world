import type { Performance } from './performance/format.js';

/** Library story titles by script path (public/story/library.json; the browser caches it). */
export async function storyNames(): Promise<Map<string, string>> {
  try {
    const lib = (await (await fetch(`${import.meta.env.BASE_URL}story/library.json`)).json()) as { stories?: { script: string; title: string }[] };
    return new Map((lib.stories ?? []).map((s) => [s.script, s.title]));
  } catch {
    return new Map();
  }
}

/**
 * What to call a recording: the story told (its own title is usually the same
 * "A bedtime story" or "A story for Mia"), a dreamed story's own title, else its title.
 */
export function recordingName(p: Performance, names: ReadonlyMap<string, string>): string {
  return names.get(p.script) ?? (p.story as { title?: string } | undefined)?.title ?? p.title;
}
