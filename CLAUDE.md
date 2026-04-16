# dj-sort

CLI tool that scans a folder with audio files and distributes them into
DJ-friendly subfolders. Detects BPM directly from audio when metadata is missing,
enriches genre data via Discogs API as a last resort.
Designed for USB flash drives. Distributed as standalone binaries via GitHub Releases.

## Project structure

    dj-sort/
    ├── src/
    │   ├── index.ts          ← CLI entry point (commander)
    │   ├── scanner.ts        ← recursive file discovery
    │   ├── classifier.ts     ← orchestrates all enrichment sources → category
    │   ├── metadata.ts       ← reads local ID3/FLAC/etc tags via music-metadata
    │   ├── bpm.ts            ← audio BPM detection via web-audio-beat-detector
    │   ├── discogs.ts        ← Discogs API lookup by artist+title, returns styles[]
    │   ├── mover.ts          ← move / copy / dry-run logic
    │   ├── logger.ts         ← console output + .log file writer
    │   ├── cache.ts          ← persistent JSON cache for BPM results + Discogs responses
    │   └── categories.ts     ← folder names, BPM ranges, style maps (single source of truth)
    ├── .github/
    │   └── workflows/
    │       └── release.yml   ← builds and uploads binaries on git tag push
    ├── CLAUDE.md
    ├── package.json
    ├── tsconfig.json
    └── README.md

## Target folder structure produced on the flash drive

    MUSIC/
    ├── 00_INBOX/           ← unresolvable: no BPM detected, no genre, no Discogs match
    ├── 01_WARMUP/          ← 60–100 BPM, ambient, downtempo, chill
    ├── 02_GROOVES/         ← 100–122 BPM, funk, disco, nu-disco
    ├── 03_HOUSE/           ← 122–128 BPM, deep/tech/progressive house
    ├── 04_TECHNO/          ← 128–150 BPM, techno, industrial, hard techno
    ├── 05_BREAKS_DnB/      ← 150–180 BPM, breakbeat, jungle, DnB
    ├── 06_EXPERIMENTAL/    ← IDM, noise, abstract, odd time
    ├── 07_TOOLS/           ← loops, acapellas, stems, FX (filename keywords)
    └── 08_SETS/            ← mixes/podcasts: duration > 1800s or filename keyword

## Tech stack

- Runtime: Node.js 20 + TypeScript
- CLI framework: commander
- Audio metadata: music-metadata
- BPM detection: web-audio-beat-detector
- Audio decoding for BPM: audio-decode (decodes mp3/flac/wav/etc → PCM float32)
- HTTP client: got (CJS-compatible, works with pkg)
- Binary bundler: pkg (targets node20-win-x64, node20-macos-arm64, node20-linux-x64)
- Package manager: npm

## Enrichment pipeline — classifier.ts orchestration

For each audio file, classifier.ts runs these steps in order and stops as soon
as a confident category is found:

    Step 1 — filename keyword check (no I/O)
        → TOOLS if match: loop, acap, acapella, intro, outro, fx, stem, vox
        → SETS  if match: mix, set, podcast, episode

    Step 2 — local metadata (metadata.ts)
        Read: BPM tag, genre tag, duration
        → SETS if duration > 1800s
        → category by genre keyword match (see keyword map in categories.ts)
        → store BPM tag value if present, continue to Step 3 for genre enrichment
        → if genre tag missing: continue to Step 3

    Step 3 — BPM detection (bpm.ts)
        Trigger condition: no BPM tag found in Step 2
        Decode audio → Float32Array (mono, 44100 Hz) via audio-decode
        Run web-audio-beat-detector → bpm: number
        Cache result to .dj-sort-cache.json keyed by filepath+mtime
        If genre was already resolved in Step 2: use detected BPM only to confirm range
        If no genre: classify by BPM range (categories.ts)
        → category if BPM in known range
        → continue to Step 4 if BPM detection failed (silence, noise, corrupt file)

    Step 4 — Discogs API fallback (discogs.ts)
        Trigger condition: genre tag missing AND (BPM detection failed OR BPM found
        but genre context would improve accuracy)
        Parse artist + title from ID3 tags, fallback to "Artist - Title" filename pattern
        Query: GET /database/search?artist=...&track=...&type=release&per_page=1
        Extract styles[] and genres[] from results[0]
        Map via styleMap in categories.ts
        Cache result to .dj-sort-cache.json keyed by "artist|title"
        → category if style matched
        → INBOX if no match or API error or no token

    Step 5 — final fallback
        → INBOX

