import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, Plugin} from 'vite';
import dotenv from 'dotenv';
import { handleChatRequest, handleChatStreamRequest, handleFetchModels, parseApiErrorMessage } from './src/server/apiRouter';
import { createSseWriter } from './src/server/sse';
import { UI_BUILD_DATE, UI_THEME, UI_VERSION } from './src/uiVersion';

dotenv.config();

function apiServerPlugin(): Plugin {
  return {
    name: 'api-server-middleware',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const [pathname, queryString] = (req.url || '').split('?');
        const isStreamQuery = queryString?.includes('stream=true');

        if (pathname === '/api/chat' && req.method === 'POST') {
          let bodyStr = '';
          req.on('data', (chunk) => {
            bodyStr += chunk;
          });
          req.on('end', async () => {
            let body: any = {};
            try {
              body = JSON.parse(bodyStr || '{}');
            } catch {
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Invalid JSON body' }));
              return;
            }

            const streamRequested = isStreamQuery || body.stream === true;
            if (streamRequested) {
              // createSseWriter sets the anti-buffering headers, disables Nagle,
              // opens the stream immediately and keeps it hot with a heartbeat,
              // so every token reaches the browser the instant it is produced.
              const sse = createSseWriter(res as any);

              // Forward client disconnect (Stop / navigate away) upstream so we
              // never keep generating tokens nobody will read.
              const abortController = new AbortController();
              res.on('close', () => {
                if (!res.writableEnded) abortController.abort();
              });

              try {
                await handleChatStreamRequest(
                  body,
                  (chunk) => sse.write(chunk),
                  abortController.signal
                );
                sse.end();
              } catch (err: any) {
                if (abortController.signal.aborted || sse.isClosed()) {
                  return; // client went away — nothing to report
                }
                const cleanMsg = parseApiErrorMessage(err);
                console.error('Streaming error in vite middleware:', cleanMsg);
                sse.write({ error: cleanMsg });
                sse.end();
              }
            } else {
              try {
                const result = await handleChatRequest(body);
                res.setHeader('Content-Type', 'application/json');
                res.statusCode = 200;
                res.end(JSON.stringify(result));
              } catch (err: any) {
                const cleanMsg = parseApiErrorMessage(err);
                res.setHeader('Content-Type', 'application/json');
                res.statusCode = 500;
                res.end(JSON.stringify({ error: cleanMsg }));
              }
            }
          });
          return;
        }

        // UI release endpoint (mirrors worker/index.ts) — lets the app verify
        // the served gradient UI matches src/uiVersion.ts in every environment.
        if ((pathname === '/api/ui-version' || pathname === '/api/health' || pathname === '/api/status') && req.method === 'GET') {
          const payload =
            pathname === '/api/ui-version'
              ? { uiVersion: UI_VERSION, uiTheme: UI_THEME, uiBuild: UI_BUILD_DATE, bundledIn: 'vite dev middleware' }
              : { status: 'ok', service: 'Agent Pro', worker: 'vite-dev', timestamp: new Date().toISOString(), uiVersion: UI_VERSION, uiTheme: UI_THEME, uiBuild: UI_BUILD_DATE };
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('X-UI-Version', UI_VERSION);
          res.statusCode = 200;
          res.end(JSON.stringify(payload));
          return;
        }

        if (pathname === '/api/models' && req.method === 'POST') {
          let bodyStr = '';
          req.on('data', (chunk) => {
            bodyStr += chunk;
          });
          req.on('end', async () => {
            try {
              const body = JSON.parse(bodyStr || '{}');
              const models = await handleFetchModels(body.provider, body.apiKey, body.baseUrl);
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 200;
              res.end(JSON.stringify({ models }));
            } catch (err: any) {
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err?.message || 'Failed to fetch models' }));
            }
          });
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), apiServerPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      allowedHosts: ['.e2b.app'],
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
