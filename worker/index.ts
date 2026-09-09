/**
 * Cloudflare Worker entry for Agent Pro.
 *
 * Serves the built Vite app (via Workers Static Assets, SPA fallback included)
 * and proxies the API endpoints to the platform-agnostic handlers
 * used by the Express server and the Vite dev middleware:
 *
 *   POST /api/chat    -> handleChatRequest / handleChatStreamRequest (SSE)
 *   POST /api/models  -> handleFetchModels
 *   GET  /api/health  -> health & status check
 *   GET  /api/status  -> health & status check
 *   OPTIONS /api/*    -> CORS preflight handler
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
  ASSETS?: { fetch: (request: Request) => Promise<Response> };
  /** Vars + secrets (GEMINI_API_KEY, OPENROUTER_API_KEY, ...). */
  [key: string]: unknown;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Access-Control-Max-Age': '86400',
};

const JSON_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  ...CORS_HEADERS,
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

    // Handle CORS preflight for all /api/* routes
    if (request.method === 'OPTIONS' && pathname.startsWith('/api/')) {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    // Health & status endpoints
    if ((pathname === '/api/health' || pathname === '/api/status') && (request.method === 'GET' || request.method === 'HEAD')) {
      return jsonResponse({
        status: 'ok',
        service: 'Agent Pro',
        worker: 'cloudflare-worker',
        timestamp: new Date().toISOString(),
      });
    }

    // Chat API
    if (pathname === '/api/chat' && request.method === 'POST') {
      return handleChat(request, url);
    }

    // Models discovery API
    if (pathname === '/api/models' && request.method === 'POST') {
      return handleModels(request);
    }

    // Unmatched /api/* route
    if (pathname.startsWith('/api/')) {
      return jsonResponse({ error: 'Endpoint not found' }, 404);
    }

    // Everything else: static assets with SPA fallback (dist/ directory)
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      try {
        return await env.ASSETS.fetch(request);
      } catch (err: any) {
        console.error('Static assets fetch error:', err);
        return new Response('Asset not found or worker error', { status: 500, headers: CORS_HEADERS });
      }
    }

    // Fallback if ASSETS binding is unavailable in testing environments
    return new Response(
      `<!doctype html><html><head><meta charset="utf-8"><title>Agent Pro</title></head><body style="background:#050507;color:#00f2ff;font-family:sans-serif;padding:2rem;"><h1>Agent Pro Cloudflare Worker</h1><p>Static assets binding is not configured. Run <code>npm run build</code> first.</p></body></html>`,
      {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          ...CORS_HEADERS,
        },
      }
    );
  },
} satisfies { fetch: (request: Request, env: Env) => Promise<Response> };

/**
 * Copies string bindings (vars/secrets) from the request env onto process.env
 * so shared, platform-agnostic server code keeps working on Workers.
 * Values already present are never overwritten.
 */
function syncProcessEnv(env: Env): void {
  const globalAny = globalThis as any;
  if (!globalAny.process) {
    globalAny.process = { env: {} };
  } else if (!globalAny.process.env) {
    globalAny.process.env = {};
  }

  const proc = globalAny.process;
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && (proc.env[key] === undefined || proc.env[key] === '')) {
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
    const cleanMsg = parseApiErrorMessage(err);
    console.error('Chat error:', cleanMsg);
    return jsonResponse({ error: cleanMsg }, 500);
  }
}

function streamChatResponse(body: any): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          // Stream might be cancelled or closed by the client
        }
      };

      try {
        await handleChatStreamRequest(body, send);
        try {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        } catch {}
      } catch (err: any) {
        const cleanMsg = parseApiErrorMessage(err);
        console.error('Chat streaming error:', cleanMsg);
        send({ error: cleanMsg });
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      ...CORS_HEADERS,
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
