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
| `npm start` | Serve production build via Express (Node) |
| `npm run lint` | Type-check with `tsc --noEmit` |

## UI regression tests

```bash
npx playwright install --with-deps chromium  # one-time browser setup
npm run test:e2e
```

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
