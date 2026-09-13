/**
 * Shared Server-Sent-Events writer for the Node runtimes (Express server +
 * Vite dev middleware).
 *
 * WHY THIS EXISTS
 * ---------------
 * A streamed reply only *looks* streamed if every token reaches the browser the
 * moment it is produced. Three things silently broke that and made long answers
 * appear all at once at the end:
 *
 *   1. Proxy buffering — nginx / cloud load balancers / preview proxies buffer
 *      `text/event-stream` bodies unless `X-Accel-Buffering: no` and
 *      `Cache-Control: no-transform` are set.
 *   2. Nagle's algorithm — small writes can be held back until a full TCP
 *      segment accumulates; `socket.setNoDelay(true)` disables that.
 *   3. Idle gaps — while a model thinks or a fallback is retried no bytes are
 *      written, and some proxies then buffer/close the response. A `:ping`
 *      comment every 15s keeps the pipe hot (SSE comment lines are ignored by
 *      the client parser).
 *
 * The writer also emits an opening `:ok` comment and calls `res.flush()` when a
 * compression middleware is present, so the very first byte leaves immediately.
 */
import type { ServerResponse } from 'node:http';

export interface SseWriter {
  /** Send one JSON payload as an SSE `data:` frame. */
  write: (payload: unknown) => void;
  /** Send the `[DONE]` sentinel and close the response (idempotent). */
  end: () => void;
  /** True once the response is finished or the client went away. */
  isClosed: () => boolean;
}

export const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  // Defeat nginx / ALB / preview-proxy response buffering.
  'X-Accel-Buffering': 'no',
};

/** Heartbeat period while the upstream model is silent. */
export const SSE_HEARTBEAT_MS = 15_000;

export function createSseWriter(res: ServerResponse): SseWriter {
  for (const [key, value] of Object.entries(SSE_HEADERS)) {
    res.setHeader(key, value);
  }

  // Push each token out immediately instead of coalescing small writes.
  try {
    (res as any).socket?.setNoDelay?.(true);
  } catch {}

  res.flushHeaders?.();

  const flush = () => {
    // `flush()` exists when compression middleware wraps the response.
    try {
      (res as any).flush?.();
    } catch {}
  };

  // Opening comment: the browser sees an open stream before the model replies.
  try {
    res.write(':ok\n\n');
    flush();
  } catch {}

  let closed = false;

  const heartbeat = setInterval(() => {
    if (closed) return;
    try {
      res.write(':ping\n\n');
      flush();
    } catch {
      closed = true;
    }
  }, SSE_HEARTBEAT_MS);
  // Never keep the Node event loop alive just for the heartbeat.
  (heartbeat as any).unref?.();

  const write = (payload: unknown) => {
    if (closed) return;
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
      flush();
    } catch {
      closed = true;
    }
  };

  const end = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    try {
      res.write('data: [DONE]\n\n');
      flush();
    } catch {}
    try {
      res.end();
    } catch {}
  };

  // Client navigated away / pressed Stop: stop writing and drop the heartbeat.
  res.on?.('close', () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
  });

  return { write, end, isClosed: () => closed };
}
