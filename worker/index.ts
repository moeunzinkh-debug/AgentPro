/**
 * Cloudflare Worker entry for Agent Pro.
 *
 * Serves the built Vite app (via Workers Static Assets, SPA fallback included)
 * and proxies the API endpoints to the platform-agnostic handlers
 * used by the Express server and the Vite dev middleware:
 *
 *   POST /api/chat        -> handleChatRequest / handleChatStreamRequest (SSE)
 *   POST /api/models      -> handleFetchModels
 *   GET  /api/health      -> health & status check (includes UI version)
 *   GET  /api/status      -> health & status check (includes UI version)
 *   GET  /api/ui-version  -> UI release bundled into this Worker
 *   OPTIONS /api/*        -> CORS preflight handler
 *
 * All other requests fall through to `env.ASSETS` (the `dist/` build output
 * configured in wrangler.jsonc, with `not_found_handling: "single-page-application"`
 * so client-side routes work on hard refresh).
 *
 * ---------------------------------------------------------------------------
 * រាល់ការផ្លាស់ប្ដូរ UI ត្រូវតែបញ្ចូលទៅក្នុង worker/index.ts
 * (Every UI change MUST be included in worker/index.ts)
 * ---------------------------------------------------------------------------
 * How UI changes flow into this Worker:
 *   1. All UI code lives under src/ + index.html (React + aurora gradient CSS).
 *   2. wrangler.jsonc declares `"build": { "command": "npm run build" }`, so
 *      every `wrangler dev` / `wrangler deploy` first runs `vite build` and the
 *      fresh UI bundle in dist/ becomes this Worker's static assets.
 *   3. The UI release marker (src/uiVersion.ts) is imported below and exposed
 *      via /api/ui-version, /api/health, and the X-UI-Version response header,
 *      so the app (Settings → About → UI Release card) can prove the deployed
 *      Worker serves the same gradient UI release as the source code.
 *   4. HTML / SPA-fallback responses are served with `must-revalidate` so a
 *      newly deployed gradient UI shows up immediately (no stale cached page),
 *      while hashed /assets/* files are cached immutably for speed.
 *
 * Rule: whenever you change ANY UI file, bump UI_VERSION in src/uiVersion.ts.
 * ---------------------------------------------------------------------------
 */
import {
  handleChatRequest,
  handleChatStreamRequest,
  handleFetchModels,
  parseApiErrorMessage,
} from '../src/server/apiRouter';
import { UI_BUILD_DATE, UI_THEME, UI_VERSION } from '../src/uiVersion';

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

/** UI release headers stamped on every static-asset response. */
function uiVersionHeaders(): Record<string, string> {
  return {
    'X-UI-Version': UI_VERSION,
    'X-UI-Theme': UI_THEME,
    'X-UI-Build': UI_BUILD_DATE,
  };
}

function uiReleaseInfo() {
  return {
    uiVersion: UI_VERSION,
    uiTheme: UI_THEME,
    uiBuild: UI_BUILD_DATE,
    // Proves the gradient UI bundle served here came from this Worker revision.
    bundledIn: 'worker/index.ts + dist/ static assets',
  };
}

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

    // Health & status endpoints (include the bundled UI release)
    if ((pathname === '/api/health' || pathname === '/api/status') && (request.method === 'GET' || request.method === 'HEAD')) {
      return jsonResponse({
        status: 'ok',
        service: 'Agent Pro',
        worker: 'cloudflare-worker',
        timestamp: new Date().toISOString(),
        ...uiReleaseInfo(),
      });
    }

    // UI release endpoint — lets the app verify the Worker serves the
    // same gradient UI release as the source (Settings → About card).
    if (pathname === '/api/ui-version' && (request.method === 'GET' || request.method === 'HEAD')) {
      return jsonResponse(uiReleaseInfo());
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

    // Everything else: static assets (the gradient UI bundle) with SPA fallback.
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      try {
        const assetRes = await env.ASSETS.fetch(request);
        return withUiReleaseHeaders(assetRes, pathname);
      } catch (err: any) {
        console.error('Static assets fetch error:', err);
        return new Response('Asset not found or worker error', { status: 500, headers: CORS_HEADERS });
      }
    }

    // Fallback if ASSETS binding is unavailable in testing environments.
    // Styled with the same aurora gradient as the app so the Worker page
    // never shows an unstyled screen.
    return new Response(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Agent Pro v${UI_VERSION}</title></head><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:Inter,system-ui,sans-serif;color:#ede9fe;background-color:#05060f;background-image:radial-gradient(52rem 30rem at 12% -8%, rgba(124,58,237,.38) 0%, transparent 60%),radial-gradient(46rem 28rem at 88% -4%, rgba(34,211,238,.30) 0%, transparent 60%),radial-gradient(40rem 30rem at 50% 110%, rgba(217,70,239,.24) 0%, transparent 62%),linear-gradient(180deg,#0c0a20 0%,#070616 52%,#04040c 100%);"><main style="text-align:center;padding:2.5rem;max-width:34rem;border-radius:1.25rem;border:1px solid rgba(139,92,246,.4);background:linear-gradient(160deg,#1c1545 0%,#101a3a 50%,#0a0d1e 100%);box-shadow:0 0 40px rgba(139,92,246,.3);"><div style="font-size:.75rem;letter-spacing:.2em;color:#a78bfa;font-weight:700;">AGENT PRO · UI v${UI_VERSION} · ${UI_THEME}</div><h1 style="margin:.75rem 0;font-size:1.75rem;background:linear-gradient(100deg,#67e8f9,#a78bfa,#f0abfc);-webkit-background-clip:text;background-clip:text;color:transparent;">Cloudflare Worker is running</h1><p style="color:rgba(237,233,254,.7);font-size:.875rem;line-height:1.6;">Static assets binding is not configured.<br>Run <code style="color:#67e8f9;">npm run build</code> first so the gradient UI bundle is included in this Worker.</p></main></body></html>`,
      {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          ...CORS_HEADERS,
          ...uiVersionHeaders(),
        },
      }
    );
  },
} satisfies { fetch: (request: Request, env: Env) => Promise<Response> };

/**
 * Stamps the served UI bundle with its release version and applies
 * cache rules so gradient-UI deploys show up immediately:
 * - index.html / extensionless SPA routes → must-revalidate (always fresh)
 * - hashed /assets/* (JS/CSS with content hashes) → immutable, 1 year
 */
function withUiReleaseHeaders(assetRes: Response, pathname: string): Response {
  const headers = new Headers(assetRes.headers);
  const uiHeaders = uiVersionHeaders();
  for (const [key, value] of Object.entries(uiHeaders)) {
    headers.set(key, value);
  }
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    if (!headers.has(key)) headers.set(key, value);
  }

  const isHtmlNavigation =
    pathname === '/' ||
    pathname.endsWith('.html') ||
    !pathname.includes('.') ||
    pathname.endsWith('/');
  const isHashedAsset =
    pathname.startsWith('/assets/') && /\.[a-f0-9]{6,}\.[a-z0-9]+$/i.test(pathname);

  if (isHashedAsset) {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (isHtmlNavigation) {
    // Never serve a stale app shell: a new gradient UI deploy must
    // appear on the very next load, not after cache expiry.
    headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  }

  return new Response(assetRes.body, {
    status: assetRes.status,
    statusText: assetRes.statusText,
    headers,
  });
}

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
