import * as https from 'https';
import {
  Category,
  DISCOGS_STYLE_MAP,
  DISCOGS_THROTTLE_MS,
  DISCOGS_RETRY_WAIT_MS,
} from './categories';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// Module-level throttle state
// ---------------------------------------------------------------------------

let lastRequestAt = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Low-level HTTPS GET.  The token is placed ONLY in the Authorization header —
 * it is never interpolated into the URL, log messages, or error strings.
 */
function httpsGet(
  url: string,
  token: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          Authorization: `Discogs token=${token}`,
          'User-Agent': 'dj-sort/1.0 +https://github.com/YOUR_USERNAME/dj-sort',
        },
      },
      res => {
        let body = '';
        res.on('data', (chunk: Buffer | string) => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );

    req.setTimeout(10_000, () => {
      req.destroy();
      reject(new Error('timeout'));
    });

    req.on('error', reject);
  });
}

/**
 * Throttled wrapper around httpsGet.  Catches all network errors and returns
 * null so callers never receive a thrown exception.
 */
async function doRequest(
  url: string,
  token: string,
): Promise<{ status: number; body: string } | null> {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < DISCOGS_THROTTLE_MS) {
    await sleep(DISCOGS_THROTTLE_MS - elapsed);
  }
  lastRequestAt = Date.now();

  try {
    return await httpsGet(url, token);
  } catch (err) {
    // Use controlled extraction — never forward raw error which could serialize headers.
    const msg = err instanceof Error ? err.message : 'unknown error';
    logger.debug(`Discogs request failed: ${msg}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Style map with pre-built lowercase lookup for case-insensitive matching
// ---------------------------------------------------------------------------

const DISCOGS_STYLE_MAP_LOWER: Record<string, Category> = Object.fromEntries(
  Object.entries(DISCOGS_STYLE_MAP).map(([k, v]) => [k.toLowerCase(), v]),
);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Look up a track on Discogs and return the matching Category, or null when:
 *   - no token is provided
 *   - the network call fails
 *   - no recognised style is found in the first result
 *
 * Security contract: the token NEVER appears in logs, URLs, error strings, or
 * cached data.  It is used exclusively as the Authorization header value
 * inside httpsGet().
 */
export async function lookupDiscogs(
  artist: string,
  title: string,
  token: string | undefined,
): Promise<Category | null> {
  if (!token) {
    return null;
  }

  const url =
    `https://api.discogs.com/database/search` +
    `?artist=${encodeURIComponent(artist)}` +
    `&track=${encodeURIComponent(title)}` +
    `&type=release&per_page=1`;

  let response = await doRequest(url, token);

  if (response?.status === 429) {
    logger.debug('Discogs 429 — waiting and retrying once');
    await sleep(DISCOGS_RETRY_WAIT_MS);
    response = await doRequest(url, token);
  }

  if (!response) {
    return null;
  }

  if (response.status !== 200) {
    // Log the status code only — never headers, never the token.
    logger.debug(`Discogs returned HTTP ${response.status}`);
    return null;
  }

  try {
    const data = JSON.parse(response.body) as {
      results?: Array<{ style?: string[] }>;
    };
    const styles = data.results?.[0]?.style ?? [];

    for (const style of styles) {
      // Try exact key first, then case-insensitive fallback.
      const category =
        DISCOGS_STYLE_MAP[style] ??
        DISCOGS_STYLE_MAP_LOWER[style.toLowerCase()] ??
        null;
      if (category) return category;
    }
  } catch {
    logger.debug('Discogs JSON parse error');
  }

  return null;
}
