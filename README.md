# dj-sort

Organizes audio files into DJ-friendly subfolders by BPM, genre tags, and Discogs metadata. Runs as a standalone binary — no Node.js required.

## Output folders

| Folder | Criteria |
|---|---|
| `00_INBOX` | No match found |
| `01_WARMUP` | 60–100 BPM / ambient, downtempo, chill |
| `02_GROOVES` | 100–122 BPM / funk, disco, nu-disco |
| `03_HOUSE` | 122–128 BPM / house, deep house, tech house |
| `04_TECHNO` | 128–150 BPM / techno, industrial, hard techno |
| `05_BREAKS_DnB` | 150–180 BPM / breakbeat, jungle, drum & bass |
| `06_EXPERIMENTAL` | Any BPM / IDM, noise, abstract |
| `07_TOOLS` | Filename: loop, acap, intro, outro, fx, stem, vox |
| `08_SETS` | Duration > 30 min or filename: mix, set, podcast, episode |

## Classifier pipeline

1. **Filename keywords** → TOOLS or SETS (no I/O)
2. **Tags** — duration → SETS, genre → category
3. **BPM detection** — autocorrelation on PCM energy flux (comb filter)
4. **Discogs API** — style lookup when genre tag is absent or unrecognised
5. **Fallback** → INBOX

## Usage

```
dj-sort <path> [options]

Options:
  --copy          Copy files instead of moving
  --recursive     Scan subdirectories
  --dry-run       Show what would happen without moving anything
  --no-bpm        Skip BPM detection
  --no-discogs    Skip Discogs API lookups
  --token <t>     Discogs API token
  --log           Write organize.log in the source folder
  -V, --version   Show version
  -h, --help      Show help
```

### Discogs token

Priority order:
1. `--token <value>` CLI flag
2. `DISCOGS_TOKEN` environment variable
3. `.env` file in the source folder: `DISCOGS_TOKEN=your_token`

No token → Discogs step is skipped, everything else still works.

### Examples

```bash
# Dry run first
dj-sort /Volumes/USB/tracks --dry-run

# Move files, scan subdirs
dj-sort /Volumes/USB/tracks --recursive

# Copy instead of move, write log
dj-sort /Volumes/USB/tracks --copy --log

# Skip heavy BPM analysis, rely on tags + Discogs only
dj-sort /Volumes/USB/tracks --no-bpm --token abc123
```

## Caching

Cache file: `<source_folder>/.dj-sort-cache.json`

- **BPM** — cached by `filepath + mtime`. Re-analyzed only if file changes.
- **Discogs** — cached by `artist + title`, TTL 30 days.
- Second run on the same folder is instant.

## Formats

`.mp3` `.flac` `.wav` `.aiff` `.ogg` `.m4a` `.aac`

## Install

Download the binary for your platform from [Releases](../../releases):

| Platform | File |
|---|---|
| Windows | `dj-sort-win.exe` |
| macOS (Apple Silicon) | `dj-sort-macos` |
| Linux | `dj-sort-linux` |

macOS/Linux — make executable first:
```bash
chmod +x dj-sort-macos
./dj-sort-macos /path/to/tracks --dry-run
```

> **Note:** This is a CLI tool — double-clicking the binary will flash a window and close immediately.
> To use it, open a terminal and pass the folder path as an argument (see Usage above).
> Alternatively, create a `.bat` file next to the exe for quick launches:
> ```bat
> @echo off
> dj-sort-win.exe "%~dp0tracks"
> pause
> ```
> Drop your audio files into a `tracks` folder next to the `.bat`, then double-click it.

## Build from source

```bash
npm install
npm run build          # TypeScript → dist/
npm run bundle:win     # Windows exe → builds/dj-sort-win.exe
```

Requires Node.js 20+. Standalone binaries are built with [@yao-pkg/pkg](https://github.com/yao-pkg/pkg).
