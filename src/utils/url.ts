/**
 * URL helpers shared across client, server and worker code.
 */

/**
 * Normalize a user-provided API base URL and repair common typos, so a small
 * mistake while typing the endpoint never breaks chat requests.
 *
 * Repairs handled:
 *   - "ttps://host"      -> "https://host"   (missing leading "h")
 *   - "ttp://host"       -> "http://host"    (missing leading "h")
 *   - "http//host"       -> "http://host"    (missing colon)
 *   - "https//host"      -> "https://host"   (missing colon)
 *   - "HTTPS://host"     -> "https://host"   (scheme lowercased)
 *
 * Anything else (custom schemes, localhost, IPs, paths) is preserved as-is.
 *
 * @param raw    The raw base URL string (may be empty/null).
 * @param fallback Value to return when `raw` is empty (defaults to '').
 */
export function normalizeBaseUrl(raw: string | null | undefined, fallback: string = ''): string {
  if (!raw || typeof raw !== 'string') return fallback;
  let url = raw.trim();
  if (!url) return fallback;

  // Repair missing leading "h" in the scheme (ttps://, ttp://)
  if (/^ttps?:\/\//i.test(url)) {
    url = 'h' + url;
  }

  // Repair missing colon after the scheme (http//, https//)
  url = url.replace(/^(https?)\/\//i, '$1://');

  // Lowercase the scheme (HTTPS://, Http:// ...)
  url = url.replace(/^(https?):\/\//i, (m) => m.toLowerCase());

  return url;
}
