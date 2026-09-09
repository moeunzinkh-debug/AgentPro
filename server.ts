import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { handleChatRequest, handleChatStreamRequest, handleFetchModels, parseApiErrorMessage } from './src/server/apiRouter.ts';
import { UI_BUILD_DATE, UI_THEME, UI_VERSION } from './src/uiVersion.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

app.use(express.json({ limit: '20mb' }));

app.post('/api/chat', async (req, res) => {
  const isStream = req.query.stream === 'true' || req.body.stream === true;

  if (isStream) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    try {
      await handleChatStreamRequest(req.body, (chunk) => {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      });
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err: any) {
      const cleanMsg = parseApiErrorMessage(err);
      console.error('Chat streaming error:', cleanMsg);
      res.write(`data: ${JSON.stringify({ error: cleanMsg })}\n\n`);
      res.end();
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
