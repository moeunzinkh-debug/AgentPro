/**
 * DOM-level streaming test: renders the REAL <App/> (App.tsx + ChatView +
 * MarkdownView + apiClient + streamPainter) inside jsdom and watches the reply
 * being painted while a fake SSE endpoint is still streaming.
 *
 * It exists because the Playwright suite needs a browser download, which is not
 * available in every CI/sandbox. Run it with:
 *
 *   npm run test:dom
 *
 * Scenarios (each one re-renders the app from scratch):
 *   G1. visible page  -> partial reply on screen while the stream still runs
 *   G2. hidden page   -> same, with requestAnimationFrame frozen (the old bug:
 *                        everything was buffered and painted in one jump)
 *   G3. stream error  -> reported immediately, exactly ONE request (no hidden
 *                        second full generation)
 *   G4. no streaming  -> ONE fallback request, answer displayed
 *   G5. non-instant   -> standard streaming path behaves the same
 *   G6. empty reply   -> reported with Retry, never stuck on the spinner
 *
 * All timing assertions use facts RECORDED by an in-page watcher: polling the
 * DOM from the test body races with a busy machine (a finished reply no longer
 * shows the live counter), which made the checks flaky under load.
 */
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from '../src/App';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = '') {
  checks++;
  if (ok) console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`);
  else {
    failures++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
const section = (t: string) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 62 - t.length))}`);

type Mode = 'sse' | 'http-error' | 'sse-error' | 'sse-empty';

interface Scenario {
  mode: Mode;
  chunks: number;
  delayMs: number;
  provider: 'gemini' | 'openai';
  instantMode: boolean;
}

interface Timing {
  streamStartedAt: number;
  firstPaintAt: number;
  streamEndedAt: number;
  liveCounterSeen: boolean;
  partialSeen: boolean;
}

interface Harness {
  root: Root;
  container: HTMLElement;
  calls: string[];
  bodies: any[];
  timing: Timing;
  text: () => string;
  bubbleText: () => string;
  send: (message: string) => Promise<void>;
  teardown: () => void;
}

