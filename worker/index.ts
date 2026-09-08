/**
 * Cloudflare Worker entry for Agent Pro.
 *
 * Serves the built Vite app (via Workers Static Assets, SPA fallback included)
 * and proxies the two API endpoints to the same platform-agnostic handlers
 * used by the Express server and the Vite dev middleware:
 *
 *   POST /api/chat    -> handleChatRequest / handleChatStreamRequest (SSE)
 *   POST /api/models  -> handleFetchModels
 *
 * All other requests fall through to `env.ASSETS` (the `dist/` build output
 * configured in wrangler.jsonc, with `not_found_handling: "single-page-application"`
 * so client-side routes work on hard refresh).
 */
import {
  handleChatRequest,
  handleChatStreamRequest,
  handleFetchModels,
  parseApiErrorMessage,
} from '../src/server/apiRouter';

interface Env {
  /** Static assets binding (see `assets.binding` in wrangler.jsonc). */
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  /** Vars + secrets (GEMINI_API_KEY, OPENROUTER_API_KEY, ...). */
  [key: string]: unknown;
}

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Make Worker vars/secrets visible to the shared server code, which reads
    // provider keys from process.env. With compatibility dates >= 2025-04-01
    // the runtime auto-populates process.env, so this is a safe idempotent
    // fallback that also covers older compatibility dates.
    syncProcessEnv(env);

    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === '/api/chat' && request.method === 'POST') {
      return handleChat(request, url);
    }

    if (pathname === '/api/models' && request.method === 'POST') {
      return handleModels(request);
    }

    if (pathname.startsWith('/api/')) {
      return jsonResponse({ error: 'Not found' }, 404);
    }

    // Everything else: static assets with SPA fallback.
    return env.ASSETS.fetch(request);
  },
} satisfies { fetch: (request: Request, env: Env) => Promise<Response> };

/**
 * Copies string bindings (vars/secrets) from the request env onto process.env
 * so shared, platform-agnostic server code keeps working on Workers.
 * Values already present are never overwritten.
 */
function syncProcessEnv(env: Env): void {
  const proc = (globalThis as any).process;
  if (!proc?.env) return;
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && proc.env[key] === undefined) {
      try {
        proc.env[key] = value;
      } catch {
        // Read-only process.env on some runtimes; auto-population covers it.
      }
    }
  }
}

async function handleChat(request: Request, url: URL): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const isStream = url.searchParams.get('stream') === 'true' || body.stream === true;

  if (isStream) {
    return streamChatResponse(body);
  }

  try {
    const result = await handleChatRequest(body);
    return jsonResponse(result);
  } catch (err: any) {
    console.error('Chat error:', parseApiErrorMessage(err));
    return jsonResponse({ error: parseApiErrorMessage(err) }, 500);
  }
}

function streamChatResponse(body: any): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      try {
        await handleChatStreamRequest(body, send);
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch (err: any) {
        const cleanMsg = parseApiErrorMessage(err);
        console.error('Chat streaming error:', cleanMsg);
        send({ error: cleanMsg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}

async function handleModels(request: Request): Promise<Response> {
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  try {
    const models = await handleFetchModels(body.provider, body.apiKey, body.baseUrl);
    return jsonResponse({ models });
  } catch (err: any) {
    return jsonResponse({ error: err?.message || 'Failed to fetch models' }, 500);
  }
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}
