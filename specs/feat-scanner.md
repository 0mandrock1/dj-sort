# scanner.ts — Audio File Discovery

**Status:** Approved  
**Date:** 2026-04-16

## Overview

`scanner.ts` walks a directory and returns the list of audio files to process. It respects `--recursive` and the `AUDIO_EXTENSIONS` allowlist from `categories.ts`. It also implements the idempotency rule: files already inside a known output subfolder are skipped.

## Goals

- `scanFiles(rootDir, recursive): Promise<string[]>` returning absolute paths
- Filter by `AUDIO_EXTENSIONS` (case-insensitive)
- Skip files whose parent directory name matches any `FOLDER` value (idempotency)
- Non-recursive by default: only top-level files in `rootDir`
- With `--recursive`: descend into all subdirectories except output folders

## Non-Goals

- Sorting (caller decides order)
- Symlink resolution
- Hidden file handling

## API

```typescript
export async function scanFiles(
  rootDir: string,
  recursive: boolean,
): Promise<string[]>;
```

## Behavior

- Uses `fs.readdir` with `{ withFileTypes: true }`
- Extension check: `AUDIO_EXTENSIONS.includes(ext.toLowerCase())`
- Idempotency: if `dirent.parentPath` (or reconstructed parent) basename is in `Object.values(FOLDER)` → skip entire subtree
- Recursive: when a subdirectory is encountered and it is NOT an output folder, recurse into it (only when `recursive=true`)
- Log skipped output folders at debug level: `logger.debug('Skipping output folder: ...')`

## Implementation sketch

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { AUDIO_EXTENSIONS, FOLDER } from './categories';
import { logger } from './logger';

const OUTPUT_FOLDERS = new Set(Object.values(FOLDER));

export async function scanFiles(rootDir: string, recursive: boolean): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.promises.readdir(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      if (OUTPUT_FOLDERS.has(entry.name)) {
        logger.debug(`Skipping output folder: ${fullPath}`);
        continue;
      }
      if (recursive) {
        const nested = await scanFiles(fullPath, true);
        results.push(...nested);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (AUDIO_EXTENSIONS.includes(ext)) {
        results.push(fullPath);
      }
    }
  }

  return results;
}
```

## Testing Strategy

- Empty directory → returns `[]`
- Directory with mixed files → only audio extensions returned
- Extension case-insensitivity: `.MP3` → included
- Non-recursive: subdirectory audio files NOT included
- Recursive: subdirectory audio files included
- Output folder (e.g. `03_HOUSE`) → skipped even in recursive mode
- File already in output folder not re-added (idempotency)
