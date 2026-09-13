import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { handleChatRequest, handleChatStreamRequest, handleFetchModels, parseApiErrorMessage } from './src/server/apiRouter.ts';
import { createSseWriter } from './src/server/sse.ts';
import { UI_BUILD_DATE, UI_THEME, UI_VERSION } from './src/uiVersion.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// PORT env override so the preview host can pick the port; defaults to 3000.
const port = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '20mb' }));

app.post('/api/chat', async (req, res) => {
  const isStream = req.query.stream === 'true' || req.body.stream === true;

  if (isStream) {
    // createSseWriter sets the anti-buffering headers (X-Accel-Buffering: no,
    // no-transform), disables Nagle, opens the stream immediately and keeps it
    // hot with a heartbeat — so every token reaches the browser the instant it
    // is produced instead of being buffered and dumped at the end.
    const sse = createSseWriter(res);

    // Forward the client disconnect (Stop / navigate away) to the upstream
    // generation so we never keep generating tokens nobody will read.
    const abortController = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) abortController.abort();
    });

    try {
      await handleChatStreamRequest(
        req.body,
        (chunk) => sse.write(chunk),
        abortController.signal
      );
      sse.end();
    } catch (err: any) {
      if (abortController.signal.aborted || sse.isClosed()) {
        return; // client went away — nothing to report
      }
      const cleanMsg = parseApiErrorMessage(err);
      console.error('Chat streaming error:', cleanMsg);
      sse.write({ error: cleanMsg });
      sse.end();
    }
  } else {
    try {
      const result = await handleChatRequest(req.body);
      res.json(result);
    } catch (err: any) {
      const cleanMsg = parseApiErrorMessage(err);
      res.status(500).json({ error: cleanMsg });
    }
  }
});

app.post('/api/models', async (req, res) => {
  try {
    const { provider, apiKey, baseUrl } = req.body;
    const models = await handleFetchModels(provider, apiKey, baseUrl);
    res.json({ models });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to fetch models' });
  }
});

// Serve Vite build in dist
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Agent Pro server running on http://0.0.0.0:${port}`);
});
