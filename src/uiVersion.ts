/**
 * Single source of truth for the frontend UI release.
 *
 * Imported by BOTH:
 *   1. The React app (Sidebar footer, Settings → About) and
 *   2. worker/index.ts (X-UI-Version header, /api/ui-version, /api/health)
 *
 * រាល់ការផ្លាស់ប្ដូរ UI ត្រូវតែបច្ចុប្បន្នភាពទីនេះ ហើយ worker/index.ts នឹងបញ្ចូល
 * (bundle) ការផ្លាស់ប្ដូរទាំងអស់តាមរយៈ `npm run build` (dist/ → Worker assets)។
 * Bump UI_VERSION on every UI change so each deploy is verifiable end-to-end:
 * the version shown in the app must match the version reported by the Worker.
 */
export const UI_VERSION = '3.3.0';
export const UI_THEME = 'aurora-gradient';
export const UI_BUILD_DATE = '2026-09-13';
