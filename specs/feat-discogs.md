# discogs.ts — Discogs API Lookup

**Status:** Approved  
**Date:** 2026-04-16

## Overview

`discogs.ts` queries the Discogs database search API to resolve a track's genre category when ID3 tags and BPM detection are inconclusive. Returns a `Category` string or `null`.

## Goals

- `lookupDiscogs(artist, title, token): Promise<Category | null>`
- Throttle: 1 req/sec (`DISCOGS_THROTTLE_MS`)
- On 429: wait `DISCOGS_RETRY_WAIT_MS`, retry once, then return `null`
- No token → return `null` immediately (no API call)
- Map Discogs `styles[]` → `Category` via `DISCOGS_STYLE_MAP` (case-insensitive)
- Token never logged, never cached, never in any string interpolation outside the Authorization header

## Non-Goals

- Pagination
- Release details beyond `style` field
- Caching (handled by `cache.ts` — `discogs.ts` is stateless)

## API

```typescript
export async function lookupDiscogs(
  artist: string,
  title: string,
  token: string | undefined,
): Promise<Category | null>;
```

## HTTP call

```
GET https://api.discogs.com/database/search
  ?artist=<encoded>&track=<encoded>&type=release&per_page=1
Authorization: Discogs token=<token>
User-Agent: dj-sort/1.0 +https://github.com/YOUR_USERNAME/dj-sort
```

Use Node's built-in `https` module — no `fetch`, no `axios`. Avoids ESM issues.

## Throttle implementation

Module-level `lastRequestAt: number = 0`. Before each request:
```typescript
const elapsed = Date.now() - lastRequestAt;
if (elapsed < DISCOGS_THROTTLE_MS) {
  await sleep(DISCOGS_THROTTLE_MS - elapsed);
}
lastRequestAt = Date.now();
```

## Response parsing

```typescript
interface DiscogsSearchResult {
  results: Array<{ style?: string[] }>;
}
// Parse JSON, take results[0].style[], map each via DISCOGS_STYLE_MAP (toLowerCase on key)
// Return first match, or null if no match
```

## Security requirements (enforced, auditor will verify)

1. Token only appears in the `Authorization` header — never in URL, logs, error messages, or cache
2. `logger.debug` calls near the API call must not include the token
3. On error, log the URL (without token) or just the status code — never the full request headers

## Error handling

- No token → `return null` (log info once)
- Network error → log debug (no token in message) → `return null`
- Non-200 / non-429 → log debug (status code only) → `return null`
- 429 → `await sleep(DISCOGS_RETRY_WAIT_MS)` → retry once → `return null` on second failure
- JSON parse error → `return null`

## Implementation sketch

```typescript
import * as https from 'https';
import { Category, DISCOGS_STYLE_MAP, DISCOGS_THROTTLE_MS, DISCOGS_RETRY_WAIT_MS } from './categories';
import { logger } from './logger';

let lastRequestAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function httpsGet(url: string, token: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        Authorization: `Discogs token=${token}`,
        'User-Agent': 'dj-sort/1.0 +https://github.com/YOUR_USERNAME/dj-sort',
      },
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function doRequest(url: string, token: string): Promise<{ status: number; body: string } | null> {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < DISCOGS_THROTTLE_MS) await sleep(DISCOGS_THROTTLE_MS - elapsed);
  lastRequestAt = Date.now();
  try {
    return await httpsGet(url, token);
  } catch (err) {
    logger.debug(`Discogs request failed: ${String(err)}`); // no token in err
    return null;
  }
}

export async function lookupDiscogs(
  artist: string,
  title: string,
  token: string | undefined,
): Promise<Category | null> {
  if (!token) return null;

  const url = `https://api.discogs.com/database/search?artist=${
    encodeURIComponent(artist)}&track=${encodeURIComponent(title)}&type=release&per_page=1`;

  let response = await doRequest(url, token);

  if (response?.status === 429) {
    logger.debug('Discogs 429 — waiting and retrying');
    await sleep(DISCOGS_RETRY_WAIT_MS);
    response = await doRequest(url, token);
  }

  if (!response || response.status !== 200) {
    if (response) logger.debug(`Discogs returned status ${response.status}`);
    return null;
  }

  try {
    const data = JSON.parse(response.body) as { results?: Array<{ style?: string[] }> };
    const styles = data.results?.[0]?.style ?? [];
    for (const style of styles) {
      const category = DISCOGS_STYLE_MAP[style] ??
        DISCOGS_STYLE_MAP[style.toLowerCase()] ?? null;  // case-insensitive fallback
      if (category) return category;
    }
  } catch {
    logger.debug('Discogs JSON parse error');
  }

  return null;
}
```
