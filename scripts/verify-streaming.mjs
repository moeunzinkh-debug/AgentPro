/**
 * Streaming verification suite (no API keys, no browser needed).
 *
 *   npm run test:streaming
 *
 * It pins the regressions that made replies arrive "all at once" instead of
 * streaming from the first token to the last:
 *
 *   A. Gemini Instant Mode sends NO thinking phase:
 *        - exactly ONE upstream HTTP request (the old hard-coded
 *          `thinkingLevel: LOW` was rejected by every Gemini 2.x model, so the
 *          whole request was sent twice before generation even started), and
 *        - thinking is disabled (thinkingBudget 0 / thinkingLevel minimal), so
 *          the first visible token arrives immediately instead of after
 *          seconds of invisible thinking.
 *   B. When thinking IS enabled (Instant Mode off) the thoughts are streamed
 *      back as `reasoning`, so the user watches progress instead of a freeze.
 *   C. A rejected generation config is retried on the SAME model (config
 *      ladder) — it never cascades to a worse fallback model.
 *   D. OpenAI-compatible endpoints are forwarded token-by-token, and an
 *      endpoint that ignores `stream: true` still delivers its answer instead
 *      of an empty bubble stuck on "is generating response…".
 *   E. Aborting (Stop response) cancels the upstream read immediately.
 */
import http from 'node:http';
import { handleChatStreamRequest } from '../src/server/apiRouter.ts';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
let checks = 0;

function check(name, ok, detail = '') {
  checks++;
  if (ok) {
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 62 - t.length))}`);

// ---------------------------------------------------------------------------
// Mock Gemini REST API
// ---------------------------------------------------------------------------
const THINK_CHUNKS = 10;
const THINK_STEP_MS = 60;
const TEXT_CHUNKS = 12;
const TEXT_STEP_MS = 30;
const RTT_MS = 40;

function makeGeminiMock({ rejectThinkingLevel = false, rejectThinkingBudget = false } = {}) {
  const requests = [];
  const original = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.includes('generativelanguage.googleapis.com')) return original(input, init);

    const body = JSON.parse(init.body);
    const modelInPath = url.match(/models\/([^:/?]+):/)?.[1] || 'unknown';
    const thinking = body.generationConfig?.thinkingConfig;
    requests.push({
      model: modelInPath,
      thinkingConfig: thinking,
      generationConfig: body.generationConfig,
      at: Date.now(),
    });

    const reject =
      (rejectThinkingLevel && thinking?.thinkingLevel !== undefined) ||
      (rejectThinkingBudget && thinking?.thinkingBudget !== undefined);

    if (reject) {
      await sleep(RTT_MS);
      return new Response(
        JSON.stringify({
          error: {
            code: 400,
            message:
              'Invalid JSON payload received. Unknown name "thinkingLevel": Cannot find field.',
            status: 'INVALID_ARGUMENT',
          },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      );
    }

    const budget = thinking?.thinkingBudget;
    const willThink =
      thinking?.includeThoughts === true ||
      budget === undefined ||
      budget === -1 ||
      budget > 0;

    const frames = [];
    if (willThink) {
      for (let t = 0; t < THINK_CHUNKS; t++) {
        frames.push({
          delay: t === 0 ? RTT_MS : THINK_STEP_MS,
          body: {
            candidates: [
              { content: { role: 'model', parts: [{ text: `thought ${t}. `, thought: true }] } },
            ],
          },
        });
      }
    } else {
      frames.push({
        delay: RTT_MS,
        body: { candidates: [{ content: { role: 'model', parts: [{ text: '' }] } }] },
      });
    }
    for (let t = 0; t < TEXT_CHUNKS; t++) {
      frames.push({
        delay: willThink && t === 0 ? 0 : TEXT_STEP_MS,
        body: { candidates: [{ content: { role: 'model', parts: [{ text: `ពាក្យ${t} ` }] } }] },
      });
    }

    const encoder = new TextEncoder();
    let i = 0;
    const stream = new ReadableStream({
      async pull(controller) {
        if (i < frames.length) {
          const f = frames[i++];
          if (f.delay) await sleep(f.delay);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(f.body)}\n\n`));
        } else {
          // The real Gemini SSE stream has NO [DONE] sentinel (OpenAI-only);
          // the SDK throws on a trailing non-JSON segment.
          controller.close();
        }
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };

  return {
    requests,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

async function runGemini(model, { instantMode, mockOpts } = {}) {
  const mock = makeGeminiMock(mockOpts);
  const t0 = Date.now();
  const events = [];
  let error = null;
  try {
    await handleChatStreamRequest(
      {
        provider: 'gemini',
        model,
        messages: [{ role: 'user', content: 'សរសេរឯកសារវែងមួយ' }],
        apiKey: 'fake-key',
        instantMode,
        parameters: { temperature: 0.7, maxTokens: 4096, topP: 0.95 },
      },
      (chunk) => events.push({ ...chunk, at: Date.now() - t0 })
    );
  } catch (e) {
    error = e;
  } finally {
    mock.restore();
  }
  const contentEvents = events.filter((e) => e.content);
  const reasoningEvents = events.filter((e) => e.reasoning);
  return {
    events,
    contentEvents,
    reasoningEvents,
    error,
    requests: mock.requests,
    firstContentAt: contentEvents[0]?.at ?? null,
    firstReasoningAt: reasoningEvents[0]?.at ?? null,
    totalContent: contentEvents.map((e) => e.content).join(''),
    total: Date.now() - t0,
  };
}

// ---------------------------------------------------------------------------
// Mock OpenAI-compatible upstream (real HTTP so the SSE reader is exercised)
// ---------------------------------------------------------------------------
function startMockUpstream({ nonSse = false, chunks = 14, delayMs = 40 } = {}) {
  let requestCount = 0;
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    requestCount++;

    if (nonSse) {
      const text = Array.from({ length: chunks }, (_, i) => `Chunk ${i + 1}. `).join('');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          model: 'mock-model',
          choices: [{ message: { role: 'assistant', content: text } }],
          usage: { total_tokens: chunks },
        })
      );
      return;
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
    });
    for (let i = 0; i < chunks; i++) {
      res.write(
        `data: ${JSON.stringify({
          model: 'mock-model',
          choices: [{ delta: { content: `Chunk ${i + 1} បន្ទាប់។ ` }, index: 0 }],
        })}\n\n`
      );
      await sleep(delayMs);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        close: () => new Promise((r) => server.close(r)),
        requests: () => requestCount,
      });
    });
  });
}

