# Project Scaffold: package.json + tsconfig.json

**Status:** Approved  
**Date:** 2026-04-16

## Overview

Bootstrap the dj-sort TypeScript CLI project with `package.json`, `tsconfig.json`, and the `src/` directory structure. This is the prerequisite for all subsequent module implementations.

## Goals

- Declare all runtime and dev dependencies
- Configure TypeScript for Node.js 20 + CommonJS output (required by `pkg` bundler)
- Wire up `build`, `bundle`, and `dev` scripts per CLAUDE.md
- Define `pkg` asset inclusions (WASM for `web-audio-beat-detector`)
- Create empty placeholder files for each module so TypeScript resolves imports

## Non-Goals

- Implementing any module logic
- GitHub Actions CI workflow (separate concern)
- `.env` or config files

## Dependencies

| Package | Role | Notes |
|---|---|---|
| `commander` | CLI arg parsing | CJS-compatible |
| `music-metadata` | ID3/FLAC tag reading | CJS-compatible |
| `web-audio-beat-detector` | BPM analysis (WASM) | assets must be bundled |
| `audio-decode` | AudioBuffer from file | may have ESM issues — fallback to `node-web-audio-api` |
| `node-web-audio-api` | Fallback decode | CJS-compatible |
| `typescript` | Compiler | devDep |
| `ts-node` | Dev runner | devDep |
| `@types/node` | Node typings | devDep |
| `pkg` | Binary bundler | devDep |

## package.json Design

```json
{
  "name": "dj-sort",
  "version": "0.1.0",
  "description": "Organizes audio files into DJ-friendly subfolders",
  "main": "dist/index.js",
  "bin": { "dj-sort": "dist/index.js" },
  "scripts": {
    "build": "tsc",
    "bundle": "pkg dist/index.js --targets node20-win-x64,node20-macos-arm64,node20-linux-x64 --out-path builds",
    "dev": "ts-node src/index.ts"
  },
  "pkg": {
    "assets": ["node_modules/web-audio-beat-detector/**/*"]
  },
  "license": "MIT"
}
```

## tsconfig.json Design

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "moduleResolution": "node",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

Key choices:
- `"module": "CommonJS"` — required by `pkg`; prevents ESM-only package failures
- `"esModuleInterop": true` — allows `import x from 'x'` for CJS packages
- `"strict": true` — enforced across all modules
- `"resolveJsonModule": true` — needed for reading package version at runtime

## src/ Placeholder Files

Create empty-but-valid stubs so TypeScript doesn't error on cross-imports:

```
src/index.ts
src/categories.ts
src/logger.ts
src/scanner.ts
src/metadata.ts
src/bpm.ts
src/cache.ts
src/discogs.ts
src/classifier.ts
src/mover.ts
```

Each stub: `export {}` (valid TS module, no logic).

## .gitignore

```
node_modules/
dist/
builds/
*.log
.dj-sort-cache.json
.env
```

## Validation

- `npm install` completes without errors
- `npm run build` compiles (stubs only — zero TS errors)
- `npm run dev -- --help` exits without crash (commander not yet wired, but file resolves)

## Open Questions

- `audio-decode` ESM compatibility: run `/research` before implementing `bpm.ts`
- `pkg` version: verify it supports `node20` targets before `bundle` step
