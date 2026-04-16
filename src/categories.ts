// categories.ts — Single source of truth for all folder names, BPM ranges,
// genre keywords, Discogs style map, and pipeline constants.
// No runtime logic. No I/O. No imports.

// ---------------------------------------------------------------------------
// Category identifier type
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Folder name map
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// BPM ranges — inclusive on both ends; classifier uses >= min, < max
// Order matters: first match wins
// ---------------------------------------------------------------------------

export interface BpmRange {
  min: number;
  max: number;
  inclusive: boolean; // true = bpm <= max; false = bpm < max (half-open)
  category: Category;
}

export const BPM_RANGES: BpmRange[] = [
  { min: 60,  max: 100, inclusive: false, category: 'WARMUP'     },
  { min: 100, max: 122, inclusive: false, category: 'GROOVES'    },
  { min: 122, max: 128, inclusive: false, category: 'HOUSE'      },
  { min: 128, max: 150, inclusive: false, category: 'TECHNO'     },
  { min: 150, max: 180, inclusive: true,  category: 'BREAKS_DnB' },
];

// ---------------------------------------------------------------------------
// Filename keyword lists (all lowercase)
// Classifier compares against path.basename(file).toLowerCase()
// ---------------------------------------------------------------------------

export const TOOLS_KEYWORDS: string[] = [
  'loop', 'acap', 'intro', 'outro', 'fx', 'stem', 'vox',
];

export const SETS_KEYWORDS: string[] = [
  'mix', 'set', 'podcast', 'episode',
];

// ---------------------------------------------------------------------------
// Sets duration threshold
// ---------------------------------------------------------------------------

export const SETS_DURATION_SECONDS = 1800; // 30 minutes

// ---------------------------------------------------------------------------
// Genre keyword map
// Keys are lowercase substrings matched against ID3/FLAC genre tag
// ---------------------------------------------------------------------------

export const GENRE_MAP: Record<string, Category> = {
  // WARMUP
  'ambient':       'WARMUP',
  'downtempo':     'WARMUP',
  'chill':         'WARMUP',
  'trip hop':      'WARMUP',
  'trip-hop':      'WARMUP',
  'chillout':      'WARMUP',
  // GROOVES
  'funk':          'GROOVES',
  'disco':         'GROOVES',
  'nu-disco':      'GROOVES',
  'nu disco':      'GROOVES',
  'soul':          'GROOVES',
  // HOUSE
  'house':             'HOUSE',
  'deep house':        'HOUSE',
  'tech house':        'HOUSE',
  'progressive house': 'HOUSE',
  'prog house':        'HOUSE',
  // TECHNO
  'techno':        'TECHNO',
  'industrial':    'TECHNO',
  'hard techno':   'TECHNO',
  'ebm':           'TECHNO',
  // BREAKS_DnB
  'drum n bass':   'BREAKS_DnB',
  'drum and bass': 'BREAKS_DnB',
  'dnb':           'BREAKS_DnB',
  'jungle':        'BREAKS_DnB',
  'breakbeat':     'BREAKS_DnB',
  'breaks':        'BREAKS_DnB',
  // EXPERIMENTAL
  'idm':           'EXPERIMENTAL',
  'experimental':  'EXPERIMENTAL',
  'noise':         'EXPERIMENTAL',
  'abstract':      'EXPERIMENTAL',
};

// ---------------------------------------------------------------------------
// Discogs style map
// Keys are exact Discogs style strings; runtime match is case-insensitive
// ---------------------------------------------------------------------------

export const DISCOGS_STYLE_MAP: Record<string, Category> = {
  // TECHNO
  'Techno':            'TECHNO',
  'Industrial':        'TECHNO',
  'Hard Techno':       'TECHNO',
  'EBM':               'TECHNO',
  // HOUSE
  'House':             'HOUSE',
  'Deep House':        'HOUSE',
  'Tech House':        'HOUSE',
  'Progressive House': 'HOUSE',
  // GROOVES
  'Disco':             'GROOVES',
  'Nu-Disco':          'GROOVES',
  'Funk':              'GROOVES',
  'Soul':              'GROOVES',
  // BREAKS_DnB
  'Drum n Bass':       'BREAKS_DnB',
  'Jungle':            'BREAKS_DnB',
  'Breakbeat':         'BREAKS_DnB',
  'Breaks':            'BREAKS_DnB',
  // WARMUP
  'Ambient':           'WARMUP',
  'Downtempo':         'WARMUP',
  'Chillout':          'WARMUP',
  'Trip Hop':          'WARMUP',
  // EXPERIMENTAL
  'IDM':               'EXPERIMENTAL',
  'Experimental':      'EXPERIMENTAL',
  'Noise':             'EXPERIMENTAL',
  'Abstract':          'EXPERIMENTAL',
};

// ---------------------------------------------------------------------------
// Supported audio file extensions
// ---------------------------------------------------------------------------

export const AUDIO_EXTENSIONS: string[] = [
  '.mp3', '.flac', '.wav', '.aiff', '.ogg', '.m4a', '.aac',
];

// ---------------------------------------------------------------------------
// Pipeline concurrency limit
// ---------------------------------------------------------------------------

export const MAX_CONCURRENCY = 3;

// ---------------------------------------------------------------------------
// Discogs throttle constants
// ---------------------------------------------------------------------------

export const DISCOGS_THROTTLE_MS    = 1000; // 1 req/sec
export const DISCOGS_RETRY_WAIT_MS  = 2000; // wait on 429
export const DISCOGS_CACHE_TTL_DAYS = 30;
