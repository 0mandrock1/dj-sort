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
const HOP_SIZE   = 512;
const MIN_BPM    = 60;
const MAX_BPM    = 180;

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

  // Pass 1: raw normalized correlations for every candidate lag
  const corrs = new Float64Array(lagMax + 1);
  for (let lag = lagMin; lag <= lagMax; lag++) {
    const terms = flux.length - lag;
    let c = 0;
    for (let i = 0; i < terms; i++) c += flux[i] * flux[i + lag];
    corrs[lag] = c / terms;
  }

  // Pass 2: comb-filter score = corr(lag) + corr(2*lag)/2 + corr(3*lag)/3 + corr(4*lag)/4
  // Harmonics (multiples of lag) are often strong for periodic rhythms, and including them
  // biases toward shorter lags (higher BPM): a 126-BPM lag gets to absorb the strong
  // 63-BPM correlation as its 2nd harmonic, outscoring the bare 63-BPM candidate.
  let bestLag   = -1;
  let bestScore = -Infinity;

  for (let lag = lagMin; lag <= lagMax; lag++) {
    let score = corrs[lag];
    for (let k = 2; k <= 4; k++) {
      const harmLag = lag * k;
      if (harmLag <= lagMax) score += corrs[harmLag] / k;
    }
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }

  if (bestLag < 0 || bestScore <= 0) return null;
  return bestLag;
}

export async function detectBpm(filepath: string): Promise<number | null> {
  try {
    // Copy into a fresh ArrayBuffer so decodeAudioData can detach it safely,
    // and allow the compressed Buffer to be GC'd before PCM is allocated.
    const arrayBuffer = await fs.promises.readFile(filepath).then(
      (data) => new Uint8Array(data).buffer,
    );

    const ctx         = new OfflineAudioContext(1, 44100, 44100);
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

    const pcm  = audioBuffer.getChannelData(0);
    const flux = computeFlux(pcm);
    const fps  = audioBuffer.sampleRate / HOP_SIZE;
    const lag  = autocorrelate(flux, fps);

    if (lag === null) return null;

    return Math.round(fps * 60 / lag);
  } catch (err) {
    logger.debug(`bpm detection error for ${filepath}: ${String(err)}`);
    return null;
  }
}
