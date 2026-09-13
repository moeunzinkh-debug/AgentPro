# Agent Pro

Multi-provider AI Chat & Agent platform integrating Hugging Face, xKiro (Moonshot/Kimi), OpenRouter, Gemini, NVIDIA NIM, and custom APIs — with dynamic model discovery, free-tier filtering, and customizable parameters.

Built with React 19 + Vite + Tailwind CSS 4. The frontend talks to same-origin `/api/*` endpoints; the API layer is platform-agnostic and runs on Node (Express) **or** Cloudflare Workers.

## Local development (Vite dev server)

```bash
npm install
cp .env.example .env      # optional: set GEMINI_API_KEY for server-side calls
npm run dev               # http://localhost:3000 (API handled by Vite middleware)
```

## Build

```bash
npm run build             # outputs static site to dist/
```

## Run on Node (Express)

```bash
npm run build
npm start                 # serves dist/ + /api/* on http://0.0.0.0:3000
```

## Deploy to Cloudflare Workers

The app ships with a Cloudflare Worker entry (`worker/index.ts`) and Wrangler config (`wrangler.jsonc`). One Worker serves both the API (`/api/chat` with SSE streaming, `/api/models`) and the static frontend with SPA fallback.

Wrangler is configured to run `npm run build` automatically before `wrangler dev` and `wrangler deploy`, so the latest UI/app changes are always bundled into the Worker’s static assets instead of only updating the Worker script.

### 1. Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (the Workers free tier is enough — the chat calls are I/O-bound, not CPU-bound)
- Node.js 18+

### 2. Build and deploy

```bash
npm install
npm run deploy            # Wrangler auto-runs vite build first
```

The first `wrangler deploy` prompts you to log in (`wrangler login`) or you can set a `CLOUDFLARE_API_TOKEN` env var for CI. After deploying, the app is live at `https://agentpro.<your-subdomain>.workers.dev`.

Deployment is handled directly through Cloudflare Workers, not GitHub Actions. No GitHub Actions workflow or repository secrets are required. Use `npm run deploy` above to deploy with Wrangler.

### 3. Secrets (optional)

Provider API keys are optional — users can enter keys per-provider in the app's **Models → Configure API** tab. To provide server-side fallback keys instead, set them as Worker secrets:

```bash
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put OPENROUTER_API_KEY   # optional
npx wrangler secret put XKIRO_API_KEY        # optional
# also supported: MOONSHOT_API_KEY, KIMI_API_KEY, NVIDIA_API_KEY,
# DEEPSEEK_API_KEY, GROK_API_KEY, XAI_API_KEY, OPENAI_API_KEY,
# HUGGINGFACE_API_KEY, HF_TOKEN
```

For local Worker development, copy `.dev.vars.example` to `.dev.vars` instead.

### 4. Test locally on the Workers runtime

```bash
npm run dev:worker         # Wrangler auto-runs vite build -> http://0.0.0.0:8787
```

### Custom domain (optional)

In the Cloudflare dashboard: **Workers & Pages → agentpro → Settings → Domains & Routes → Add → Custom domain**.

## Project structure

```
index.html               # Vite entry
src/                     # React frontend (components, services, types)
src/server/apiRouter.ts  # Provider-agnostic API logic (Node + Workers)
worker/index.ts          # Cloudflare Worker entry (API + static assets)
server.ts                # Express server entry (Node)
vite.config.ts           # Vite config + API middleware for dev
wrangler.jsonc           # Cloudflare Workers config
```

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Vite dev server with API middleware (port 3000) |
| `npm run dev:worker` | Run the Cloudflare Worker locally on `0.0.0.0:8787`; Wrangler auto-builds the frontend first |
| `npm run build` | Build the frontend to `dist/` |
| `npm run deploy` | Deploy to Cloudflare Workers; Wrangler auto-builds the frontend first |
| `npm start` | Serve production build via Express (Node); honors `PORT` (default 3000) |
| `npm run lint` | Type-check with `tsc --noEmit` |
| `npm run test:streaming` | Node-only streaming regression suite (server SSE + client stream painter) — no API keys, no browser |
| `npm run test:server` | Server half of the streaming suite (`handleChatStreamRequest`) |
| `npm run test:painter` | Client half of the streaming suite (`createStreamPainter`) |
| `npm run test:dom` | Renders the real `<App/>` in jsdom and asserts the reply paints progressively (no browser download needed) |
| `npm run diag:gemini-latency` | Reproduce/measure Gemini time-to-first-token against a real or mock upstream |

## Gradient UI & Worker sync

The UI is an aurora-gradient theme (animated mesh background, gradient chat
bubbles, gradient sidebar/headers/buttons) defined in `src/index.css` and
applied across Chat, Tasks, Models, Settings, History, and all modals.
It uses opaque gradients only — never `backdrop-filter` (see tests).

