/**
 * DOM test runner — renders the real React app inside jsdom.
 *
 *   npm run test:dom
 *
 * Why: the Playwright suite needs a Chromium download, which is blocked in some
 * sandboxes/CI runners. This harness needs only npm packages, so the streaming
 * behaviour of the REAL components (App → ChatView → MarkdownView, apiClient,
 * streamPainter) can be verified anywhere.
 *
 * It bundles tests-dom/streaming.tsx with esbuild, installs jsdom globals, then
 * runs the visible-page suite and a second pass with requestAnimationFrame
 * frozen + document hidden (the conditions that used to buffer the whole reply).
 */
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// 1. jsdom environment (installed BEFORE the app bundle is imported)
// ---------------------------------------------------------------------------
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost:3000/',
  pretendToBeVisual: true, // provides requestAnimationFrame
  runScripts: 'outside-only',
});

const { window } = dom;

// Browser APIs the app touches that jsdom does not implement.
window.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
window.matchMedia =
  window.matchMedia ||
  ((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  }));
window.scrollTo = () => {};
window.Element.prototype.scrollTo = function scrollTo() {};
window.Element.prototype.scrollIntoView = function scrollIntoView() {};
Object.defineProperty(window.navigator, 'clipboard', {
  configurable: true,
  value: { writeText: async () => {} },
});

const globals = [
  'window',
  'document',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
  'HTMLElement',
  'HTMLTextAreaElement',
  'HTMLInputElement',
  'Element',
  'Node',
  'Event',
  'CustomEvent',
  'MouseEvent',
  'KeyboardEvent',
  'ResizeObserver',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
  'DOMParser',
  'XMLHttpRequest',
];
for (const key of globals) {
  if (window[key] === undefined) continue;
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: window[key],
  });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = false;
globalThis.MessageChannel ??= (await import('node:worker_threads')).MessageChannel;

// ---------------------------------------------------------------------------
// 2. Bundle the test entry (TSX -> ESM)
// ---------------------------------------------------------------------------
const outfile = path.join(fs.realpathSync(os.tmpdir()), `agentpro-dom-tests-${process.pid}.mjs`);

await build({
  entryPoints: [path.join(repoRoot, 'tests-dom/streaming.tsx')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  sourcemap: 'inline',
  logLevel: 'warning',
  // Production React: the dev build re-renders ~3x slower inside jsdom, which
  // starved the fake stream on a busy machine and made the timing checks flaky.
  define: { 'process.env.NODE_ENV': '"production"' },
  absWorkingDir: repoRoot,
});

const mod = await import(outfile);

// ---------------------------------------------------------------------------
// 3. Run: normal frames, then frozen frames (hidden page)
// ---------------------------------------------------------------------------
try {
  // Warm up React/jsdom/JIT so the first measured scenario is not the cold one.
  await mod.warmUp();

  await mod.runDomTests();

  // Freeze animation frames + hide the document: the exact situation in which
  // the old rAF-only scheduler buffered the entire reply.
  window.requestAnimationFrame = () => 0;
  window.cancelAnimationFrame = () => {};
  globalThis.requestAnimationFrame = window.requestAnimationFrame;
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame;
  Object.defineProperty(window.document, 'visibilityState', {
    configurable: true,
    get: () => 'hidden',
  });
  Object.defineProperty(window.document, 'hidden', { configurable: true, get: () => true });

  await mod.runPausedFrameTests();
} finally {
  try {
    fs.unlinkSync(outfile);
  } catch {}
}

process.exit(mod.summarize());
