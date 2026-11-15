/**
 * Rolling frame-time statistics over a time window, without allocating per
 * frame: a ring of frame times, sorted into a scratch array only when read.
 * Pure (no imports), so it is unit-tested directly by Node.
 */
export class FrameStats {
  private times: Float32Array;
  private scratch: Float32Array;
  private head = 0;
  private count = 0;
  private windowMs: number;

  /** `capacity` frames is enough for the window at the highest frame rate (120 Hz x 5 s = 600). */
  constructor(windowMs = 5000, capacity = 720) {
    this.windowMs = windowMs;
    this.times = new Float32Array(capacity);
    this.scratch = new Float32Array(capacity);
  }

  /** Add one frame's duration (ms). Older frames beyond the window are dropped on read. */
  push(ms: number): void {
    if (!(ms > 0) || ms > 1000) return;
    this.times[this.head] = ms;
    this.head = (this.head + 1) % this.times.length;
    if (this.count < this.times.length) this.count++;
  }

  /** Average, 95th percentile and worst frame time (ms) of the most recent `windowMs`, and the frame rate. */
  read(out: { avg: number; p95: number; worst: number; fps: number; frames: number }): typeof out {
    // Walk back from the newest frame until the window is full.
    let total = 0;
    let n = 0;
    for (let i = 1; i <= this.count; i++) {
      const ms = this.times[(this.head - i + this.times.length) % this.times.length];
      if (total + ms > this.windowMs && n > 0) break;
      this.scratch[n++] = ms;
      total += ms;
    }
    if (n === 0) {
      out.avg = out.p95 = out.worst = out.fps = out.frames = 0;
      return out;
    }
    const sorted = this.scratch.subarray(0, n).sort();
    out.avg = total / n;
    out.p95 = sorted[Math.min(n - 1, Math.floor(n * 0.95))];
    out.worst = sorted[n - 1];
    out.fps = 1000 / out.avg;
    out.frames = n;
    return out;
  }

  reset(): void {
    this.head = this.count = 0;
  }
}

/**
 * Frames during a system transition: the headset going to sleep or waking,
 * the system menu blurring the view, the session hidden. The Quest holds the
 * app's frames back then (a frame "taking" most of a second as it wakes), so
 * they say nothing about how the app renders. They are counted on their own,
 * not mixed into the frame-rate windows: from any visibility change until
 * SETTLE_MS after the session is plainly visible again.
 */
export class TransitionGate {
  private settleMs: number;
  private until = 0;
  private visible = true;
  /** Frames held out since the last take(), and the longest of them (ms). */
  frames = 0;
  worst = 0;

  constructor(settleMs = 2000) {
    this.settleMs = settleMs;
  }

  /** The session's visibility changed at `now` (ms); `visible` when it is now plainly visible (not blurred or hidden). */
  change(now: number, visible: boolean): void {
    this.visible = visible;
    this.until = now + this.settleMs;
  }

  /** True when this frame counts toward the frame-rate windows; otherwise it is tallied here. */
  admit(now: number, ms: number): boolean {
    if (this.visible && now >= this.until) return true;
    this.frames++;
    if (ms > this.worst) this.worst = ms;
    return false;
  }

  /** The tally since the last call (for a snapshot), then cleared. */
  take(): { frames: number; worst: number } {
    const out = { frames: this.frames, worst: this.worst };
    this.frames = this.worst = 0;
    return out;
  }
}
