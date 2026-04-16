#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { MAX_CONCURRENCY, FOLDER } from './categories';
import { initLogger, logger } from './logger';
import { scanFiles } from './scanner';
import { classifyFile, ClassifyOptions, ClassifyResult } from './classifier';
import { moveFile, MoveOptions } from './mover';
import { loadCache, saveCache } from './cache';

// ---------------------------------------------------------------------------
// Package version (resolved at build time via resolveJsonModule)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../package.json') as { version: string };

// Personal build: optional baked-in token (src/personal.ts is gitignored).
// Falls back to empty string so the public build compiles without it.
let PERSONAL_TOKEN = '';
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  PERSONAL_TOKEN = (require('./personal') as { PERSONAL_TOKEN: string }).PERSONAL_TOKEN;
} catch { /* not a personal build */ }

// ---------------------------------------------------------------------------
// Commander setup
// ---------------------------------------------------------------------------

const program = new Command();
program
  .name('dj-sort')
  .description('Organizes audio files into DJ-friendly subfolders')
  .version(pkg.version)
  .argument('<path>', 'Source folder containing audio files')
  .option('--copy', 'Copy files instead of moving', false)
  .option('--recursive', 'Scan subdirectories', false)
  .option('--dry-run', 'Show what would happen without moving files', false)
  .option('--no-bpm', 'Skip BPM detection')
  .option('--no-discogs', 'Skip Discogs API lookups')
  .option('--token <token>', 'Discogs API token')
  .option('--log', 'Write organize.log in the source folder', false)
  .parse(process.argv);

// ---------------------------------------------------------------------------
// Token resolution (SECURITY: token value is never logged)
// ---------------------------------------------------------------------------

function parseEnvFile(dir: string): string | undefined {
  try {
    const lines = fs.readFileSync(path.join(dir, '.env'), 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^DISCOGS_TOKEN\s*=\s*(.+)$/);
      if (match) return match[1].trim();
    }
  } catch { /* file absent or unreadable */ }
  return undefined;
}

// ---------------------------------------------------------------------------
// Bounded concurrency helper
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Summary table
// ---------------------------------------------------------------------------

