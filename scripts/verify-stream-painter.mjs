/**
 * Stream-painter verification (plain Node, no browser needed).
 *
 *   npm run test:streaming
 *
 * Pins the client-side half of the "the whole answer appeared at once" bug:
 * streamed tokens were committed to React state only from a
 * `requestAnimationFrame` callback, and rAF does not fire while the page is
 * hidden (background tab, dimmed/locked phone, off-screen preview iframe). The
 * reply was therefore buffered and painted in ONE jump when frames resumed.
 *
 * Cases:
 *   F0. control — the OLD rAF-only scheduler really does paint nothing while
 *       frames are paused (proves these tests can catch the regression).
 *   F1. visible page — tokens paint progressively, first token immediately.
 *   F2. hidden page / frozen rAF — tokens STILL paint progressively.
 *   F3. long replies — commits are throttled (no per-token re-render storm).
 *   F4. cancel() — a pending commit never fires after Stop/finalize.
 */
import { createStreamPainter } from '../src/services/streamPainter.ts';

let failures = 0;
let checks = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(name, ok, detail = '') {
  checks++;
  if (ok) console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`);
  else {
    failures++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 62 - t.length))}`);

/** Minimal browser environment. `framesRun=false` freezes rAF (hidden page). */
function installEnv({ framesRun }) {
  const rafQueue = new Map();
  let nextId = 1;
  globalThis.window = {
    requestAnimationFrame: (cb) => {
      const id = nextId++;
      rafQueue.set(id, cb);
      if (framesRun) {
        setTimeout(() => {
          if (rafQueue.delete(id)) cb();
        }, 16);
      }
      return id;
    },
    cancelAnimationFrame: (id) => {
      rafQueue.delete(id);
    },
    setTimeout: (cb, ms) => setTimeout(cb, ms),
    clearTimeout: (id) => clearTimeout(id),
  };
  globalThis.document = { visibilityState: framesRun ? 'visible' : 'hidden' };
}

/** Run a fake token stream through a scheduler and record every commit. */
async function runStream({
  framesRun,
  chunks = 40,
  chunkMs = 20,
  charsPerChunk = 60,
  scheduler = 'new',
}) {
  installEnv({ framesRun });

  let buffer = '';
  const commits = [];
  const t0 = Date.now();
  const record = () => commits.push({ at: Date.now() - t0, len: buffer.length });

  let painter;
  if (scheduler === 'new') {
    painter = createStreamPainter({ onCommit: record, getBufferLength: () => buffer.length });
  }

  // The OLD implementation, kept here as a control: rAF only, no watchdog.
  const legacyPush = (() => {
    let rafId = 0;
    const flush = () => {
      rafId = 0;
      record();
    };
    return () => {
      if (!rafId) rafId = window.requestAnimationFrame(flush);
    };
  })();

  for (let i = 0; i < chunks; i++) {
    buffer += 'x'.repeat(charsPerChunk);
    if (scheduler === 'new') painter.push();
    else legacyPush();
    await sleep(chunkMs);
  }

  // Generation finished: the app commits the final buffer itself.
  const finalAt = Date.now() - t0;
  record();

  return { commits, finalLen: buffer.length, finalAt, painter };
}

console.log('Agent Pro — stream painter verification');

section('F0. control: the old rAF-only scheduler buffers everything when hidden');
{
  const r = await runStream({ framesRun: false, scheduler: 'legacy' });
  check(
    'old code painted NOTHING until generation finished',
    r.commits.length === 1 && r.commits[0].len === r.finalLen,
    `${r.commits.length} commit(s), all at the end`
  );
}

section('F1. visible page: progressive painting, first token immediate');
{
  const r = await runStream({ framesRun: true, chunks: 30, chunkMs: 20 });
  const partial = r.commits.filter((c) => c.len > 0 && c.len < r.finalLen);
  check('many intermediate commits', partial.length >= 15, `${partial.length} partial commits`);
  check('first token painted on the first chunk', r.commits[0]?.len === 60, `len=${r.commits[0]?.len}`);
  check(
    'content was visible well before generation ended',
    partial[0].at < r.finalAt * 0.2,
    `first paint +${partial[0].at}ms of ${r.finalAt}ms`
  );
}

section('F2. hidden page / frozen rAF: still paints progressively (the fix)');
{
  const r = await runStream({ framesRun: false, chunks: 30, chunkMs: 20 });
  const partial = r.commits.filter((c) => c.len > 0 && c.len < r.finalLen);
  check('watchdog timer keeps committing', partial.length >= 10, `${partial.length} partial commits`);
  check('first token painted immediately', r.commits[0]?.len === 60, `len=${r.commits[0]?.len}`);
  check(
    'a mid-stream commit shows only part of the reply',
    partial.some((c) => c.len <= r.finalLen * 0.5),
    `smallest partial = ${Math.min(...partial.map((c) => c.len))} of ${r.finalLen} chars`
  );
}

section('F3. very long reply: commits are throttled, not per token');
{
  // 400 pushes x 5ms = 2s, 60 chars each -> 24k chars (> longReplyAfter).
  const r = await runStream({ framesRun: true, chunks: 400, chunkMs: 5, charsPerChunk: 60 });
  const gaps = r.commits
    .slice(1)
    .map((c, i) => c.at - r.commits[i].at)
    .filter((g) => g > 0);
  const avgGap = gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length);
  check(
    'far fewer commits than tokens once the reply is long',
    r.commits.length < 400 * 0.35,
    `${r.commits.length} commits for 400 chunks`
  );
  check('average commit interval respects the long-reply cap', avgGap >= 25, `${avgGap.toFixed(1)}ms`);
  check('still progressive (not one block)', r.commits.length >= 8, `${r.commits.length} commits`);
}

section('F4. cancel(): no commit after Stop / finalize');
{
  installEnv({ framesRun: false });
  let buffer = '';
  let commits = 0;
  const painter = createStreamPainter({
    onCommit: () => commits++,
    getBufferLength: () => buffer.length,
  });
  buffer = 'hello';
  painter.push(); // first token paints immediately
  const afterFirst = commits;
  buffer += ' world';
  painter.push(); // schedules a watchdog commit
  check('a commit is pending', painter.isPending());
  painter.cancel();
  check('cancel clears the pending commit', !painter.isPending());
  await sleep(120);
  check('nothing committed after cancel', commits === afterFirst, `${commits} commit(s)`);
}

console.log(`\n${'═'.repeat(64)}`);
if (failures === 0) {
  console.log(`✅ ALL ${checks} PAINTER CHECKS PASSED`);
  process.exit(0);
}
console.log(`❌ ${failures} of ${checks} checks FAILED`);
process.exit(1);
