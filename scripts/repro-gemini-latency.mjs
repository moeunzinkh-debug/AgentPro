/**
 * Reproduction / diagnostic harness: measures WHERE the time goes for a Gemini
 * Instant-Mode request, using a mock of the real Gemini REST API (no API key
 * needed).
 *
 *   npm run diag:gemini-latency            # gemini-2.5-flash
 *   node scripts/repro-gemini-latency.mjs gemini-3-pro
 *
 * The mock emulates documented server behaviour:
 *   - `thinkingConfig.thinkingLevel` is ONLY accepted by Gemini 3 models;
 *     2.5 / 2.0 models answer 400 INVALID_ARGUMENT ("Unknown name").
 *   - When thinking is active (default for 2.5 models, thinkingBudget != 0),
 *     the stream first emits thought-only chunks (`part.thought = true`) before
 *     the first visible text chunk.
 *   - When thinking is disabled (thinkingBudget: 0), the first text chunk
 *     arrives immediately.
 */
import { handleChatStreamRequest } from '../src/server/apiRouter.ts';

const MODEL = process.argv[2] || 'gemini-2.5-flash';
const THINK_CHUNKS = 12;
const THINK_STEP_MS = 120; // ~1.4s of invisible thinking
const TEXT_CHUNKS = 20;
const TEXT_STEP_MS = 60;
const RTT_MS = 250; // network round trip for a rejected request

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const requests = [];

function sseResponse(frames) {
  const encoder = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream({
    async pull(controller) {
      if (i < frames.length) {
        const f = frames[i++];
        if (f.delay) await sleep(f.delay);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(f.body)}\n\n`));
      } else {
        // NOTE: the real Gemini SSE stream has NO [DONE] sentinel (that is an
        // OpenAI convention). The SDK throws on a trailing non-JSON segment.
        controller.close();
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.includes('generativelanguage.googleapis.com')) return originalFetch(input, init);

  const body = JSON.parse(init.body);
  const modelInPath = url.match(/models\/([^:/?]+):/)?.[1] || MODEL;
  const thinking = body.generationConfig?.thinkingConfig;
  requests.push({ model: modelInPath, thinkingConfig: thinking, at: Date.now() });

  // 1. thinkingLevel is rejected by 2.x models (real API behaviour).
  const isGemini3 = /^gemini-3/.test(modelInPath);
  if (thinking && thinking.thinkingLevel !== undefined && !isGemini3) {
    await sleep(RTT_MS);
    return new Response(
      JSON.stringify({
        error: {
          code: 400,
          message: 'Invalid JSON payload received. Unknown name "thinkingLevel": Cannot find field.',
          status: 'INVALID_ARGUMENT',
        },
      }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    );
  }

  // 2. Decide whether the model will "think" before emitting visible text.
  const budget = thinking?.thinkingBudget;
  const willThink = budget === undefined || budget === -1 || budget > 0;

  const frames = [];
  if (willThink) {
    for (let t = 0; t < THINK_CHUNKS; t++) {
      frames.push({
        delay: t === 0 ? RTT_MS : THINK_STEP_MS,
        body: {
          candidates: [
            { content: { role: 'model', parts: [{ text: `thinking ${t}... `, thought: true }] } },
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
      body: { candidates: [{ content: { role: 'model', parts: [{ text: `Token${t} ` }] } }] },
    });
  }
  return sseResponse(frames);
};

const t0 = Date.now();
let firstContentAt = null;
let firstReasoningAt = null;
let contentChunks = 0;
let reasoningChunks = 0;

await handleChatStreamRequest(
  {
    provider: 'gemini',
    model: MODEL,
    messages: [{ role: 'user', content: 'សរសេរឯកសារវែងមួយ' }],
    apiKey: 'fake-key-for-repro',
    instantMode: true,
    parameters: { temperature: 0.7, maxTokens: 4096, topP: 0.95 },
  },
  (chunk) => {
    const now = Date.now() - t0;
    if (chunk.content) {
      contentChunks++;
      if (firstContentAt === null) firstContentAt = now;
    }
    if (chunk.reasoning) {
      reasoningChunks++;
      if (firstReasoningAt === null) firstReasoningAt = now;
    }
  }
);

const total = Date.now() - t0;
console.log('\n================ GEMINI STREAM TIMING ================');
console.log('model requested      :', MODEL);
console.log('HTTP requests made   :', requests.length);
requests.forEach((r, i) =>
  console.log(
    `  #${i + 1} ${r.model} thinkingConfig=${JSON.stringify(r.thinkingConfig ?? null)} at +${r.at - t0}ms`
  )
);
console.log('first VISIBLE token  :', firstContentAt === null ? 'never' : `+${firstContentAt}ms`);
console.log('first reasoning token:', firstReasoningAt === null ? 'never' : `+${firstReasoningAt}ms`);
console.log('content chunks       :', contentChunks);
console.log('reasoning chunks     :', reasoningChunks);
console.log('total                :', `${total}ms`);
console.log('wasted before 1st tok:', `${firstContentAt ?? total}ms`);
console.log('======================================================\n');
