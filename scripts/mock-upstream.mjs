/**
 * Mock OpenAI-compatible upstream used to verify that Agent Pro's own SSE
 * pipeline forwards tokens incrementally instead of buffering the whole reply.
 *
 * Emits `chunks` SSE deltas, one every `delayMs`, then `[DONE]`.
 *
 *   PORT=9911 CHUNKS=25 DELAY_MS=80 node scripts/mock-upstream.mjs
 *
 * Set NON_SSE=1 to emulate an endpoint that ignores `stream: true` and returns
 * one complete JSON body instead (used to prove the app still answers).
 */
import http from 'node:http';

const PORT = Number(process.env.PORT || 9911);
const CHUNKS = Number(process.env.CHUNKS || 25);
const DELAY_MS = Number(process.env.DELAY_MS || 80);
const NON_SSE = process.env.NON_SSE === '1';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;

  console.log(`[mock-upstream] ${req.method} ${req.url} streamRequested=${/stream/i.test(body)}`);

  if (req.url.endsWith('/chat/completions')) {
    if (NON_SSE) {
      const text = Array.from({ length: CHUNKS }, (_, i) => `Chunk ${i + 1}. `).join('');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'mock',
          model: 'mock-model',
          choices: [{ message: { role: 'assistant', content: text } }],
          usage: { total_tokens: CHUNKS },
        })
      );
      return;
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });
    res.flushHeaders?.();

    for (let i = 0; i < CHUNKS; i++) {
      const payload = {
        id: 'mock',
        model: 'mock-model',
        choices: [{ delta: { content: `Chunk ${i + 1} បន្ទាប់។ ` }, index: 0 }],
      };
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
      await sleep(DELAY_MS);
    }
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    `[mock-upstream] listening on 0.0.0.0:${PORT} chunks=${CHUNKS} delay=${DELAY_MS}ms nonSSE=${NON_SSE}`
  );
});
