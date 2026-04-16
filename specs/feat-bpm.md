# bpm.ts — BPM Detection

**Status:** Approved  
**Date:** 2026-04-16

## Overview

`bpm.ts` detects the BPM of an audio file using `node-web-audio-api` for decoding and a
pure-TypeScript autocorrelation algorithm for tempo estimation. Returns `number | null`.

## Background / Decision Record

The original CLAUDE.md spec called for `web-audio-beat-detector` + `audio-decode`.
Research revealed both are unusable in a Node.js + `pkg` binary context:

- `audio-decode` (v2 and v3): ESM-only; `require()` throws `ERR_REQUIRE_ESM`;
  dynamic `import()` is broken inside `pkg` binaries (pkg archived, issue #1603).
- `web-audio-beat-detector`: CJS bundle exists, but internally calls `new Worker(url)`
  (browser Web Worker API); throws `ReferenceError: Worker is not defined` in Node.js.
- `bpm-detective`: CJS format, but references `window.OfflineAudioContext`; throws
  `ReferenceError: window is not defined` in Node.js.

**Chosen approach:** `node-web-audio-api` (Rust-backed, CJS dual-export, supports all
required formats) for decoding + inline autocorrelation algorithm for BPM detection.
No additional npm dependency required.

## Goals

- `detectBpm(filepath): Promise<number | null>`
- Decode audio to PCM via `node-web-audio-api`'s `OfflineAudioContext.decodeAudioData()`
- Detect BPM via onset-flux autocorrelation (range: 60–180 BPM)
- Catch all errors → return `null` (never propagate)
- Work inside a `pkg` binary (pkg assets: `node_modules/node-web-audio-api/prebuilds/**/*`)

## Non-Goals

- Sub-beat precision (integer BPM is sufficient for folder categorization)
- Time-signature detection
- Variable-tempo handling

## API

```typescript
export async function detectBpm(filepath: string): Promise<number | null>;
```

## Algorithm

### Step 1 — Decode
```typescript
const { OfflineAudioContext } = require('node-web-audio-api');
const data = await fs.readFile(filepath);
const ctx = new OfflineAudioContext(1, 1, 44100); // dummy; real length filled by decodeAudioData
const audioBuffer = await ctx.decodeAudioData(data.buffer.slice(
  data.byteOffset, data.byteOffset + data.byteLength
));
```

### Step 2 — Compute energy flux (onset strength)
Frame the mono channel into overlapping windows, compute RMS energy per frame,
then take the positive energy difference between consecutive frames (spectral flux):

```
frameSize = 1024 samples
hopSize   = 512  samples
flux[i]   = max(0, rms[i] - rms[i-1])
```

### Step 3 — Autocorrelation over BPM range
Convert BPM range [60, 180] to lag range in frames:
```
fps     = sampleRate / hopSize
lagMin  = round(fps * 60 / 180)
lagMax  = round(fps * 60 / 60)
```
Find lag with maximum autocorrelation of the flux signal:
```
corr(lag) = Σ flux[i] * flux[i + lag]
```

### Step 4 — Harmonic correction
The detected lag may correspond to a half- or double-time harmonic.
Check if 2× the detected BPM is in [60, 180] and has a higher correlation;
prefer the doubled value if so (avoids locking onto half-tempo).

### Step 5 — Return
```
bpm = round(fps * 60 / bestLag)
```
Return `null` if no lag was found, audio is silent, or decoding threw.

## pkg asset config
```json
"pkg": {
  "assets": ["node_modules/node-web-audio-api/prebuilds/**/*"]
}
```

## Implementation

```typescript
import * as fs from 'fs';
import { logger } from './logger';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { OfflineAudioContext } = require('node-web-audio-api') as {
  OfflineAudioContext: new (channels: number, length: number, sampleRate: number) => {
    decodeAudioData(buffer: ArrayBuffer): Promise<{
      sampleRate: number;
      getChannelData(channel: number): Float32Array;
    }>;
  };
};

const FRAME_SIZE = 1024;
const HOP_SIZE  = 512;
const MIN_BPM   = 60;
const MAX_BPM   = 180;

function computeFlux(pcm: Float32Array): number[] {
  const flux: number[] = [0];
  let prevRms = 0;
  for (let i = 0; i + FRAME_SIZE < pcm.length; i += HOP_SIZE) {
    let sum = 0;
    for (let j = 0; j < FRAME_SIZE; j++) sum += pcm[i + j] ** 2;
    const rms = Math.sqrt(sum / FRAME_SIZE);
    flux.push(Math.max(0, rms - prevRms));
    prevRms = rms;
  }
  return flux;
}

function autocorrelate(flux: number[], fps: number): number | null {
  const lagMin = Math.round(fps * 60 / MAX_BPM);
  const lagMax = Math.round(fps * 60 / MIN_BPM);

  let bestLag = -1;
  let bestCorr = -Infinity;

  for (let lag = lagMin; lag <= lagMax; lag++) {
    let corr = 0;
    for (let i = 0; i + lag < flux.length; i++) corr += flux[i] * flux[i + lag];
    if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
  }

  if (bestLag < 0 || bestCorr <= 0) return null;

  // Harmonic correction: prefer double-time if it scores higher
  const halfLag = Math.round(bestLag / 2);
  if (halfLag >= lagMin) {
    let halfCorr = 0;
    for (let i = 0; i + halfLag < flux.length; i++) halfCorr += flux[i] * flux[i + halfLag];
    if (halfCorr > bestCorr * 0.9) bestLag = halfLag;
  }

  return bestLag;
}

export async function detectBpm(filepath: string): Promise<number | null> {
  try {
    const data = await fs.promises.readFile(filepath);
    const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);

    // OfflineAudioContext length is a placeholder; decodeAudioData returns full buffer
    const ctx = new OfflineAudioContext(1, 44100, 44100);
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer as ArrayBuffer);

    const pcm   = audioBuffer.getChannelData(0);
    const flux  = computeFlux(pcm);
    const fps   = audioBuffer.sampleRate / HOP_SIZE;
    const lag   = autocorrelate(flux, fps);

    if (lag === null) return null;

    return Math.round(fps * 60 / lag);
  } catch (err) {
    logger.debug(`bpm detection error for ${filepath}: ${String(err)}`);
    return null;
  }
}
```

## Testing Strategy

- Silent file → returns null (bestCorr ≤ 0)
- 120 BPM synthetic signal → returns value within ±5 BPM of 120
- Corrupt / non-audio file → returns null, no throw
- File read error → returns null, no throw
- BPM outside 60–180 range signal → returns null
