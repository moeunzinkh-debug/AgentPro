import { expect, test, type Page } from '@playwright/test';

/**
 * Regression test for the "stutter while a long reply streams in" bug.
 *
 * Root cause (verified by code inspection, NOT the server/worker): the
 * Cloudflare Worker only forwards SSE chunks — it does no heavy work. The jank
 * was 100% client-side: every streamed token re-rendered the whole conversation
 * and re-parsed the markdown of every message, and a long reply re-rendered its
 * (growing) markdown on every single animation frame.
 *
 * The fixes under test:
 *   1. MarkdownView is `memo`-ized, so unchanged/completed messages are skipped
 *      during every streamed frame.
 *   2. Each message row uses `content-visibility: auto`, so off-screen messages
 *      are skipped by the browser's layout/paint.
 *   3. App.tsx caps re-renders of a long reply to ~25fps once it passes 4k chars
 *      (short replies stay at full frame rate).
 *
 * This test streams a LARGE reply and asserts the viewport stays pinned AND the
 * browser reports very few (ideally zero) long tasks (>50ms) — i.e. no jank.
 */

const CHAT_VIEWPORT = '.chat-viewport';

function seedStorageAndFakeApi(opts: { chunks: number; bytesPerChunk: number }) {
  const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v));
  localStorage.setItem('agentpro_cleared_all_models_v6', 'true');
  set('agentpro_models_v1', [
    {
      id: 'test-model',
      name: 'Test Model',
      provider: 'openai',
      description: 'fake model for streaming perf regression',
      contextLength: 8192,
      isFree: false,
      category: 'general',
      providerModelId: 'gpt-4o',
      tags: ['test'],
      isUserSaved: true,
    },
  ]);
  localStorage.setItem('agentpro_active_model_v1', 'test-model');
  set('agentpro_saved_model_ids_v1', ['test-model']);
  set('agentpro_providers_v1', {
    openai: {
      id: 'openai',
      name: 'OpenAI',
      badge: 'OPENAI',
      description: '',
      apiKey: 'sk-test-key',
      baseUrl: '',
      enabled: true,
    },
  });

  // Fabricate a big, markdown-heavy SSE stream. We emit chunks as fast as the
  // event loop allows so the UI is exercised far harder than a real stream.
  const origFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/api/chat') && url.includes('stream=true')) {
      const encoder = new TextEncoder();
      const { chunks, bytesPerChunk } = (window as any).__perfOpts;
      let i = 0;
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (i < chunks) {
            // A realistic paragraph with a header, a list and a code fence so the
            // markdown parser has real work to do.
            const para =
              `## Section ${i}\n` +
              'This is a sentence that keeps growing as the model streams more tokens. ' +
              'It contains **bold** and `inline code` to exercise the inline parser. '.repeat(
                Math.max(1, Math.floor(bytesPerChunk / 120))
              ) +
              '\n- bullet one\n- bullet two\n- bullet three\n' +
              '```ts\nconst x = ' +
              i +
              ';\nfunction handler() { return x * 2; }\n```\n\n';
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: para })}\n\n`));
            i += 1;
            // Small delay so the stream spans many frames (like a real model).
            await new Promise((r) => setTimeout(r, 4));
          } else {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          }
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    return origFetch(input as any, init);
  };
}

async function startLongTaskMonitor(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.__longTasks = 0;
    w.__stopped = false;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > 50) w.__longTasks += 1;
      }
    });
    try {
      observer.observe({ entryTypes: ['longtask'] });
      w.__observer = observer;
    } catch {
      // longtask API unsupported — nothing to measure.
    }
  });
}

async function readLongTaskCount(page: Page) {
  return page.evaluate(() => {
    const w = window as any;
    try {
      w.__observer?.disconnect();
    } catch {}
    return w.__longTasks ?? 0;
  });
}

async function sendMessage(page: Page) {
  const composer = page.getByPlaceholder('Ask anything or discuss attached files...');
  await composer.click();
  await composer.fill('Write a very long, detailed technical document.');
  await composer.press('Control+Enter');
}

test.describe('streaming chat render perf (no jank on long replies)', () => {
  test.use({ viewport: { width: 393, height: 750 } }); // phone viewport

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((opts) => {
      (window as any).__perfOpts = opts;
    }, { chunks: 220, bytesPerChunk: 320 });
    await page.addInitScript(seedStorageAndFakeApi, { chunks: 220, bytesPerChunk: 320 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'AI Chat' })).toBeVisible();
  });

  test('long reply streams without long tasks and stays pinned', async ({ page }) => {
    await sendMessage(page);
    await startLongTaskMonitor(page);

    // The Copy button only renders once generation has finished.
    await expect(page.getByTitle('Copy reply')).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(300);

    const longTasks = await readLongTaskCount(page);

    // No (or only a handful of) long tasks during a ~220-chunk stream. If the
    // per-frame markdown re-parse / whole-conversation re-render regresses,
    // this number explodes into the hundreds.
    expect(longTasks).toBeLessThan(15);

    // Tail of the reply is fully visible (pinned), measured live.
    await expect
      .poll(async () => {
        return page.evaluate(() => {
          const el = document.querySelector('.chat-viewport') as HTMLElement;
          return el.scrollHeight - el.scrollTop - el.clientHeight;
        });
      })
      .toBeLessThanOrEqual(2);

    // The reply actually rendered a lot of content.
    const lastBubble = page.locator('.chat-bubble-assistant').last();
    await expect(lastBubble).toContainText('Section 219');
    await expect(lastBubble).toBeInViewport();
  });
});
