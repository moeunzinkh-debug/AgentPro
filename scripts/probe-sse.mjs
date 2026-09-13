/**
 * End-to-end SSE probe: sends one chat request to a running Agent Pro server
 * (Vite dev middleware / Express / Cloudflare Worker) and prints WHEN each SSE
 * event arrives, so buffering can be measured instead of guessed.
 *
 *   TARGET=http://127.0.0.1:3000 UPSTREAM=http://127.0.0.1:9911/v1 \
 *     node scripts/probe-sse.mjs
 *
 * Verdicts:
 *   STREAMING  -> events spread over the upstream generation time (good)
 *   BUFFERED   -> every event arrives in one burst at the end (bad)
 */
const TARGET = process.env.TARGET || 'http://127.0.0.1:3000';
const UPSTREAM = process.env.UPSTREAM || 'http://127.0.0.1:9911/v1';
const PROVIDER = process.env.PROVIDER || 'custom';

const t0 = Date.now();
const res = await fetch(`${TARGET}/api/chat?stream=true`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    provider: PROVIDER,
    model: 'mock-model',
    baseUrl: UPSTREAM,
    apiKey: 'mock-key',
    messages: [{ role: 'user', content: 'សរសេរអត្ថបទវែងមួយ' }],
    parameters: { temperature: 0.7, maxTokens: 4096, topP: 0.95 },
    instantMode: true,
    stream: true,
  }),
});

if (!res.ok) {
  console.error('HTTP', res.status, await res.text());
  process.exit(1);
}

console.log('content-type:', res.headers.get('content-type'));
console.log('x-accel-buffering:', res.headers.get('x-accel-buffering'));
console.log('headers received at +' + (Date.now() - t0) + 'ms');

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buf = '';
const arrivals = [];
let chars = 0;

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const at = Date.now() - t0;
  buf += decoder.decode(value, { stream: true });
  const lines = buf.split('\n');
  buf = lines.pop() ?? '';
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('data:')) continue;
    const data = t.replace(/^data:\s*/, '');
    if (data === '[DONE]') {
      arrivals.push({ at, note: '[DONE]' });
      continue;
    }
    try {
      const parsed = JSON.parse(data);
      chars += (parsed.content || '').length;
      arrivals.push({ at, chars, note: parsed.error ? `ERROR ${parsed.error}` : undefined });
    } catch {}
  }
}

const first = arrivals[0]?.at ?? null;
const last = arrivals[arrivals.length - 1]?.at ?? null;
console.log('\nevents:', arrivals.length, '| chars:', chars);
console.log('first event at +' + first + 'ms, last at +' + last + 'ms');
console.log('arrival spread:', arrivals.slice(0, 40).map((a) => `+${a.at}`).join(' '));

const distinctBursts = new Set(arrivals.map((a) => Math.floor(a.at / 100))).size;
if (arrivals.length < 3) {
  console.log('\nVERDICT: NO INCREMENTAL EVENTS (buffered, non-streaming upstream, or broken)');
  process.exit(2);
}
if (distinctBursts <= 2) {
  console.log('\nVERDICT: BUFFERED — everything arrived in one burst at the end');
  process.exit(3);
}
console.log(
  `\nVERDICT: STREAMING — ${distinctBursts} distinct arrival windows, first token at +${first}ms`
);