## BPM detection implementation (bpm.ts)

Package: web-audio-beat-detector
Import: const { analyze } = require('web-audio-beat-detector')

Audio decoding pipeline:
    1. Read file buffer with fs.readFile
    2. Decode to AudioBuffer-like object via audio-decode:
           const audioBuffer = await decode(buffer)
           // returns { sampleRate, channelData: Float32Array[] }
    3. Pass to analyzer:
           const bpm = await analyze(audioBuffer)
           // returns number (e.g. 128.0)

Wrap in try/catch — detection can fail on silence, corrupt audio, or non-musical content.
On failure: return null (do not throw).

Performance note: decoding large FLAC/WAV files can be slow.
Use cache aggressively — never re-analyze a file with the same mtime.

audio-decode compatibility: verify CJS import works with pkg before finalizing.
If audio-decode has ESM issues, use alternative: @ffmpeg-installer/ffmpeg is too heavy.
Preferred fallback decoder if needed: node-web-audio-api (has AudioContext.decodeAudioData).

## Discogs API integration (discogs.ts)

Authentication: User-Token header
    Authorization: Discogs token=<DISCOGS_TOKEN>

User-Agent (required by Discogs policy):
    User-Agent: dj-sort/1.0 +https://github.com/<user>/dj-sort

Rate limit: 60 req/min — throttle to 1 request/sec with a simple queue
Handle 429: wait 2s, retry once, then skip and log warning

Endpoint:
    GET https://api.discogs.com/database/search
    params: artist, track, type=release, per_page=1

Response: results[0].style (string[]), results[0].genre (string[])

## Discogs style → category map (lives in categories.ts)

    Techno, Industrial, Hard Techno, EBM         → TECHNO
    House, Deep House, Tech House, Progressive   → HOUSE
    Disco, Nu-Disco, Funk, Soul                  → GROOVES
    Drum n Bass, Jungle, Breakbeat, Breaks       → BREAKS_DnB
    Ambient, Downtempo, Chillout, Trip Hop       → WARMUP
    IDM, Experimental, Noise, Abstract, Avant    → EXPERIMENTAL
    (no match)                                   → INBOX

## Cache (cache.ts)

File: <source_folder>/.dj-sort-cache.json
Load on start, save on exit (including SIGINT).

Two cache namespaces:

    bpm:
        key:   "<absolute_filepath>|<mtime_ms>"
        value: { bpm: number | null, timestamp: number }
        TTL:   none (mtime change invalidates automatically)

    discogs:
        key:   "<artist>|<title>" (lowercased, trimmed)
        value: { category: string, timestamp: number }
        TTL:   30 days

## DISCOGS_TOKEN configuration

Priority order:
    1. --token <value> CLI flag
    2. DISCOGS_TOKEN environment variable
    3. .env file in current working directory (parsed manually, no dotenv package)

If token absent: skip Discogs step entirely, log info message, degrade gracefully.

## CLI flags

    dj-sort <path> [options]

    --copy           Copy files instead of moving (default: move)
    --recursive      Scan subfolders recursively (default: flat)
    --dry-run        Preview only, no files touched
    --no-discogs     Skip Discogs lookup entirely
    --no-bpm         Skip BPM detection (use metadata tags only)
    --token <value>  Discogs API token (overrides env)
    --log            Write organize.log to source folder (default: true)
    --help           Usage info
    --version        Print version

## Supported audio formats

.mp3 .flac .wav .aiff .ogg .m4a .aac

## Idempotency rule

If a file is already inside one of the known target subfolders, skip it.
Never move a file that is already categorized.

