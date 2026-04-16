# cache.ts — JSON Cache (BPM + Discogs)

**Status:** Approved  
**Date:** 2026-04-16

## Overview

`cache.ts` loads and saves a JSON file (`.dj-sort-cache.json`) that persists two types of expensive results across runs: BPM analysis results (keyed by filepath+mtime) and Discogs lookups (keyed by artist|title, with 30-day TTL).

## Goals

- `loadCache(dir): void` — load from `<dir>/.dj-sort-cache.json` at startup; ignore missing file
- `saveCache(dir): void` — serialize and write (synchronous, for SIGINT handler safety)
- `getBpm(filepath, mtimeMs): number | null | undefined` — `undefined` = cache miss
- `setBpm(filepath, mtimeMs, bpm: number | null): void`
- `getDiscogs(artist, title): string | undefined` — `undefined` = miss or expired
- `setDiscogs(artist, title, category: string): void`
- Token never stored in cache

## Non-Goals

- Cross-process cache locking
- Compression
- BPM TTL (BPM is mtime-keyed — staleness is implicit)

## Cache schema

```typescript
interface BpmEntry   { bpm: number | null }
interface DiscogsEntry { category: string; cachedAt: number } // cachedAt = Date.now()

interface CacheFile {
  bpm:     Record<string, BpmEntry>;
  discogs: Record<string, DiscogsEntry>;
}
```

## Key formats

- BPM:     `"<absolute-filepath>|<mtime_ms>"`
- Discogs: `"<artist>|<title>"` (lowercased, trimmed)

## TTL

Discogs entries expire after `DISCOGS_CACHE_TTL_DAYS` days from `cachedAt`.

## Implementation sketch

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { DISCOGS_CACHE_TTL_DAYS } from './categories';
import { logger } from './logger';

const CACHE_FILENAME = '.dj-sort-cache.json';
const TTL_MS = DISCOGS_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

let cache: CacheFile = { bpm: {}, discogs: {} };
let cacheDir: string | undefined;

export function loadCache(dir: string): void {
  cacheDir = dir;
  const file = path.join(dir, CACHE_FILENAME);
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<CacheFile>;
    cache = { bpm: parsed.bpm ?? {}, discogs: parsed.discogs ?? {} };
    logger.debug(`Cache loaded: ${Object.keys(cache.bpm).length} bpm, ${Object.keys(cache.discogs).length} discogs entries`);
  } catch {
    cache = { bpm: {}, discogs: {} };
  }
}

export function saveCache(dir: string): void {
  const file = path.join(dir, CACHE_FILENAME);
  try {
    fs.writeFileSync(file, JSON.stringify(cache, null, 2), 'utf8');
  } catch (err) {
    logger.warn(`Could not save cache: ${String(err)}`);
  }
}

export function getBpm(filepath: string, mtimeMs: number): number | null | undefined {
  const entry = cache.bpm[`${filepath}|${mtimeMs}`];
  return entry ? entry.bpm : undefined;
}

export function setBpm(filepath: string, mtimeMs: number, bpm: number | null): void {
  cache.bpm[`${filepath}|${mtimeMs}`] = { bpm };
}

function discogsKey(artist: string, title: string): string {
  return `${artist.toLowerCase().trim()}|${title.toLowerCase().trim()}`;
}

export function getDiscogs(artist: string, title: string): string | undefined {
  const entry = cache.discogs[discogsKey(artist, title)];
  if (!entry) return undefined;
  if (Date.now() - entry.cachedAt > TTL_MS) return undefined;
  return entry.category;
}

export function setDiscogs(artist: string, title: string, category: string): void {
  cache.discogs[discogsKey(artist, title)] = { category, cachedAt: Date.now() };
}
```

## Security

- Cache file is written to source folder (user-controlled location)
- Token must never appear in any cache value — enforced by `discogs.ts` which only stores the resolved category string

## Testing Strategy

- `loadCache` on missing file → empty cache, no throw
- `loadCache` on corrupted JSON → empty cache, no throw
- `setBpm` + `getBpm` with same key → hit
- `getBpm` with different mtime → miss (undefined)
- `setDiscogs` + `getDiscogs` within TTL → hit
- `getDiscogs` with expired entry (mock Date.now) → miss
- `saveCache` → file exists with correct structure
- Token never in saved file (verified by inspecting written JSON)
