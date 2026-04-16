# index.ts — CLI Entry Point

**Status:** Approved  
**Date:** 2026-04-16

## Overview

`index.ts` wires up commander, resolves the Discogs token, loads the cache, runs the classifier pipeline with bounded concurrency, calls mover, prints the summary table, and saves the cache on exit.

## CLI

```
dj-sort <path> [--copy] [--recursive] [--dry-run]
               [--no-bpm] [--no-discogs] [--token <t>]
               [--log] [--help] [--version]
```

## Token resolution (security-sensitive)

Priority order:
1. `--token <value>` CLI flag
2. `DISCOGS_TOKEN` environment variable  
3. Manual parse of `.env` in `<path>` directory

Manual `.env` parse (no dotenv library):
```typescript
function parseEnvFile(dir: string): string | undefined {
  try {
    const lines = fs.readFileSync(path.join(dir, '.env'), 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^DISCOGS_TOKEN\s*=\s*(.+)$/);
      if (match) return match[1].trim();
    }
  } catch { /* file absent */ }
  return undefined;
}
```

**Security rules** (auditor will verify):
- Token value NEVER logged at any level
- Token not stored beyond the current process lifetime
- `--token` value hidden from commander's help default display (use `.hideHelp()` or don't set a default)

## Concurrency

Use a simple semaphore over `classifyFile` calls:

```typescript
async function withConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number, total: number) => Promise<void>,
): Promise<void> {
  let i = 0;
  async function next(): Promise<void> {
    const idx = i++;
    if (idx >= items.length) return;
    await fn(items[idx], idx, items.length);
    return next();
  }
  await Promise.all(Array.from({ length: limit }, next));
}
```

Progress log during BPM analysis: `logger.info(\`Processing ${idx + 1}/${total}...\`)`

## Summary table

After all files processed, print:

```
┌─────────────────┬───────┬──────────────┐
│ Category        │ Files │ Source       │
├─────────────────┼───────┼──────────────┤
│ 03_HOUSE        │    42 │ tag/bpm/disc │
│ 00_INBOX        │     3 │ —            │
└─────────────────┴───────┴──────────────┘
Total: 127. BPM analyzed: 84. Discogs: 12. Cached: 71.
```

Source column abbreviations: `tag`, `bpm`, `disc` (discogs), `file` (filename), `—` (inbox).
Print only categories that have at least 1 file. Sort by folder name.

## SIGINT handler

```typescript
process.on('SIGINT', () => {
  saveCache(rootDir);
  process.exit(0);
});
```

## Full flow

```typescript
// 1. Parse args with commander
// 2. Resolve token (--token > DISCOGS_TOKEN env > .env file)
// 3. initLogger({ logFile: log ? path.join(rootDir, 'organize.log') : undefined })
// 4. If no token: logger.info('Discogs disabled: no token provided')
// 5. loadCache(rootDir)
// 6. Register SIGINT handler
// 7. scanFiles(rootDir, recursive)
// 8. logger.info(`Found ${files.length} audio files`)
// 9. withConcurrency(files, MAX_CONCURRENCY, async (filepath, idx, total) => {
//      logger.info(`Processing ${idx+1}/${total}...`)
//      const result = await classifyFile(filepath, opts)
//      await moveFile(filepath, result.category, rootDir, moveOpts, result.source, result.bpm)
//      // accumulate stats
//    })
// 10. saveCache(rootDir)
// 11. Print summary table
// 12. process.exit(0)
```

## Stats tracking

```typescript
interface Stats {
  byCategory: Map<string, { count: number; sources: Set<string> }>;
  bpmAnalyzed: number;
  discogsLookups: number;
  cacheHits: number;
}
```

Increment `bpmAnalyzed` when `result.source === 'bpm'`.
Increment `discogsLookups` when `result.source === 'discogs'`.
Increment `cacheHits` when BPM or Discogs came from cache (track via a returned flag or by checking cache before classify — simplest: count files where `result.source === 'bpm'` or `'discogs'` but BPM/Discogs cache was a hit. For simplicity: count separately in `classifyFile`'s returned result by adding optional `cached?: boolean` field).

Actually, for simplicity: just count sources. Total = files.length. BPM analyzed = files where source='bpm'. Discogs = files where source='discogs'. Cached = not needed for MVP summary (use 0 or omit).

## Shebang

Add `#!/usr/bin/env node` as first line of `dist/index.js` — configure via `pkg` or add to tsconfig. Actually: set it in the compiled file via a `prepend` — the simplest approach is to add it as a comment that `pkg` preserves, or rely on `pkg` bin mode. Alternatively: add `#!/usr/bin/env node` as first line in `src/index.ts` inside a comment (TypeScript ignores it).

Actual approach: TypeScript will strip `#!/usr/bin/env node` if placed on line 1. Use the `bin` field in package.json (already set) and `pkg` will handle it automatically.
