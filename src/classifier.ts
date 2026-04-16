import * as path from 'path';
import * as fs from 'fs';
import {
  Category,
  BPM_RANGES,
  FOLDER,
  GENRE_MAP,
  TOOLS_KEYWORDS,
  SETS_KEYWORDS,
  SETS_DURATION_SECONDS,
} from './categories';
import { readMetadata } from './metadata';
import { detectBpm } from './bpm';
import { lookupDiscogs } from './discogs';
import { getBpm, setBpm, getDiscogs, setDiscogs } from './cache';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ClassifyResult {
  category: Category;
  source: 'filename' | 'tag' | 'bpm' | 'discogs' | 'inbox';
  bpm?: number;
  fromCache?: boolean; // true when result came from BPM or Discogs cache
}

export interface ClassifyOptions {
  noBpm: boolean;
  noDiscogs: boolean;
  token: string | undefined;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function matchGenre(genre: string): Category | null {
  const lower = genre.toLowerCase();
  for (const [keyword, cat] of Object.entries(GENRE_MAP)) {
    if (lower.includes(keyword)) return cat;
  }
  return null;
}

function bpmToCategory(bpm: number): Category | null {
  for (const range of BPM_RANGES) {
    if (bpm >= range.min && (range.inclusive ? bpm <= range.max : bpm < range.max)) {
      return range.category;
    }
  }
  return null;
}

// Matches a keyword against a filename using word-boundary awareness.
// Prevents 'mix' matching inside 'remix', 'loop' inside 'loophole', etc.
function matchesKeyword(base: string, kw: string): boolean {
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(base);
}

// ---------------------------------------------------------------------------
// Main classifier
// ---------------------------------------------------------------------------

export async function classifyFile(
  filepath: string,
  opts: ClassifyOptions,
): Promise<ClassifyResult> {

  // Step 1 — Filename keywords (no I/O)
  const base = path.basename(filepath).toLowerCase();
  if (TOOLS_KEYWORDS.some(kw => matchesKeyword(base, kw))) {
    return { category: 'TOOLS', source: 'filename' };
  }
  if (SETS_KEYWORDS.some(kw => matchesKeyword(base, kw))) {
    return { category: 'SETS', source: 'filename' };
  }

  // Step 2 — Metadata
  const meta = await readMetadata(filepath);

  if (meta.durationSeconds !== null && meta.durationSeconds > SETS_DURATION_SECONDS) {
    return { category: 'SETS', source: 'tag' };
  }

  // Track whether the genre tag yielded a known category (unrecognised tags must not block Discogs)
  const genreCategory = meta.genre ? matchGenre(meta.genre) : null;
  if (genreCategory) {
    return { category: genreCategory, source: 'tag', bpm: meta.bpm ?? undefined };
  }

  // Step 3 — BPM
  let bpm: number | null = meta.bpm;
  let bpmFromCache = false;

  if (bpm === null && !opts.noBpm) {
    try {
      const mtime = (await fs.promises.stat(filepath)).mtimeMs;
      const cached = getBpm(filepath, mtime);
      if (cached !== undefined) {
        bpm = cached;
        bpmFromCache = true;
      } else {
        bpm = await detectBpm(filepath);
        setBpm(filepath, mtime, bpm);
      }
    } catch {
      // File vanished or stat failed — treat as no BPM and continue pipeline
      bpm = null;
    }
  }

  if (bpm !== null) {
    const cat = bpmToCategory(bpm);
    if (cat) return { category: cat, source: 'bpm', bpm, fromCache: bpmFromCache };
  }

  // Step 4 — Discogs: fire when no genre category was resolved (tag absent or unrecognised)
  const needsDiscogs = !genreCategory && !opts.noDiscogs;

  if (needsDiscogs && meta.artist && meta.title) {
    const cached = getDiscogs(meta.artist, meta.title);
    if (cached !== undefined) {
      // Validate cached value is still a known category (guards against stale/edited cache)
      if (cached in FOLDER) {
        return { category: cached as Category, source: 'discogs', bpm: bpm ?? undefined, fromCache: true };
      }
    }
    const cat = await lookupDiscogs(meta.artist, meta.title, opts.token);
    if (cat) {
      setDiscogs(meta.artist, meta.title, cat);
      return { category: cat, source: 'discogs', bpm: bpm ?? undefined };
    }
  }

  // Step 5 — Fallback
  return { category: 'INBOX', source: 'inbox', bpm: bpm ?? undefined };
}
