# categories.ts — Single Source of Truth

**Status:** Approved  
**Date:** 2026-04-16

## Overview

`categories.ts` defines every constant used across the classifier pipeline: folder names, BPM ranges, genre/filename keywords, and the Discogs style map. No other file may hardcode any of these values.

## Background

The classifier pipeline in `classifier.ts` makes decisions based on BPM ranges, genre strings, filename keywords, and Discogs styles. Without a single authoritative source, these values would scatter across modules, making tuning and testing error-prone. `categories.ts` is the only file that needs to change when category definitions evolve.

## Goals

- Export all folder name constants (typed string literals)
- Export BPM range boundaries as a typed array
- Export filename keyword lists for TOOLS and SETS detection
- Export the Discogs style → category map
- Export genre keyword → category map (from ID3/FLAC tags)
- Zero runtime dependencies

## Non-Goals

- Any I/O, file system access, or API calls
- Default exports (named exports only — easier to tree-shake and grep)
- Computed/dynamic values

## Technical Dependencies

- TypeScript 5.x (no runtime deps)

## Detailed Design

### Category identifier type

```typescript
export type Category =
  | 'INBOX'
  | 'WARMUP'
  | 'GROOVES'
  | 'HOUSE'
  | 'TECHNO'
  | 'BREAKS_DnB'
  | 'EXPERIMENTAL'
  | 'TOOLS'
  | 'SETS';
```

### Folder name map

```typescript
export const FOLDER: Record<Category, string> = {
  INBOX:        '00_INBOX',
  WARMUP:       '01_WARMUP',
  GROOVES:      '02_GROOVES',
  HOUSE:        '03_HOUSE',
  TECHNO:       '04_TECHNO',
  BREAKS_DnB:   '05_BREAKS_DnB',
  EXPERIMENTAL: '06_EXPERIMENTAL',
  TOOLS:        '07_TOOLS',
  SETS:         '08_SETS',
};
```

### BPM ranges

Each entry: `{ min, max, category }`. Ranges are inclusive on both ends.  
Order matters — first match wins (used by classifier).

```typescript
export interface BpmRange {
  min: number;
  max: number;
  category: Category;
}

export const BPM_RANGES: BpmRange[] = [
  { min: 60,  max: 100, category: 'WARMUP'     },
  { min: 100, max: 122, category: 'GROOVES'    },
  { min: 122, max: 128, category: 'HOUSE'      },
  { min: 128, max: 150, category: 'TECHNO'     },
  { min: 150, max: 180, category: 'BREAKS_DnB' },
];
```

Note: BPM outside all ranges (< 60 or > 180, or null) → falls through to next pipeline step.

### Filename keyword lists

All lowercase; classifier compares against `path.basename(file).toLowerCase()`.

```typescript
export const TOOLS_KEYWORDS: string[] = [
  'loop', 'acap', 'intro', 'outro', 'fx', 'stem', 'vox',
];

export const SETS_KEYWORDS: string[] = [
  'mix', 'set', 'podcast', 'episode',
];
```

### Sets duration threshold

```typescript
export const SETS_DURATION_SECONDS = 1800; // 30 minutes
```

### Genre keyword map

Keys are lowercase substrings matched against the ID3/FLAC genre tag.  
Value is the target category.

```typescript
export const GENRE_MAP: Record<string, Category> = {
  // WARMUP
  'ambient':    'WARMUP',
  'downtempo':  'WARMUP',
  'chill':      'WARMUP',
  'trip hop':   'WARMUP',
  'trip-hop':   'WARMUP',
  'chillout':   'WARMUP',
  // GROOVES
  'funk':       'GROOVES',
  'disco':      'GROOVES',
  'nu-disco':   'GROOVES',
  'nu disco':   'GROOVES',
  'soul':       'GROOVES',
  // HOUSE
  'house':      'HOUSE',
  'deep house': 'HOUSE',
  'tech house': 'HOUSE',
  'progressive':'HOUSE',
  // TECHNO
  'techno':     'TECHNO',
  'industrial': 'TECHNO',
  'hard techno':'TECHNO',
  'ebm':        'TECHNO',
  // BREAKS_DnB
  'drum n bass':'BREAKS_DnB',
  'drum and bass':'BREAKS_DnB',
  'dnb':        'BREAKS_DnB',
  'jungle':     'BREAKS_DnB',
  'breakbeat':  'BREAKS_DnB',
  'breaks':     'BREAKS_DnB',
  // EXPERIMENTAL
  'idm':        'EXPERIMENTAL',
  'experimental':'EXPERIMENTAL',
  'noise':      'EXPERIMENTAL',
  'abstract':   'EXPERIMENTAL',
};
```

