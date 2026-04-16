# dj-sort

CLI tool: scans audio folder → categorizes into DJ-friendly subfolders by BPM,
genre tags, filename keywords, Discogs API. Output lives on USB flash drive.
Distributed as standalone binaries via GitHub Releases (no Node.js required).

## Reading rules

- Read only the file(s) relevant to the current task
- For any classification/category question: read categories.ts ONLY
- For API/token questions: read discogs.ts ONLY
- For build/bundle questions: read package.json ONLY
- Never read all src/ files at once
- Use /code-search before reading a full file to locate the relevant section
- Load CLAUDE.md once at session start — do not re-read it

## Agents

    typescript-expert     → all src/ implementation
    code-review-expert    → after each module is complete
    research-expert       → before adding any npm package
    security-auditor      → discogs.ts + cache.ts + .env parsing (token safety)
    documentation-expert  → README.md after implementation

## Commands

    /spec:create          before implementing each module
    /spec:execute         implement from spec
    /code-review          after each module
    /validate-and-fix     after full build
    /checkpoint:create    after each working module + before risky refactors
    /research             before any new dependency or audio-decode strategy

## Build order

    categories.ts → logger.ts → scanner.ts → metadata.ts →
    bpm.ts → cache.ts → discogs.ts → classifier.ts → mover.ts → index.ts

    /checkpoint:create after each. /code-review after bpm.ts, classifier.ts, index.ts.

## Structure

    src/
      index.ts        CLI entry (commander)
      scanner.ts      file discovery
      classifier.ts   orchestrates steps 1–5 → category
      metadata.ts     ID3/FLAC tags via music-metadata
      bpm.ts          BPM detection via web-audio-beat-detector + audio-decode
      discogs.ts      Discogs API → styles[]
      mover.ts        move / copy / dry-run
      logger.ts       console + .log file
      cache.ts        JSON cache: BPM by filepath+mtime, Discogs by artist|title
      categories.ts   ← SINGLE SOURCE OF TRUTH for all folder names, BPM ranges,
                         genre keywords, Discogs style map

## Output folders

    00_INBOX        no BPM, no genre, no Discogs match
    01_WARMUP       60–100 BPM  | ambient, downtempo, chill
    02_GROOVES      100–122 BPM | funk, disco, nu-disco
    03_HOUSE        122–128 BPM | house, deep house, tech house
    04_TECHNO       128–150 BPM | techno, industrial, hard techno
    05_BREAKS_DnB   150–180 BPM | breakbeat, jungle, dnb
    06_EXPERIMENTAL any BPM     | IDM, noise, abstract
    07_TOOLS        filename keywords: loop acap intro outro fx stem vox
    08_SETS         duration > 1800s OR filename: mix set podcast episode

## Classifier pipeline (classifier.ts)

    1. filename keywords → TOOLS or SETS (no I/O)
    2. metadata.ts: duration → SETS | genre → category | store BPM tag
    3. bpm.ts: if no BPM tag → detect → category by range | null on failure
    4. discogs.ts: if no genre AND (no BPM OR needs context) → API lookup
    5. → INBOX

## BPM detection (bpm.ts)

    const { analyze } = require('web-audio-beat-detector')
    const decode = require('audio-decode')
    const buf = await fs.readFile(filepath)
    const bpm = await analyze(await decode(buf))  // → number | throws

Catch all errors → return null. WASM must be in pkg assets (see package.json).
If audio-decode has ESM issues → fallback: node-web-audio-api.
Run /research before finalizing decode strategy.

## Discogs (discogs.ts)

    GET https://api.discogs.com/database/search?artist=&track=&type=release&per_page=1
    Authorization: Discogs token=<DISCOGS_TOKEN>
    User-Agent: dj-sort/1.0 +https://github.com/<user>/dj-sort

Throttle: 1 req/sec. On 429: wait 2s, retry once, skip.
Token never appears in logs, cache, or organize.log. /security-auditor required.

Token resolution: --token flag → DISCOGS_TOKEN env → .env (manual parse, no dotenv)
No token → skip Discogs entirely, log info.

## Discogs style map (define in categories.ts)

    Techno / Industrial / Hard Techno / EBM      → TECHNO
    House / Deep House / Tech House / Progressive → HOUSE
    Disco / Nu-Disco / Funk / Soul               → GROOVES
    Drum n Bass / Jungle / Breakbeat / Breaks    → BREAKS_DnB
    Ambient / Downtempo / Chillout / Trip Hop    → WARMUP
    IDM / Experimental / Noise / Abstract        → EXPERIMENTAL

## Cache (cache.ts)

File: <source_folder>/.dj-sort-cache.json
Load on start, save on exit + SIGINT.

    bpm:     "<filepath>|<mtime_ms>" → { bpm: number|null }     no TTL
    discogs: "<artist>|<title>"      → { category: string }     TTL 30d

## CLI

    dj-sort <path> [--copy] [--recursive] [--dry-run]
                   [--no-bpm] [--no-discogs] [--token <t>]
                   [--log] [--help] [--version]

Formats: .mp3 .flac .wav .aiff .ogg .m4a .aac
Idempotent: files already in a target subfolder are skipped.
Concurrency: max 3 parallel (BPM is CPU-heavy).
Progress: "Processing 45/127..." during BPM analysis.

## Summary output

    ┌─────────────────┬───────┬──────────────┐
    │ Category        │ Files │ Source       │
    ├─────────────────┼───────┼──────────────┤
    │ 03_HOUSE        │    42 │ tag/bpm/disc │
    │ 00_INBOX        │     3 │ —            │
    └─────────────────┴───────┴──────────────┘
    Total: 127. BPM analyzed: 84. Discogs: 12. Cached: 71.

## Build

    package.json scripts:
      "build":  "tsc"
      "bundle": "pkg dist/index.js --targets node20-win-x64,node20-macos-arm64,node20-linux-x64 --out-path builds"
      "dev":    "ts-node src/index.ts"

    pkg config:
      "pkg": { "assets": ["node_modules/web-audio-beat-detector/**/*"] }

    Release trigger: git tag v* → GitHub Actions:
      npm ci → build → bundle → ncipollo/release-action uploads:
        dj-sort-win.exe / dj-sort-macos / dj-sort-linux

## Do

- All constants, ranges, maps → categories.ts only
- Exit 0 success / 1 fatal
- /checkpoint:create before touching classifier.ts or cache.ts
- Dry-run: show per-file source tag [tag] [bpm:124] [discogs:House]

## Don't

- Don't use ESM-only packages → /research first
- Don't delete files
- Don't re-analyze files with cached mtime
- Don't hardcode anything outside categories.ts
- Don't let errors in bpm/discogs propagate — catch → fall through
- Don't expose token anywhere

## Checklist (before tagging release)

    /validate-and-fix → then:

    [ ] build — zero TS errors
    [ ] bundle — 3 binaries in builds/
    [ ] --dry-run — correct assignments, no moves
    [ ] normal run — correct subfolders
    [ ] second run — 0 files moved
    [ ] no ID3 → BPM detected → correct category
    [ ] no ID3 + silence → INBOX
    [ ] "loop_kick.wav" → 07_TOOLS (no BPM analysis)
    [ ] duration 3600s → 08_SETS
    [ ] --no-bpm → Discogs fires for untagged
    [ ] --no-discogs → zero API calls
    [ ] second run → cache hit, no re-analysis
    [ ] missing token → graceful degrade
    [ ] binary runs without node_modules
    [ ] token absent from all logs ← security-auditor sign-off