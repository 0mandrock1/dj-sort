# classifier.ts — Classification Orchestrator

**Status:** Approved  
**Date:** 2026-04-16

## Overview

`classifier.ts` runs each audio file through the 5-step pipeline and returns a `ClassifyResult` containing the assigned `Category` and the source tags used. It consults the cache before running BPM or Discogs, and writes results back to the cache.

## Pipeline (from CLAUDE.md)

```
1. filename keywords → TOOLS or SETS (no I/O)
2. metadata.ts: duration → SETS | genre → category | store BPM tag
3. bpm.ts: if no BPM tag → detect → category by range | null on failure
4. discogs.ts: if no genre AND (no BPM OR needs context) → API lookup
5. → INBOX
```

## API

```typescript
export interface ClassifyResult {
  category: Category;
  source: 'filename' | 'tag' | 'bpm' | 'discogs' | 'inbox';
  bpm?: number;        // detected or tagged BPM, if available
}

export interface ClassifyOptions {
  noBpm: boolean;
  noDiscogs: boolean;
  token: string | undefined;
}

export async function classifyFile(
  filepath: string,
  opts: ClassifyOptions,
): Promise<ClassifyResult>;
```

## Detailed pipeline

### Step 1 — Filename keywords (no I/O)
```typescript
const base = path.basename(filepath).toLowerCase();
if (TOOLS_KEYWORDS.some(kw => base.includes(kw))) return { category: 'TOOLS', source: 'filename' };
if (SETS_KEYWORDS.some(kw => base.includes(kw)))  return { category: 'SETS',  source: 'filename' };
```

### Step 2 — Metadata
```typescript
const meta = await readMetadata(filepath);
if (meta.durationSeconds !== null && meta.durationSeconds > SETS_DURATION_SECONDS)
  return { category: 'SETS', source: 'tag' };

if (meta.genre) {
  const cat = matchGenre(meta.genre); // iterate GENRE_MAP keys as substrings
  if (cat) return { category: cat, source: 'tag', bpm: meta.bpm ?? undefined };
}
```

### Step 3 — BPM
```typescript
let bpm: number | null = meta.bpm;

if (bpm === null && !opts.noBpm) {
  // Check cache first
  const mtime = (await fs.promises.stat(filepath)).mtimeMs;
  const cached = getBpm(filepath, mtime);
  if (cached !== undefined) {
    bpm = cached;
  } else {
    bpm = await detectBpm(filepath);
    setBpm(filepath, mtime, bpm);
  }
}

if (bpm !== null) {
  const cat = bpmToCategory(bpm);
  if (cat) return { category: cat, source: 'bpm', bpm };
}
```

### Step 4 — Discogs
```typescript
const needsDiscogs = !meta.genre && !opts.noDiscogs &&
  (bpm === null || true); // always try if no genre match, per spec

if (needsDiscogs && meta.artist && meta.title) {
  const cached = getDiscogs(meta.artist, meta.title);
  if (cached !== undefined) {
    return { category: cached as Category, source: 'discogs', bpm: bpm ?? undefined };
  }
  const cat = await lookupDiscogs(meta.artist, meta.title, opts.token);
  if (cat) {
    setDiscogs(meta.artist, meta.title, cat);
    return { category: cat, source: 'discogs', bpm: bpm ?? undefined };
  }
}
```

### Step 5 — Fallback
```typescript
return { category: 'INBOX', source: 'inbox', bpm: bpm ?? undefined };
```

## Helper: matchGenre

```typescript
function matchGenre(genre: string): Category | null {
  const lower = genre.toLowerCase();
  for (const [keyword, cat] of Object.entries(GENRE_MAP)) {
    if (lower.includes(keyword)) return cat;
  }
  return null;
}
```

## Helper: bpmToCategory

```typescript
function bpmToCategory(bpm: number): Category | null {
  for (const range of BPM_RANGES) {
    if (bpm >= range.min && bpm < range.max) return range.category;
  }
  return null;
}
```

Note: uses `>= min, < max` (half-open interval) to avoid double-counting at boundaries.
Exception: BREAKS_DnB max=180 uses `<= max` to include exactly 180.

## Imports

```typescript
import * as path from 'path';
import * as fs from 'fs';
import {
  Category, BPM_RANGES, GENRE_MAP,
  TOOLS_KEYWORDS, SETS_KEYWORDS, SETS_DURATION_SECONDS,
} from './categories';
import { readMetadata } from './metadata';
import { detectBpm } from './bpm';
import { lookupDiscogs } from './discogs';
import { getBpm, setBpm, getDiscogs, setDiscogs } from './cache';
```

## Testing Strategy

- `loop_kick.wav` → TOOLS (filename, no I/O)
- `90min_mix.mp3` → SETS (filename keyword)
- genre tag "House" → HOUSE, source: 'tag'
- duration 3601s → SETS, source: 'tag'
- no genre, BPM 125 → HOUSE, source: 'bpm'
- BPM 181 (out of range) → falls through to Discogs or INBOX
- Discogs returns 'TECHNO' → TECHNO, source: 'discogs'
- All nulls → INBOX, source: 'inbox'
- Cache hit on BPM → `detectBpm` not called
- `--no-bpm` → `detectBpm` not called
- `--no-discogs` → `lookupDiscogs` not called
