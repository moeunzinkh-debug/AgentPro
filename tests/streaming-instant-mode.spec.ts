import { expect, test } from '@playwright/test';

/**
 * Regression tests for: "Instant Mode generated the whole answer first and only
 * then displayed it" (ឆ្លើយតបយឺត / បង្កើតរួចរាល់ទាំងអស់ទើបបង្ហាញ).
 *
 * Three independent causes were found and fixed; each has a test here:
 *
 *  1. SERVER — Gemini was always asked to "think" first (and the hard-coded
 *     `thinkingLevel` was rejected by Gemini 2.x, so the request was even sent
 *     twice). Nothing was forwarded during the thinking phase, so the browser
 *     stared at "generating…" for seconds and the text then appeared at once.
 *     Instant Mode now disables thinking; covered by `npm run test:streaming`.
 *
 *  2. CLIENT — streamed tokens were committed to the UI only from a
 *     `requestAnimationFrame` callback. rAF never fires while the page is
 *     hidden (background tab, locked phone screen, a preview iframe that is
 *     off-screen), so the entire reply was buffered and painted in one jump
 *     when the page became visible again. A setTimeout watchdog now guarantees
 *     painting, and the very first token paints immediately.
 *
 *  3. CLIENT — ANY stream error silently triggered a second, complete
 *     non-streaming generation. That doubled the waiting time and, by
 *     definition, displayed everything at once at the end. The fallback is now
 *     limited to endpoints that genuinely cannot stream.
 *
 * The same guarantees are covered without a browser by `npm run test:dom`.
 */

interface FakeOpts {
  /** How the fake /api/chat?stream=true endpoint behaves. */
  mode: 'sse' | 'http-error' | 'sse-error';
  chunks: number;
  delayMs: number;
  /** Freeze requestAnimationFrame + report the document as hidden. */
  pausedFrames: boolean;
  /** Provider of the seeded model ('gemini' → the UI is always Instant Mode). */
  provider: 'gemini' | 'openai';
  instantMode: boolean;
}

const DEFAULT_OPTS: FakeOpts = {
  mode: 'sse',
  chunks: 50,
  delayMs: 50,
  pausedFrames: false,
  provider: 'gemini',
  instantMode: true,
};

function seedStorageAndFakeApi(opts: FakeOpts) {
  const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v));
  localStorage.setItem('agentpro_cleared_all_models_v6', 'true');

  const modelId = `${opts.provider}-test-model`;
  set('agentpro_models_v1', [
    {
      id: modelId,
      name: 'Streaming Test Model',
      provider: opts.provider,
      description: 'fake model for instant-mode streaming regression',
      contextLength: 128000,
      isFree: true,
      category: 'general',
      providerModelId: opts.provider === 'gemini' ? 'gemini-2.5-flash' : 'gpt-4o',
      tags: ['test'],
      isUserSaved: true,
    },
  ]);
  localStorage.setItem('agentpro_active_model_v1', modelId);
  set('agentpro_saved_model_ids_v1', [modelId]);
  set('agentpro_providers_v1', {
    [opts.provider]: {
      id: opts.provider,
      name: opts.provider,
      badge: opts.provider.toUpperCase(),
      description: '',
      apiKey: 'sk-test-key',
      baseUrl: '',
      enabled: true,
      isConfigured: true,
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
      systemPrompt: 'You are a test assistant.',
      systemPreset: 'agent-pro',
      stream: true,
      enableReasoning: true,
      instantMode: opts.instantMode,
    },
  });

  const w = window as any;
  w.__chatCalls = [] as string[];
  w.__bodies = [] as any[];
  w.__streamStartedAt = 0;
  w.__firstPaintAt = 0;
  w.__streamEndedAt = 0;
  w.__partialSeen = false;
  w.__liveCounterSeen = false;

  // Case 2: emulate a hidden page — frames are paused, timers still run.
  if (opts.pausedFrames) {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    w.requestAnimationFrame = () => 0; // never fires
    w.cancelAnimationFrame = () => {};
  }

  // Record what the user actually sees, when they see it. Polling from the test
  // body races with a busy machine, so every assertion uses these facts.
  const watchPaint = () => {
    w.__streamStartedAt = performance.now();
    const timer = window.setInterval(() => {
      const bubbles = document.querySelectorAll('.chat-bubble-assistant');
      const txt = (bubbles[bubbles.length - 1]?.textContent || '').trim();
      if (!w.__firstPaintAt && txt.includes('MARKER_1')) w.__firstPaintAt = performance.now();
      if ((document.body.textContent || '').includes('តួអក្សរ · live')) w.__liveCounterSeen = true;
      if (txt.includes('MARKER_3') && !txt.includes(`MARKER_${opts.chunks}`)) w.__partialSeen = true;
    }, 16);
    w.__paintWatcher = timer;
  };

  const origFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    if (url.includes('/api/chat')) {
      w.__chatCalls.push(url);
      try {
        w.__bodies.push(JSON.parse((init?.body as string) || '{}'));
      } catch {
        w.__bodies.push({});
      }
      const isStreamCall = url.includes('stream=true');

      // The endpoint cannot stream at all → the app may fall back ONCE.
      if (isStreamCall && opts.mode === 'http-error') {
        return new Response(JSON.stringify({ error: 'streaming not supported here' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (isStreamCall) {
        const encoder = new TextEncoder();
        watchPaint();

        if (opts.mode === 'sse-error') {
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ error: 'Quota or rate limit exceeded (429).' })}\n\n`
                )
              );
              controller.close();
              w.__streamEndedAt = performance.now();
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
            if (i < opts.chunks) {
              i += 1;
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    content: `MARKER_${i} ប្រយោគទី ${i} នៃឯកសារវែង។\n`,
                    model: 'streaming-test-model',
                  })}\n\n`
                )
              );
              await new Promise((r) => setTimeout(r, opts.delayMs));
            } else {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
              w.__streamEndedAt = performance.now();
            }
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }

      // Direct (non-streaming) endpoint used by the fallback path.
      return new Response(
        JSON.stringify({
          content: 'FALLBACK_COMPLETE_ANSWER',
          model: 'streaming-test-model',
          provider: opts.provider,
          tokensUsed: 10,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }

    return origFetch(input as any, init);
  };
}

