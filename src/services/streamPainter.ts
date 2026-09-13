/**
 * Stream painter — turns a firehose of model tokens into smooth, *progressive*
 * React updates.
 *
 * THE BUG THIS REPLACES
 * ---------------------
 * Streamed tokens used to be committed to state only from a
 * `requestAnimationFrame` callback. rAF does not fire while the page is hidden:
 * a background tab, a locked/dimmed phone screen, or a preview iframe that is
 * not currently on screen. Every token then piled up in a local buffer and the
 * complete answer was painted in ONE jump as soon as the page became visible —
 * exactly the reported symptom "វាបង្កើតរួចរាល់ទាំងអស់ទើបបង្ហាញ" (it generates
 * everything first and only then displays it), which wastes the user's time on
 * long documents.
 *
 * THE FIX
 * -------
 *  - the FIRST token commits immediately (no frame wait) so the reply visibly
 *    starts the instant the model starts producing it;
 *  - every later commit is scheduled with rAF *and* a `setTimeout` watchdog, so
 *    paused frames can never hold the reply back;
 *  - commits are coalesced (at most one per interval) and the interval grows
 *    with the reply length, because each commit re-parses the whole markdown:
 *    full frame rate while short, ~25fps for long answers, ~12fps for very long
 *    documents.
 *
 * The scheduler is deliberately framework-free and environment-guarded so it
 * can be unit-tested in plain Node (`npm run test:streaming`).
 */

/** Watchdog period used while frames may be paused (~one frame). */
const FRAME_WATCHDOG_MS = 16;

export interface StreamPainterOptions {
  /** Commit the buffered content to React state. */
  onCommit: () => void;
  /** Currently buffered characters (content + reasoning + status note). */
  getBufferLength: () => number;
  /** Characters before the frame-rate cap starts (default 4000). */
  throttleAfter?: number;
  /** Characters before the hard cap for very long documents (default 20000). */
  longReplyAfter?: number;
  /** Minimum ms between commits once throttling kicks in (default 40). */
  minIntervalMs?: number;
  /** Interval for very long replies (default 80). */
  longIntervalMs?: number;
}

export interface StreamPainter {
  /** Call after appending a chunk to the buffer. */
  push: () => void;
  /** Commit right now and drop any pending schedule. */
  flushNow: () => void;
  /** Drop any pending schedule without committing (abort / finalize). */
  cancel: () => void;
  /** True while a commit is scheduled. */
  isPending: () => boolean;
}

const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const getRaf = (): ((cb: () => void) => number) | null => {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    return (cb) => window.requestAnimationFrame(cb);
  }
  if (typeof requestAnimationFrame === 'function') return (cb) => requestAnimationFrame(cb);
  return null;
};

const getCancelRaf = (): ((id: number) => void) | null => {
  if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
    return (id) => window.cancelAnimationFrame(id);
  }
  if (typeof cancelAnimationFrame === 'function') return (id) => cancelAnimationFrame(id);
  return null;
};

const getTimeout = (): ((cb: () => void, ms: number) => number) => {
  if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
    return (cb, ms) => window.setTimeout(cb, ms) as unknown as number;
  }
  return (cb, ms) => setTimeout(cb, ms) as unknown as number;
};

const getClearTimeout = (): ((id: number) => void) => {
  if (typeof window !== 'undefined' && typeof window.clearTimeout === 'function') {
    return (id) => window.clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
  }
  return (id) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
};

const isPageHidden = (): boolean =>
  typeof document !== 'undefined' && (document as any).visibilityState === 'hidden';

export function createStreamPainter(options: StreamPainterOptions): StreamPainter {
  const {
    onCommit,
    getBufferLength,
    throttleAfter = 4000,
    longReplyAfter = 20000,
    minIntervalMs = 40,
    longIntervalMs = 80,
  } = options;

  const raf = getRaf();
  const cancelRaf = getCancelRaf();
  const setTimer = getTimeout();
  const clearTimer = getClearTimeout();

  let rafId = 0;
  let timerId = 0;
  let lastCommitAt = 0;
  let hasPainted = false;

  const intervalFor = (len: number): number => {
    if (len > longReplyAfter) return longIntervalMs;
    if (len > throttleAfter) return minIntervalMs;
    return 0;
  };

  const cancel = () => {
    if (rafId) {
      cancelRaf?.(rafId);
      rafId = 0;
    }
    if (timerId) {
      clearTimer(timerId);
      timerId = 0;
    }
  };

  const commit = () => {
    cancel();
    lastCommitAt = now();
    hasPainted = true;
    onCommit();
  };

  /** Remaining ms of the throttle window for the currently buffered length. */
  const remainingThrottle = (): number =>
    Math.max(0, intervalFor(getBufferLength()) - (now() - lastCommitAt));

  /**
   * Scheduled callback (rAF or watchdog timer). It re-checks the throttle:
   * a frame can arrive before the interval for a long reply has elapsed, and
   * committing then would defeat the cap (each commit re-parses the whole
   * markdown, which is what made long documents stutter).
   */
  const attemptCommit = () => {
    cancel();
    const remaining = remainingThrottle();
    if (remaining > 0) {
      timerId = setTimer(attemptCommit, remaining);
      return;
    }
    lastCommitAt = now();
    hasPainted = true;
    onCommit();
  };

  const push = () => {
    // First visible token paints IMMEDIATELY — the reply must start showing
    // from the very first character, without waiting for a frame callback.
    if (!hasPainted) {
      if (getBufferLength() > 0) commit();
      return;
    }

    // A commit is already queued; it will carry everything buffered so far.
    if (rafId || timerId) return;

    const remaining = remainingThrottle();
    if (remaining > 0) {
      // Long reply inside its throttle window: one timer, no frame callback.
      timerId = setTimer(attemptCommit, remaining);
      return;
    }

    // Short reply: paint on the next frame for smoothness…
    if (raf && !isPageHidden()) {
      rafId = raf(attemptCommit);
    }
    // …and ALWAYS arm a timer watchdog too, so paused frames (hidden tab,
    // hidden preview iframe, screen off) can never buffer the whole reply.
    timerId = setTimer(attemptCommit, FRAME_WATCHDOG_MS);
  };

  return { push, flushNow: commit, cancel, isPending: () => Boolean(rafId || timerId) };
}
