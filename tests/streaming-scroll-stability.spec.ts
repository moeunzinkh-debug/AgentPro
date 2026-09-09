import { expect, test, type Page } from '@playwright/test';

/**
 * Regression test for the mobile streaming chat bug: while the model was
 * replying, the viewport jumped around and eventually lost its
 * "follow the bottom" state, so the tail of the reply was cut off out of
 * view (and older replies scrolled away mid-read).
 */

const CHAT_VIEWPORT = '.chat-viewport';

function seedStorageAndFakeApi() {
  const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v));
  localStorage.setItem('agentpro_cleared_all_models_v6', 'true');
  set('agentpro_models_v1', [
    {
      id: 'test-model',
      name: 'Test Model',
      provider: 'openai',
      description: 'fake model for streaming scroll regression',
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

  // Fake an incremental SSE stream: one short chunk every 25ms (~150 chunks),
  // so the UI updates frame-by-frame like a real streamed reply.
  const origFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/api/chat') && url.includes('stream=true')) {
      const encoder = new TextEncoder();
      let i = 0;
      const total = 150;
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (i < total) {
            const payload = { content: ` Streamed sentence number ${i + 1}.\n` };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            i += 1;
            await new Promise((r) => setTimeout(r, 25));
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

async function startScrollMonitor(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.__distances = [] as number[];
    w.__pageScroll = 0;
    w.__monitorStopped = false;
    const tick = () => {
      const el = document.querySelector('.chat-viewport') as HTMLElement | null;
      if (el) {
        w.__distances.push(el.scrollHeight - el.scrollTop - el.clientHeight);
      }
      w.__pageScroll = Math.max(w.__pageScroll, window.scrollY);
      if (!w.__monitorStopped) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function readMonitor(page: Page) {
  return page.evaluate(() => {
    const w = window as any;
    w.__monitorStopped = true;
    const distances: number[] = w.__distances;
    return {
      samples: distances.length,
      maxDistance: distances.length ? Math.max(...distances) : -1,
      finalDistance: distances.length ? distances[distances.length - 1] : -1,
      pageScrollY: w.__pageScroll,
    };
  });
}

async function sendMessage(page: Page) {
  const composer = page.getByPlaceholder('Ask anything or discuss attached files...');
  await composer.click();
  await composer.fill('Hello! Tell me a long story.');
  await composer.press('Control+Enter');
}

async function waitForStreamEnd(page: Page) {
  // The Copy button only renders once generation has finished.
  await expect(page.getByTitle('Copy reply')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(250); // let final reflow/pin settle
}

test.describe('streaming chat scroll stability', () => {
  test.use({ viewport: { width: 393, height: 750 } }); // phone viewport

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(seedStorageAndFakeApi);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'AI Chat' })).toBeVisible();
  });

  test('viewport stays pinned to the newest reply while streaming', async ({ page }) => {
    await sendMessage(page);
    await startScrollMonitor(page);
    await waitForStreamEnd(page);

    const monitor = await readMonitor(page);
    expect(monitor.samples).toBeGreaterThan(40); // the stream really did span many frames

    // Never lost the bottom while tokens were arriving (this is the jump bug).
    expect(monitor.maxDistance).toBeLessThan(160);
    // Fully visible at the end (this is the cut-off bug) — measured live.
    await expect
      .poll(async () => {
        return page.evaluate(() => {
          const el = document.querySelector('.chat-viewport') as HTMLElement;
          return el.scrollHeight - el.scrollTop - el.clientHeight;
        });
      })
      .toBeLessThanOrEqual(2);
    // The page itself must never scroll — only the chat viewport.
    expect(monitor.pageScrollY).toBe(0);

    // Last reply text is actually rendered and in view.
    const lastBubble = page.locator('.chat-bubble-assistant').last();
    await expect(lastBubble).toContainText('Streamed sentence number 150');
    await expect(lastBubble).toBeInViewport();

    // No spurious "Scroll to bottom" button while pinned.
    await expect(page.getByTitle(/Scroll to bottom/)).toHaveCount(0);
  });

  test('user scrolling up mid-stream is not snapped back, button returns them', async ({ page }) => {
    await sendMessage(page);
    await startScrollMonitor(page);

    // Let a bit of the reply stream in, then start reading older text.
    await page.waitForTimeout(1200);
    await page.mouse.move(196, 400);
    await page.mouse.wheel(0, -420);
    await page.waitForTimeout(1200);

    const pinned = await page.evaluate(() => {
      const el = document.querySelector('.chat-viewport') as HTMLElement;
      return el.scrollHeight - el.scrollTop - el.clientHeight;
    });
    // Auto-follow must stay paused while the user reads (no snap-back).
    expect(pinned).toBeGreaterThan(300);

    // The floating "scroll to bottom" button should be available.
    const toBottom = page.getByTitle(/Scroll to bottom/);
    await expect(toBottom).toBeVisible();

    // Clicking it returns to the bottom and re-pins; the end of the reply
    // stays in view.
    await toBottom.click();
    await expect
      .poll(async () => {
        return page.evaluate(() => {
          const el = document.querySelector('.chat-viewport') as HTMLElement;
          return el.scrollHeight - el.scrollTop - el.clientHeight;
        });
      }, { timeout: 5_000 })
      .toBeLessThanOrEqual(2);

    // After the stream finishes, stick-to-bottom is still healthy.
    await waitForStreamEnd(page);
    await readMonitor(page); // stop the monitor
    await expect
      .poll(async () => {
        return page.evaluate(() => {
          const el = document.querySelector('.chat-viewport') as HTMLElement;
          return el.scrollHeight - el.scrollTop - el.clientHeight;
        });
      })
      .toBeLessThanOrEqual(2);
    await expect(page.getByTitle(/Scroll to bottom/)).toHaveCount(0);
  });
});
