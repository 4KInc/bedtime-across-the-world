/**
 * Bedtime across time zones: what time it is for the child, and how near
 * their bedtime is. A goodnight carries only the phone's offset from UTC
 * (minutes, e.g. 60 for UTC+1), never a place; the headset learns the child's
 * usual bedtime from the local times their goodnights were sent at.
 *
 * Pure and import-free: shared by the headset, the family viewer and the
 * server (which checks the offset), and tested in tests/story-requests.test.ts.
 */

/** Offsets in use run from UTC-12 to UTC+14, in quarter hours. */
export function checkTz(tz: unknown): number | null {
  return typeof tz === 'number' && Number.isInteger(tz) && tz >= -720 && tz <= 840 && tz % 15 === 0 ? tz : null;
}

/** This device's offset (minutes east of UTC). */
export function deviceTz(): number {
  return -new Date().getTimezoneOffset();
}

/** Minutes after midnight, for someone at offset tz, at time `at` (ms since epoch). */
export function localMinutes(at: number, tz: number): number {
  const d = new Date(at + tz * 60_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** "7:40 pm". */
export function clockText(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** Goodnights sent between these local times count toward a bedtime (an afternoon goodnight says nothing about it). */
const EVENING_FROM = 17 * 60;
const EVENING_TO = 23 * 60;
/** Until a child's goodnights say otherwise. */
export const DEFAULT_BEDTIME = 19 * 60 + 30;

/** A child's usual bedtime: the middle of the local times of their evening goodnights. */
export function usualBedtime(goodnights: readonly number[]): number {
  const evening = goodnights.filter((m) => m >= EVENING_FROM && m <= EVENING_TO).sort((a, b) => a - b);
  return evening.length ? evening[Math.floor(evening.length / 2)] : DEFAULT_BEDTIME;
}

/** How long until, in words a storyteller reads at a glance. */
function soon(mins: number): string {
  if (mins >= 55) return 'about an hour';
  return `about ${Math.max(5, Math.round(mins / 5) * 5)} minutes`;
}

/**
 * One line for the storyteller: the child's time, and what it means tonight.
 * "It's 7:10 pm for Mia. Bedtime in about 20 minutes."
 */
export function bedtimeLine(child: string, now: number, tz: number, bedtime: number): string {
  const local = localMinutes(now, tz);
  const time = `It's ${clockText(local)} for ${child}.`;
  // Minutes from bedtime, between -12 h and +12 h.
  const from = ((local - bedtime + 36 * 60) % (24 * 60)) - 12 * 60;
  if (from >= -90 && from < 0) return `${time} Bedtime in ${soon(-from)}.`;
  if (from >= 0 && from <= 45) return `${time} It's bedtime now.`;
  if ((from > 45 && local >= 12 * 60) || local < 7 * 60) return `${time} ${child} is asleep. Record one for tomorrow night.`;
  if (local < 12 * 60) return `${time} Record tonight's story while it's day there.`;
  return time;
}