## Summary output format (printed at end of every run)

    ┌─────────────────┬───────┬──────────────┐
    │ Category        │ Files │ Source       │
    ├─────────────────┼───────┼──────────────┤
    │ 03_HOUSE        │    42 │ tag/bpm/disc │
    │ 04_TECHNO       │    31 │ tag/bpm      │
    │ 00_INBOX        │     3 │ —            │
    │ ...             │       │              │
    └─────────────────┴───────┴──────────────┘
    Total: 127 files. BPM analyzed: 84. Discogs lookups: 12. Cached: 71.

Source column shows which enrichment sources were used for that category.

## Build and release

### Local build

    npm run build          ← tsc → dist/
    npm run bundle         ← pkg → builds/ (all three platforms)

### package.json scripts

    "build":  "tsc",
    "bundle": "pkg dist/index.js --targets node20-win-x64,node20-macos-arm64,node20-linux-x64 --out-path builds",
    "dev":    "ts-node src/index.ts"

pkg config in package.json:

    "pkg": {
      "assets": ["node_modules/web-audio-beat-detector/**/*"],
      "scripts": ["dist/**/*.js"]
    }

WASM files from web-audio-beat-detector must be listed in assets — pkg does not
auto-bundle WASM. Check the package for .wasm file paths and add explicitly if needed.

### GitHub Actions release workflow

Trigger: push of tag matching v* (e.g. git tag v1.0.0 && git push --tags)

Steps:
    1. actions/checkout@v4
    2. actions/setup-node@v4 (node 20)
    3. npm ci
    4. npm run build
    5. npm run bundle
    6. ncipollo/release-action → upload:
           builds/dj-sort-win.exe
           builds/dj-sort-macos
           builds/dj-sort-linux

## README must include

- One-line description
- Download section with links to latest release binaries
- Setup: how to get a free Discogs token (optional)
- Usage examples: basic, --dry-run, --recursive, --no-bpm, --no-discogs
- Category table: folder → BPM range → genre keywords → Discogs styles
- How BPM detection works (one paragraph, non-technical)
- macOS Gatekeeper note: xattr -d com.apple.quarantine dj-sort-macos
- Performance note: BPM analysis takes ~1–3s per file for large libraries

## Do

- Keep all category definitions, BPM ranges, and style maps in categories.ts only
- Exit with code 0 on success, code 1 on fatal error
- Use concurrency limit: max 3 files processed in parallel (BPM is CPU-heavy)
- Save cache on exit including SIGINT handler
- Parse .env manually — no dotenv dependency (pkg bundling issues)
- Use got in CJS mode (require, not import)
- List WASM assets explicitly in pkg config
- Show a progress indicator (simple counter "Processing 45/127...") during BPM analysis

## Don't

- Don't use ESM-only packages — verify CJS compat before adding any dependency
- Don't delete files ever — only move or copy
- Don't re-analyze a file whose cache entry has matching mtime
- Don't hardcode folder names or style mappings outside categories.ts
- Don't require Node.js or Python on the end user's machine
- Don't add node_modules to release artifacts
- Don't throw on BPM detection failure — return null, fall through
- Don't throw on Discogs errors — catch, log warning, fall through to INBOX
- Don't store the token in cache file or any log

## Verification checklist (run before tagging a release)

1.  npm run build — no TypeScript errors
2.  npm run bundle — three binaries in builds/, check file sizes are reasonable
3.  --dry-run on test folder — correct category assignments printed, no files moved
4.  Normal run — files in correct subfolders
5.  Second run — 0 files moved (idempotent)
6.  File with no ID3 tags → BPM detected → correct BPM-based category
7.  File with no ID3 tags + silence/noise → BPM null → Discogs attempted → INBOX
8.  File named "loop_kick_120.wav" → 07_TOOLS (Step 1 catches it, no BPM analysis)
9.  File with duration 3600s → 08_SETS (no BPM analysis needed)
10. --no-bpm flag → BPM detection skipped, Discogs fires for untagged files
11. --no-discogs flag → no API calls made
12. Valid token + cache miss → Discogs called, result in .dj-sort-cache.json
13. Second run → cache hit for BPM and Discogs, no re-analysis, no API calls
14. Invalid/missing token → graceful degrade, no crash
15. WASM bundled correctly — binary runs on clean machine without node_modules