async function bootApp(scenario: Scenario): Promise<Harness> {
  // --- fresh storage -------------------------------------------------------
  localStorage.clear();
  localStorage.setItem('agentpro_cleared_all_models_v6', 'true');
  const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v));
  const modelId = `${scenario.provider}-test-model`;
  set('agentpro_models_v1', [
    {
      id: modelId,
      name: 'Streaming Test Model',
      provider: scenario.provider,
      description: 'fake model',
      contextLength: 128000,
      isFree: true,
      category: 'general',
      providerModelId: scenario.provider === 'gemini' ? 'gemini-2.5-flash' : 'gpt-4o',
      tags: ['test'],
      isUserSaved: true,
    },
  ]);
  localStorage.setItem('agentpro_active_model_v1', modelId);
  set('agentpro_saved_model_ids_v1', [modelId]);
  set('agentpro_providers_v1', {
    [scenario.provider]: {
      id: scenario.provider,
      name: scenario.provider,
      badge: scenario.provider.toUpperCase(),
      description: '',
      apiKey: 'sk-test',
      baseUrl: '',
      enabled: true,
      isConfigured: true,
      freeTierInfo: '',
      defaultModel: 'x',
      keyPlaceholder: '',
      docsUrl: '',
      iconType: 'x',
    },
  });
  set('agentpro_settings_v1', {
    theme: 'immersive',
    parameters: {
      temperature: 0.7,
      topP: 0.95,
      maxTokens: 4096,
      presencePenalty: 0,
      frequencyPenalty: 0,
      systemPrompt: 'Test assistant.',
      systemPreset: 'agent-pro',
      stream: true,
      enableReasoning: true,
      instantMode: scenario.instantMode,
    },
  });

  // --- fake chat API -------------------------------------------------------
  const calls: string[] = [];
  const bodies: any[] = [];
  const timing: Timing = {
    streamStartedAt: 0,
    firstPaintAt: 0,
    streamEndedAt: 0,
    liveCounterSeen: false,
    partialSeen: false,
  };

  (globalThis as any).fetch = async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url || String(input);
    if (!url.includes('/api/chat')) {
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    calls.push(url);
    try {
      bodies.push(JSON.parse(init?.body || '{}'));
    } catch {
      bodies.push({});
    }
    const isStreamCall = url.includes('stream=true');

    if (isStreamCall && scenario.mode === 'http-error') {
      return new Response(JSON.stringify({ error: 'streaming not supported here' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (isStreamCall) {
      const encoder = new TextEncoder();
      timing.streamStartedAt = Date.now();

      if (scenario.mode === 'sse-error') {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ error: 'Quota or rate limit exceeded (429).' })}\n\n`
              )
            );
            controller.close();
            timing.streamEndedAt = Date.now();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }

      if (scenario.mode === 'sse-empty') {
        // The model produced nothing at all.
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
            timing.streamEndedAt = Date.now();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }

      let i = 0;
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (i < scenario.chunks) {
            i += 1;
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  content: `MARKER_${i} ប្រយោគទី ${i} នៃឯកសារវែង។\n`,
                  model: 'streaming-test-model',
                })}\n\n`
              )
            );
            // Record the end of generation the moment the LAST content chunk is
            // enqueued. This strictly precedes the chunk appearing in the DOM,
            // so a watcher that waits for the final marker can never observe
            // streamEndedAt as 0 (which would make `total` a huge negative).
            if (i === scenario.chunks) timing.streamEndedAt = Date.now();
            await sleep(scenario.delayMs);
          } else {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
            if (!timing.streamEndedAt) timing.streamEndedAt = Date.now();
          }
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }

    return new Response(
      JSON.stringify({
        content: 'FALLBACK_COMPLETE_ANSWER',
        model: 'streaming-test-model',
        provider: scenario.provider,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };

  // --- render --------------------------------------------------------------
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  root.render(React.createElement(App));
  await sleep(150);

  const bubbleText = () => {
    const list = container.querySelectorAll('.chat-bubble-assistant');
    return (list[list.length - 1]?.textContent || '').trim();
  };

  // Watch the DOM continuously and RECORD what was seen.
  const watcher = setInterval(() => {
    if (!timing.streamStartedAt) return;
    const txt = bubbleText();
    const pageText = container.textContent || '';
    if (!timing.firstPaintAt && txt.includes('MARKER_1')) timing.firstPaintAt = Date.now();
    if (pageText.includes('តួអក្សរ · live')) timing.liveCounterSeen = true;
    if (txt.includes('MARKER_3') && !txt.includes(`MARKER_${scenario.chunks}`)) {
      timing.partialSeen = true;
    }
  }, 4);

  const send = async (message: string) => {
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    if (!textarea) throw new Error('composer textarea not found');
    const setter = Object.getOwnPropertyDescriptor(
      (window as any).HTMLTextAreaElement.prototype,
      'value'
    )!.set!;
    setter.call(textarea, message);
    textarea.dispatchEvent(new (window as any).Event('input', { bubbles: true }));
    await sleep(80);
    const sendButton = container.querySelector('button[title="Send message (⬆️)"]') as HTMLElement;
    if (!sendButton) throw new Error('send button not found');
    sendButton.dispatchEvent(new (window as any).MouseEvent('click', { bubbles: true }));
    await sleep(40);
  };

  return {
    root,
    container,
    calls,
    bodies,
    timing,
    text: () => container.textContent || '',
    bubbleText,
    send,
    teardown: () => {
      clearInterval(watcher);
      root.unmount();
      container.remove();
    },
  };
}

/** Wait until `predicate` is true or the timeout elapses. */
async function waitFor(predicate: () => boolean, timeoutMs: number, stepMs = 15): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(stepMs);
  }
  return predicate();
}

/**
 * Cheap warm-up pass: boot the real app, push a tiny stream through the full
 * React → painter → markdown path, then tear down. This absorbs the cold-start
 * JIT/jsdom cost so the first MEASURED scenario (G1) is not the slow one, which
 * otherwise made its timing checks flake on a very first run.
 */
export async function warmUp() {
  const h = await bootApp({ mode: 'sse', chunks: 3, delayMs: 1, provider: 'gemini', instantMode: true });
  await h.send('warm up');
  await waitFor(() => h.bubbleText().includes('MARKER_3'), 8000);
  await sleep(30);
  h.teardown();
}