**រាល់ការផ្លាស់ប្ដូរ UI ត្រូវតែបញ្ចូលទៅក្នុង `worker/index.ts`:** every UI change
flows into the Worker because Wrangler runs `npm run build` before dev/deploy
and serves `dist/` as Worker static assets. The release marker in
`src/uiVersion.ts` (`UI_VERSION`) is shared by the app and the Worker:

- `GET /api/ui-version` → `{ uiVersion, uiTheme, uiBuild }`
- `GET /api/health` / `/api/status` → includes the same UI release info
- Every static-asset response carries an `X-UI-Version` header
- Settings → About shows an **UI Release × Worker Sync** card comparing the
  app bundle version with the serving Worker's version

Rule: bump `UI_VERSION` in `src/uiVersion.ts` on every UI change, then
`npm run deploy` so the new gradient bundle is included in the Worker.

## Streaming & Instant Mode (progressive replies)

Every reply — **including Instant Mode** — streams progressively from the first
token to the last. Instant Mode only disables the model's *thinking* phase so
the first visible token arrives after a single round trip; it never means
"generate the whole answer, then display it". Long documents/texts therefore
start showing immediately instead of wasting time behind a spinner.

Six root causes of the old "វាបង្កើតរួចរាល់ទាំងអស់ទើបបង្ហាញ" (generates
everything first, only then displays) symptom were fixed:

1. **Gemini thinking config** — the server hard-coded `thinkingLevel: LOW` for
   every model. Gemini 2.x rejects that field (400), so each request was sent
   twice, and the retry fell back to *dynamic* thinking whose thought-only
   chunks (`chunk.text === undefined`) were discarded — the UI stayed blank
   while the model thought, then painted the answer at once. `apiRouter.ts` now
   sends the right config per model (`buildGeminiConfigLadder`): 3.x →
   `thinkingLevel: minimal`, 2.5 → `thinkingBudget: 0` (pro: `128`), 2.0/1.5 →
   none (keeping the full `topP`/`temperature`). A rejected config retries the
   **same** model down a ladder — never cascading to a worse fallback — and
   streams thought chunks as `reasoning` when thinking is on.
2. **Client painting** — tokens were committed only from a
   `requestAnimationFrame` callback, which never fires in a hidden tab / dimmed
   phone / off-screen preview iframe, so the reply buffered and appeared in one
   jump. `src/services/streamPainter.ts` commits the first token immediately and
   schedules every later commit with rAF **and** a `setTimeout` watchdog, with an
   adaptive throttle as the reply grows.
3. **Blanket non-stream fallback** — the app used to regenerate on *any* stream
   error (a hidden second full generation). It now falls back to a single
   non-streaming request **only** on a transport failure
   (`ChatStreamFailedError`); a genuine model error is reported at once.
4. **SSE transport buffering** — `src/server/sse.ts` sets `X-Accel-Buffering: no`
   + `no-transform`, disables Nagle (`setNoDelay`), emits an opening `:ok`, and
   keeps the pipe hot with a 15s heartbeat, so proxies never hold tokens back.
5. **Non-SSE upstreams** — an endpoint that ignores `stream: true` now has its
   JSON answer delivered as one block **plus** a status note, instead of an empty
   bubble stuck on "is generating response…".
6. **Empty replies** — finalized as an error with a Retry path, never a stuck
   spinner.

"Stop response" (បញ្ឈប់ការឆ្លើយតប) forwards an `AbortSignal` all the way to the
upstream read, cancelling generation immediately.

## UI regression tests

```bash
npx playwright install --with-deps chromium  # one-time browser setup
npm run test:e2e
```

Streaming behaviour is covered without a browser download by
`npm run test:streaming` (Node logic: server SSE + client painter) and
`npm run test:dom` (the real `<App/>` in jsdom). `tests/streaming-instant-mode.spec.ts`
mirrors the same guarantees for the Playwright suite when a browser is available.

The suite checks Chat / Tasks / Models / Settings navigation, reachable workflow
controls, model selection, and viewport resizing at phone, tablet, and desktop
sizes. It requires no provider API keys. To use a preinstalled Chromium binary,
set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

On phones, navigation sits below the content and Tasks uses one scrolling column.
Desktop retains the collapsible sidebar and split workflow workspace. The app
uses dynamic viewport height to follow browser toolbar changes. The UI is
gradient-based and never uses backdrop blur filters (opaque gradient panels
instead of glassmorphism), so mobile browsers that repaint blur layers
incorrectly cannot show ghost panels or glitch bands. Keyboard
resizing tests emulate a smaller viewport; actual device/browser rendering should
also be checked after deployment.
