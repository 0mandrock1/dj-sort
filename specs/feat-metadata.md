# metadata.ts — ID3/FLAC Tag Reading

**Status:** Approved  
**Date:** 2026-04-16

## Overview

`metadata.ts` reads audio file tags via `music-metadata` and returns a normalized result used by the classifier. It extracts: duration, genre string, BPM tag, artist, and title.

## Goals

- `readMetadata(filepath): Promise<AudioMetadata>` returning normalized tag data
- Catch all errors → return null fields (never propagate)
- Expose artist + title for Discogs lookup
- Expose genre string for `GENRE_MAP` matching
- Expose BPM tag (some files store it as TBPM/BPM)
- Expose duration in seconds

## Non-Goals

- Writing tags
- Album art extraction
- Multi-value genre arrays (take first element only)

## API

```typescript
export interface AudioMetadata {
  durationSeconds: number | null;
  genre: string | null;         // first genre value, lowercased
  bpm: number | null;           // from tag (TBPM); null if absent or non-numeric
  artist: string | null;        // first artist
  title: string | null;
}

export async function readMetadata(filepath: string): Promise<AudioMetadata>;
```

## Implementation

```typescript
import { parseFile } from 'music-metadata';
import { logger } from './logger';

const EMPTY: AudioMetadata = {
  durationSeconds: null, genre: null, bpm: null, artist: null, title: null,
};

export async function readMetadata(filepath: string): Promise<AudioMetadata> {
  try {
    const { common, format } = await parseFile(filepath, { duration: true });

    const bpmRaw = common.bpm;
    const bpm = typeof bpmRaw === 'number' && isFinite(bpmRaw) ? bpmRaw : null;

    return {
      durationSeconds: format.duration ?? null,
      genre: common.genre?.[0]?.toLowerCase() ?? null,
      bpm,
      artist: common.artist ?? null,
      title: common.title ?? null,
    };
  } catch (err) {
    logger.debug(`metadata error for ${filepath}: ${String(err)}`);
    return { ...EMPTY };
  }
}
```

## Notes

- `music-metadata` v10: `parseFile` is CJS-compatible via `esModuleInterop`
- `{ duration: true }` ensures duration is calculated even for VBR MP3s (costs a full file read; acceptable for our use case)
- BPM tag: `common.bpm` is already a number in music-metadata; guard against NaN/Infinity

## Testing Strategy

- File with full tags → all fields populated
- File with no tags → all fields null, no throw
- Corrupt/non-audio file → all fields null, no throw
- Genre array with multiple values → only first, lowercased
- BPM tag present → numeric value returned
- BPM tag missing → null
