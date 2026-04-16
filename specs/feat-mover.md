# mover.ts — File Move / Copy / Dry-run

**Status:** Approved  
**Date:** 2026-04-16

## Overview

`mover.ts` moves or copies a classified file into its target subfolder. Supports `--copy`, `--dry-run`, and idempotency (skips files already in correct folder).

## API

```typescript
export interface MoveOptions {
  copy:   boolean;
  dryRun: boolean;
}

export async function moveFile(
  filepath: string,
  category: Category,
  rootDir: string,
  opts: MoveOptions,
  source: string,  // for dry-run logging: 'tag'|'bpm:124'|'discogs:House'|etc.
  bpm?: number,
): Promise<void>;
```

## Behavior

1. Compute `destDir = path.join(rootDir, FOLDER[category])`
2. Compute `destPath = path.join(destDir, path.basename(filepath))`
3. If `filepath === destPath` → already in place, log debug, skip
4. If `dryRun` → log `[DRY-RUN] <basename> → <folderName> [<sourceTag>]` and return
5. Create `destDir` if it doesn't exist (`fs.promises.mkdir` with `recursive: true`)
6. If `copy`: `fs.promises.copyFile` — else: `fs.promises.rename`
7. On success: log `info` with basename + destination folder
8. On error: log `error` with filepath + error message; do not rethrow

## Source tag format (dry-run output)

```
[tag]            — from genre/duration metadata
[bpm:124]        — from BPM detection, value shown
[discogs:House]  — from Discogs, style name shown
[filename]       — from filename keyword
[inbox]          — no match
```

## Notes

- `fs.promises.rename` fails cross-device on some systems (USB drive); if it throws with `EXDEV`, fallback to copyFile + unlink
- Never delete the source file unless the move succeeded