export async function runDomTests() {
  console.log('Agent Pro — DOM streaming verification (jsdom + real <App/>)');

  // ---------------------------------------------------------------- 1 ------
  section('G1. visible page: the reply paints while it is still streaming');
  {
    const h = await bootApp({
      mode: 'sse',
      chunks: 50,
      delayMs: 50,
      provider: 'gemini',
      instantMode: true,
    });
    await h.send('សរសេរឯកសារវែងមួយ។');

    const done = await waitFor(() => h.bubbleText().includes('MARKER_50'), 30000);
    check('the full reply finished rendering', done);
    check(
      'a partial reply was on screen mid-stream',
      h.timing.partialSeen,
      `final: "${h.bubbleText().slice(0, 42)}…"`
    );
    check('Instant Mode badge rendered', h.text().includes('Instant Mode'));
    check('live character counter rendered while streaming', h.timing.liveCounterSeen);

    const ttft = h.timing.firstPaintAt - h.timing.streamStartedAt;
    const total = h.timing.streamEndedAt - h.timing.streamStartedAt;
    console.log(`     time-to-first-painted-token: ${ttft}ms of ${total}ms generation`);
    check('first token painted almost immediately', ttft >= 0 && ttft < 2000, `${ttft}ms`);
    check(
      'first token painted well before the end',
      total > 0 && ttft < total * 0.6,
      `${ttft}ms / ${total}ms`
    );
    check('exactly one chat request (no hidden regeneration)', h.calls.length === 1, `${h.calls.length}`);
    check('the request asked for a stream', h.calls[0]?.includes('stream=true') === true);
    check(
      'the request told the SERVER to use Instant Mode (thinking off)',
      h.bodies[0]?.instantMode === true,
      `instantMode=${h.bodies[0]?.instantMode}`
    );
    h.teardown();
  }

  // ---------------------------------------------------------------- 3 ------
  section('G3. stream error: reported at once, no second generation');
  {
    const h = await bootApp({
      mode: 'sse-error',
      chunks: 0,
      delayMs: 0,
      provider: 'gemini',
      instantMode: true,
    });
    await h.send('សួស្ដី');
    const shown = await waitFor(() => h.text().includes('Quota or rate limit'), 20000);
    check('error surfaced to the user', shown);
    check('only ONE request was made', h.calls.length === 1, `${h.calls.length}: ${h.calls.join(', ')}`);
    h.teardown();
  }

  // ---------------------------------------------------------------- 4 ------
  section('G4. endpoint cannot stream: exactly one fallback generation');
  {
    const h = await bootApp({
      mode: 'http-error',
      chunks: 0,
      delayMs: 0,
      provider: 'openai',
      instantMode: true,
    });
    await h.send('សួស្ដី');
    const shown = await waitFor(() => h.bubbleText().includes('FALLBACK_COMPLETE_ANSWER'), 20000);
    check('fallback answer displayed', shown, `"${h.bubbleText().slice(0, 40)}"`);
    check('two requests total (stream attempt + fallback)', h.calls.length === 2, `${h.calls.length}`);
    check('first attempt was the streaming one', h.calls[0]?.includes('stream=true') === true);
    h.teardown();
  }

  // ---------------------------------------------------------------- 5 ------
  section('G5. non-instant model also streams');
  {
    const h = await bootApp({
      mode: 'sse',
      chunks: 30,
      delayMs: 50,
      provider: 'openai',
      instantMode: false,
    });
    await h.send('សរសេរអត្ថបទវែង។');
    const done = await waitFor(() => h.bubbleText().includes('MARKER_30'), 30000);
    check('full reply rendered', done);
    check('partial reply was visible mid-stream', h.timing.partialSeen);
    h.teardown();
  }

  // ---------------------------------------------------------------- 6 ------
  section('G6. empty generation: reported, never stuck on the spinner');
  {
    const h = await bootApp({
      mode: 'sse-empty',
      chunks: 0,
      delayMs: 0,
      provider: 'gemini',
      instantMode: true,
    });
    await h.send('សួស្ដី');
    const reported = await waitFor(() => h.text().includes('the model returned no text'), 25000);
    check('empty reply reported with a Retry path', reported);
    check(
      'the bubble is NOT stuck on "is generating response…"',
      !h.text().includes('កំពុងបង្កើតចម្លើយ') && !h.text().includes('streaming response live'),
      h.bubbleText().slice(0, 40)
    );
    check('only one request was made', h.calls.length === 1, `${h.calls.length}`);
    h.teardown();
  }

  return { failures, checks };
}

/**
 * Same progressive-painting assertions, but the runner has frozen
 * requestAnimationFrame and marked the document hidden — the exact conditions
 * under which the old code buffered the whole reply and painted it in one jump.
 */
export async function runPausedFrameTests() {
  section('G2. hidden page / frozen rAF: still paints progressively');
  const h = await bootApp({
    mode: 'sse',
    chunks: 50,
    delayMs: 50,
    provider: 'gemini',
    instantMode: true,
  });
  await h.send('សរសេរឯកសារវែងមួយ។');

  const done = await waitFor(() => h.bubbleText().includes('MARKER_50'), 30000);
  check('the full reply finished rendering', done);
  check(
    'reply painted progressively even though frames never ran',
    h.timing.partialSeen,
    `final: "${h.bubbleText().slice(0, 42)}…"`
  );
  check('live counter updated with frames frozen', h.timing.liveCounterSeen);
  check('exactly one chat request', h.calls.length === 1, `${h.calls.length}`);
  h.teardown();

  return { failures, checks };
}

export function summarize() {
  console.log(`\n${'═'.repeat(64)}`);
  if (failures === 0) {
    console.log(`✅ ALL ${checks} DOM CHECKS PASSED`);
    return 0;
  }
  console.log(`❌ ${failures} of ${checks} DOM checks FAILED`);
  return 1;
}