async function runCustom(baseUrl, { signal } = {}) {
  const t0 = Date.now();
  const events = [];
  let error = null;
  try {
    await handleChatStreamRequest(
      {
        provider: 'custom',
        model: 'mock-model',
        baseUrl,
        apiKey: 'mock-key',
        messages: [{ role: 'user', content: 'សរសេរអត្ថបទវែង' }],
        instantMode: true,
        parameters: { temperature: 0.7, maxTokens: 4096, topP: 0.95 },
      },
      (chunk) => events.push({ ...chunk, at: Date.now() - t0 }),
      signal
    );
  } catch (e) {
    error = e;
  }
  return {
    events,
    error,
    contentEvents: events.filter((e) => e.content),
    total: Date.now() - t0,
  };
}

// ===========================================================================
console.log('Agent Pro — streaming verification');

section('A. Gemini Instant Mode: no wasted request, no thinking phase');
{
  const flash = await runGemini('gemini-2.5-flash', { instantMode: true });
  check(
    'gemini-2.5-flash → exactly 1 upstream request',
    flash.requests.length === 1,
    `got ${flash.requests.length}`
  );
  check(
    'thinking disabled with thinkingBudget: 0',
    flash.requests[0]?.thinkingConfig?.thinkingBudget === 0,
    JSON.stringify(flash.requests[0]?.thinkingConfig)
  );
  check(
    'no thinking delay: first token ≈ one RTT',
    flash.firstContentAt !== null && flash.firstContentAt < 200,
    `first token +${flash.firstContentAt}ms`
  );
  check(
    'content forwarded incrementally',
    flash.contentEvents.length === TEXT_CHUNKS,
    `${flash.contentEvents.length} chunks`
  );
  check('no error', flash.error === null, flash.error?.message || '');

  const pro = await runGemini('gemini-2.5-pro', { instantMode: true });
  check(
    'gemini-2.5-pro uses the minimum allowed budget (128)',
    pro.requests[0]?.thinkingConfig?.thinkingBudget === 128,
    JSON.stringify(pro.requests[0]?.thinkingConfig)
  );

  const v3 = await runGemini('gemini-3-pro', { instantMode: true });
  check(
    'gemini-3.x uses thinkingLevel: minimal',
    String(v3.requests[0]?.thinkingConfig?.thinkingLevel).toLowerCase() === 'minimal',
    JSON.stringify(v3.requests[0]?.thinkingConfig)
  );

  const legacy = await runGemini('gemini-2.0-flash', { instantMode: true });
  check(
    'gemini-2.0 sends no thinkingConfig (it rejects the field)',
    legacy.requests[0]?.thinkingConfig === undefined && legacy.requests.length === 1,
    `${legacy.requests.length} request(s), thinking=${JSON.stringify(legacy.requests[0]?.thinkingConfig)}`
  );
  check(
    'models without thinking support keep the FULL parameter set (topP)',
    legacy.requests[0]?.generationConfig?.topP !== undefined &&
      legacy.requests[0]?.generationConfig?.temperature !== undefined,
    JSON.stringify(legacy.requests[0]?.generationConfig)
  );
}