function printSummary(
  byCategory: Map<string, { count: number; sources: Set<string> }>,
  total: number,
  bpmAnalyzed: number,
  discogsCount: number,
  cachedCount: number,
): void {
  const sourceAbbrev: Record<string, string> = {
    filename: 'file',
    tag:      'tag',
    bpm:      'bpm',
    discogs:  'disc',
    inbox:    '—',
  };

  // Sort rows by folder name
  const rows = Array.from(byCategory.entries())
    .filter(([, v]) => v.count > 0)
    .sort(([a], [b]) => a.localeCompare(b));

  if (rows.length === 0) {
    return;
  }

  // Determine column widths
  const catHeader  = 'Category';
  const filesHeader = 'Files';
  const srcHeader  = 'Source';

  const catWidth  = Math.max(catHeader.length,  ...rows.map(([k]) => k.length));
  const filesWidth = Math.max(filesHeader.length, ...rows.map(([, v]) => String(v.count).length));
  const srcWidth  = Math.max(srcHeader.length,   ...rows.map(([, v]) => {
    const abbrevs = Array.from(v.sources).map(s => sourceAbbrev[s] ?? s);
    return abbrevs.join('/').length;
  }));

  const pad = (s: string, w: number): string => s.padEnd(w);
  const rpad = (s: string, w: number): string => s.padStart(w);

  const top    = `┌─${'─'.repeat(catWidth)}─┬─${'─'.repeat(filesWidth)}─┬─${'─'.repeat(srcWidth)}─┐`;
  const sep    = `├─${'─'.repeat(catWidth)}─┼─${'─'.repeat(filesWidth)}─┼─${'─'.repeat(srcWidth)}─┤`;
  const bottom = `└─${'─'.repeat(catWidth)}─┴─${'─'.repeat(filesWidth)}─┴─${'─'.repeat(srcWidth)}─┘`;

  process.stdout.write(top + '\n');
  process.stdout.write(`│ ${pad(catHeader, catWidth)} │ ${rpad(filesHeader, filesWidth)} │ ${pad(srcHeader, srcWidth)} │\n`);
  process.stdout.write(sep + '\n');

  for (const [folder, { count, sources }] of rows) {
    const abbrevs = Array.from(sources).map(s => sourceAbbrev[s] ?? s);
    const srcStr  = abbrevs.join('/');
    process.stdout.write(`│ ${pad(folder, catWidth)} │ ${rpad(String(count), filesWidth)} │ ${pad(srcStr, srcWidth)} │\n`);
  }

  process.stdout.write(bottom + '\n');
  process.stdout.write(`Total: ${total}. BPM analyzed: ${bpmAnalyzed}. Discogs: ${discogsCount}. Cached: ${cachedCount}.\n`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = program.args;
  const opts = program.opts<{
    copy:      boolean;
    recursive: boolean;
    dryRun:    boolean;
    bpm:       boolean;   // commander inverts --no-bpm to opts.bpm = false
    discogs:   boolean;   // commander inverts --no-discogs to opts.discogs = false
    token?:    string;
    log:       boolean;
  }>();

  const rootDir = path.resolve(args[0]);

  // Resolve token — value must never be logged
  const token: string | undefined =
    opts.token ??
    (PERSONAL_TOKEN || undefined) ??
    process.env['DISCOGS_TOKEN'] ??
    parseEnvFile(rootDir);

  // Initialise logger before any logger.* calls
  initLogger({ logFile: opts.log ? path.join(rootDir, 'organize.log') : undefined });

  // Token presence signal (value never exposed)
  if (!opts.discogs) {
    logger.info('Discogs disabled: --no-discogs flag');
  } else if (!token) {
    logger.info('Discogs disabled: no token provided');
  }

  // Load cache
  loadCache(rootDir);

  // Save cache on early exit
  process.on('SIGINT', () => {
    saveCache(rootDir);
    process.exit(0);
  });

  // Scan
  let files: string[];
  try {
    files = await scanFiles(rootDir, opts.recursive);
  } catch (err: unknown) {
    logger.error(`Failed to scan ${rootDir}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  logger.info(`Found ${files.length} audio files`);

  if (files.length === 0) {
    logger.info('Nothing to do.');
    process.exit(0);
  }

  // Build option objects for downstream modules
  const classifyOpts: ClassifyOptions = {
    noBpm:     !opts.bpm,
    noDiscogs: !opts.discogs || !token,
    token,
  };

  const moveOpts: MoveOptions = {
    copy:   opts.copy,
    dryRun: opts.dryRun,
  };

  // Stats
  const byCategory = new Map<string, { count: number; sources: Set<string> }>();
  let bpmAnalyzed = 0;
  let discogsCount = 0;
  let cachedCount  = 0;
  const total = files.length;

  // Process files with bounded concurrency
  await withConcurrency(files, MAX_CONCURRENCY, async (filepath, idx) => {
    logger.info(`Processing ${idx + 1}/${total}...`);

    let result: ClassifyResult;
    try {
      result = await classifyFile(filepath, classifyOpts);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`classify failed for ${filepath}: ${msg}`);
      result = { category: 'INBOX', source: 'inbox' };
    }

    await moveFile(filepath, result.category, rootDir, moveOpts, result.source, result.bpm);

    // Accumulate stats
    const folderName = FOLDER[result.category];
    if (!byCategory.has(folderName)) {
      byCategory.set(folderName, { count: 0, sources: new Set() });
    }
    const entry = byCategory.get(folderName)!;
    entry.count++;
    entry.sources.add(result.source);

    if (result.source === 'bpm')     bpmAnalyzed++;
    if (result.source === 'discogs') discogsCount++;
    if (result.fromCache)            cachedCount++;
  });

  // Persist cache
  saveCache(rootDir);

  // Print summary
  printSummary(byCategory, total, bpmAnalyzed, discogsCount, cachedCount);

  process.exit(0);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[ERROR] Fatal: ${msg}\n`);
  process.exit(1);
});