### Discogs style map

Keys are exact Discogs style strings (case-insensitive match at runtime).

```typescript
export const DISCOGS_STYLE_MAP: Record<string, Category> = {
  // TECHNO
  'Techno':       'TECHNO',
  'Industrial':   'TECHNO',
  'Hard Techno':  'TECHNO',
  'EBM':          'TECHNO',
  // HOUSE
  'House':        'HOUSE',
  'Deep House':   'HOUSE',
  'Tech House':   'HOUSE',
  'Progressive House': 'HOUSE',
  // GROOVES
  'Disco':        'GROOVES',
  'Nu-Disco':     'GROOVES',
  'Funk':         'GROOVES',
  'Soul':         'GROOVES',
  // BREAKS_DnB
  'Drum n Bass':  'BREAKS_DnB',
  'Jungle':       'BREAKS_DnB',
  'Breakbeat':    'BREAKS_DnB',
  'Breaks':       'BREAKS_DnB',
  // WARMUP
  'Ambient':      'WARMUP',
  'Downtempo':    'WARMUP',
  'Chillout':     'WARMUP',
  'Trip Hop':     'WARMUP',
  // EXPERIMENTAL
  'IDM':          'EXPERIMENTAL',
  'Experimental': 'EXPERIMENTAL',
  'Noise':        'EXPERIMENTAL',
  'Abstract':     'EXPERIMENTAL',
};
```

### Supported audio extensions

```typescript
export const AUDIO_EXTENSIONS: string[] = [
  '.mp3', '.flac', '.wav', '.aiff', '.ogg', '.m4a', '.aac',
];
```

### Concurrency limit

```typescript
export const MAX_CONCURRENCY = 3;
```

### Discogs throttle constants

```typescript
export const DISCOGS_THROTTLE_MS = 1000;      // 1 req/sec
export const DISCOGS_RETRY_WAIT_MS = 2000;    // wait on 429
export const DISCOGS_CACHE_TTL_DAYS = 30;
```

## Consumers

| Module | What it uses |
|---|---|
| `classifier.ts` | `FOLDER`, `BPM_RANGES`, `TOOLS_KEYWORDS`, `SETS_KEYWORDS`, `SETS_DURATION_SECONDS`, `GENRE_MAP`, `Category` |
| `discogs.ts` | `DISCOGS_STYLE_MAP`, `DISCOGS_THROTTLE_MS`, `DISCOGS_RETRY_WAIT_MS` |
| `cache.ts` | `DISCOGS_CACHE_TTL_DAYS` |
| `scanner.ts` | `AUDIO_EXTENSIONS` |
| `mover.ts` | `FOLDER` |
| `index.ts` | `MAX_CONCURRENCY`, `FOLDER` |

## Testing Strategy

Pure data module — tests verify values are correct and internally consistent.

```typescript
// categories.test.ts

// BPM ranges cover expected musical territory without gaps between adjacent categories
it('BPM ranges are sorted ascending by min', ...)
it('adjacent BPM ranges share a boundary (max[n] === min[n+1])', ...)
it('WARMUP starts at 60, BREAKS_DnB ends at 180', ...)

// FOLDER keys match Category union exactly — no missing or extra entries
it('FOLDER has an entry for every Category', ...)
it('all FOLDER values match pattern /^\\d{2}_/', ...)

// Keyword lists are lowercase and non-empty
it('all TOOLS_KEYWORDS are lowercase', ...)
it('all SETS_KEYWORDS are lowercase', ...)

// Maps have no duplicate keys (TypeScript won't catch this at runtime for literals)
it('GENRE_MAP has no duplicate values that would cause silent overwrite', ...)
it('DISCOGS_STYLE_MAP covers all styles listed in CLAUDE.md', ...)

// Extensions start with dot
it('all AUDIO_EXTENSIONS start with "."', ...)
```

## Performance Considerations

Module is imported once; all exports are plain object literals — negligible overhead.

## Security Considerations

None — no I/O, no secrets, no external data.

## Implementation Phases

**Phase 1 (this spec):** All exports above in a single file, no runtime logic.

## Open Questions

- Should BPM boundaries be half-open intervals `[min, max)` to avoid double-counting at e.g. 122 BPM? Decision: use `>=` min, `<` max in classifier, document here.
- Add a `bpmToCategory(bpm: number): Category | null` helper here or in classifier? Decision: keep it in `classifier.ts` — `categories.ts` is data only.