section('B. Instant Mode OFF: thoughts stream as reasoning (visible progress)');
{
  const r = await runGemini('gemini-2.5-flash', { instantMode: false });
  check(
    'includeThoughts requested',
    r.requests[0]?.thinkingConfig?.includeThoughts === true,
    JSON.stringify(r.requests[0]?.thinkingConfig)
  );
  check(
    'reasoning arrives before the answer text',
    r.firstReasoningAt !== null && r.firstContentAt !== null && r.firstReasoningAt < r.firstContentAt,
    `reasoning +${r.firstReasoningAt}ms vs content +${r.firstContentAt}ms`
  );
  check(
    'reasoning streamed progressively (not one block)',
    r.reasoningEvents.length >= THINK_CHUNKS,
    `${r.reasoningEvents.length} reasoning chunks`
  );
  check('answer text still streamed', r.contentEvents.length === TEXT_CHUNKS);
}

section('C. Rejected config retries the SAME model (no cascade to a worse one)');
{
  const r = await runGemini('gemini-3-flash', {
    instantMode: true,
    mockOpts: { rejectThinkingLevel: true },
  });
  check(
    'every attempt used the requested model',
    r.requests.every((q) => q.model === 'gemini-3-flash'),
    r.requests.map((q) => q.model).join(' → ')
  );
  check(
    'still produced the full answer',
    r.contentEvents.length === TEXT_CHUNKS && r.error === null,
    r.error?.message || `${r.contentEvents.length} chunks`
  );
  check(
    'a status note explained the retry',
    r.events.some((e) => typeof e.status === 'string' && e.status.length > 0),
    r.events.find((e) => e.status)?.status || 'none'
  );
}

section('D. OpenAI-compatible upstream streams token by token');
{
  const up = await startMockUpstream({ chunks: 14, delayMs: 40 });
  const r = await runCustom(up.baseUrl);
  const windows = new Set(r.contentEvents.map((e) => Math.floor(e.at / 40)));
  check('all deltas forwarded', r.contentEvents.length === 14, `${r.contentEvents.length} chunks`);
  check(
    'arrived spread over time (not buffered)',
    windows.size >= 8,
    `${windows.size} distinct arrival windows over ${r.total}ms`
  );
  check(
    'first token before the upstream finished',
    r.contentEvents[0].at < r.total * 0.4,
    `+${r.contentEvents[0].at}ms of ${r.total}ms`
  );
  await up.close();

  section('D2. Upstream that IGNORES stream:true still delivers its answer');
  const up2 = await startMockUpstream({ nonSse: true, chunks: 10 });
  const r2 = await runCustom(up2.baseUrl);
  const text = r2.contentEvents.map((e) => e.content).join('');
  check('non-SSE JSON body was delivered (not dropped)', text.includes('Chunk 10'), `${text.length} chars`);
  check(
    'a status note explains the single block',
    r2.events.some((e) => typeof e.status === 'string' && e.status.includes('streaming')),
    r2.events.find((e) => e.status)?.status || 'none'
  );
  check('no error thrown', r2.error === null, r2.error?.message || '');
  await up2.close();
}

section('E. Stop response aborts the upstream read');
{
  const up = await startMockUpstream({ chunks: 40, delayMs: 40 });
  const controller = new AbortController();
  const promise = runCustom(up.baseUrl, { signal: controller.signal });
  await sleep(180);
  controller.abort();
  const r = await promise;
  check(
    'stopped early (not all 40 chunks)',
    r.contentEvents.length < 20,
    `${r.contentEvents.length} chunks received before abort`
  );
  check('finished quickly after abort', r.total < 600, `${r.total}ms`);
  await up.close();
}

console.log(`\n${'═'.repeat(64)}`);
if (failures === 0) {
  console.log(`✅ ALL ${checks} STREAMING CHECKS PASSED`);
  process.exit(0);
}
console.log(`❌ ${failures} of ${checks} checks FAILED`);
process.exit(1);
