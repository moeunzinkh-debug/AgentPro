import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, Plugin} from 'vite';
import dotenv from 'dotenv';
import { handleChatRequest, handleChatStreamRequest, handleFetchModels, parseApiErrorMessage } from './src/server/apiRouter';

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
              res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
              res.setHeader('Cache-Control', 'no-cache, no-transform');
              res.setHeader('Connection', 'keep-alive');
              if (typeof (res as any).flushHeaders === 'function') {
                (res as any).flushHeaders();
              }

              try {
                await handleChatStreamRequest(body, (chunk) => {
                  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                });
                res.write('data: [DONE]\n\n');
                res.end();
              } catch (err: any) {
                const cleanMsg = parseApiErrorMessage(err);
                console.error('Streaming error in vite middleware:', cleanMsg);
                res.write(`data: ${JSON.stringify({ error: cleanMsg })}\n\n`);
                res.end();
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
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