async function boot(page: any, opts: Partial<FakeOpts> = {}) {
  const merged = { ...DEFAULT_OPTS, ...opts };
  await page.addInitScript(seedStorageAndFakeApi, merged);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'AI Chat' })).toBeVisible();
  return merged;
}

async function send(page: any, text = 'សរសេរឯកសារវែងមួយអំពីស្ថាបត្យកម្ម។') {
  const composer = page.getByPlaceholder('Ask anything or discuss attached files...');
  await composer.click();
  await composer.fill(text);
  await composer.press('Control+Enter');
}

const facts = (page: any) =>
  page.evaluate(() => {
    const w = window as any;
    return {
      calls: w.__chatCalls as string[],
      bodies: w.__bodies as any[],
      startedAt: w.__streamStartedAt as number,
      firstPaintAt: w.__firstPaintAt as number,
      endedAt: w.__streamEndedAt as number,
      partialSeen: w.__partialSeen as boolean,
      liveCounterSeen: w.__liveCounterSeen as boolean,
    };
  });

test.describe('Instant Mode must stream from the first token to the last', () => {
  test.use({ viewport: { width: 393, height: 750 } });

  test('reply is displayed progressively, not after the whole generation', async ({ page }) => {
    const opts = await boot(page);
    await send(page);

    const bubble = page.locator('.chat-bubble-assistant').last();
    await expect(bubble).toContainText(`MARKER_${opts.chunks}`, { timeout: 60_000 });
    await expect(page.getByTitle('Copy reply')).toBeVisible({ timeout: 10_000 });

    const f = await facts(page);
    const ttft = f.firstPaintAt - f.startedAt;
    const total = f.endedAt - f.startedAt;
    console.log(`  time-to-first-painted-token: ${ttft.toFixed(0)}ms of ${total.toFixed(0)}ms`);

    expect(f.partialSeen).toBe(true);
    expect(f.liveCounterSeen).toBe(true);
    expect(ttft).toBeGreaterThan(0);
    expect(ttft).toBeLessThan(2000);
    expect(ttft).toBeLessThan(total * 0.6);
    // One request only: no hidden second generation.
    expect(f.calls.length).toBe(1);
    expect(f.calls[0]).toContain('stream=true');
    // The server must be told to skip the thinking phase.
    expect(f.bodies[0]?.instantMode).toBe(true);
  });

  test('keeps streaming while animation frames are paused (hidden tab / iframe)', async ({
    page,
  }) => {
    const opts = await boot(page, { pausedFrames: true });
    await send(page);

    const bubble = page.locator('.chat-bubble-assistant').last();
    await expect(bubble).toContainText(`MARKER_${opts.chunks}`, { timeout: 60_000 });

    const f = await facts(page);
    // With rAF frozen this is exactly the old failure: nothing painted until
    // generation finished, then the whole reply appeared at once.
    expect(f.partialSeen).toBe(true);
    expect(f.liveCounterSeen).toBe(true);
    expect(f.calls.length).toBe(1);
  });

  test('a stream error is reported at once — no second full generation', async ({ page }) => {
    await boot(page, { mode: 'sse-error' });
    await send(page);

    await expect(page.locator('.chat-error-gradient')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.chat-error-gradient')).toContainText('Quota or rate limit');

    // The app did NOT run another (complete, non-streaming) generation, which
    // used to double the wait and dump the answer at the end.
    const f = await facts(page);
    expect(f.calls.length).toBe(1);
    expect(f.calls[0]).toContain('stream=true');
  });

  test('falls back to ONE direct generation only when streaming is unavailable', async ({
    page,
  }) => {
    await boot(page, { mode: 'http-error' });
    await send(page);

    await expect(page.locator('.chat-bubble-assistant').last()).toContainText(
      'FALLBACK_COMPLETE_ANSWER',
      { timeout: 20_000 }
    );

    const f = await facts(page);
    expect(f.calls.length).toBe(2); // one failed stream attempt + one direct call
    expect(f.calls[0]).toContain('stream=true');
    expect(f.calls[1]).not.toContain('stream=true');
  });

  test('non-instant models stream too (Instant Mode is never the only path)', async ({ page }) => {
    const opts = await boot(page, { provider: 'openai', instantMode: false });
    await send(page);

    const bubble = page.locator('.chat-bubble-assistant').last();
    await expect(bubble).toContainText(`MARKER_${opts.chunks}`, { timeout: 60_000 });

    const f = await facts(page);
    expect(f.partialSeen).toBe(true);
  });
});
