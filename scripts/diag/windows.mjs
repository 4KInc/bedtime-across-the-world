/**
 * Which 5-second frame-rate windows (snapshots) were the headset's own system
 * transitions, not the app rendering: the headset sleeping or waking, the
 * system menu blurring the view, the session hidden. Newer sessions say so
 * themselves (`transFrames`, frames held out by src/diag/frame-stats.ts
 * TransitionGate); for older ones, a window is a transition when the session's
 * visibility changed during it, other than entering XR from the 2D page
 * (entering is the app's own work, and counts).
 */
export const WINDOW_SECONDS = 5;

/** The session's rows (events and snapshots, any order) -> Set of the transition snapshots. */
export function transitionWindows(rows) {
  const sorted = [...rows].sort((a, b) => a.t - b.t);
  const changes = [];
  let state = 'non-immersive';
  for (const r of sorted) {
    if (r.k !== 'ev' || r.e !== 'vis') continue;
    if (state !== 'non-immersive' && r.state !== 'non-immersive') changes.push(r.t);
    state = r.state;
  }
  const out = new Set();
  for (const s of sorted) {
    if (s.k !== 'snap') continue;
    if (s.transFrames > 0 || changes.some((t) => t > s.t - WINDOW_SECONDS && t <= s.t)) out.add(s);
  }
  return out;
}
