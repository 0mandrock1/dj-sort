import * as fs from 'fs';
import * as path from 'path';
import { DISCOGS_CACHE_TTL_DAYS } from './categories';
import { logger } from './logger';

const CACHE_FILENAME = '.dj-sort-cache.json';
const TTL_MS = DISCOGS_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

interface BpmEntry {
  bpm: number | null;
}

interface DiscogsEntry {
  category: string;
  cachedAt: number;
}

interface CacheFile {
  bpm: Record<string, BpmEntry>;
  discogs: Record<string, DiscogsEntry>;
}

let cache: CacheFile = { bpm: {}, discogs: {} };
let cacheDir: string | undefined;

export function loadCache(dir: string): void {
  cacheDir = dir;
  const file = path.join(dir, CACHE_FILENAME);
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<CacheFile>;
    cache = { bpm: parsed.bpm ?? {}, discogs: parsed.discogs ?? {} };
    logger.debug(
      `Cache loaded: ${Object.keys(cache.bpm).length} bpm, ${Object.keys(cache.discogs).length} discogs entries`,
    );
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
  return entry !== undefined ? entry.bpm : undefined;
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
