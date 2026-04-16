import { parseFile } from 'music-metadata';
import { logger } from './logger';

export interface AudioMetadata {
  durationSeconds: number | null;
  genre: string | null;
  bpm: number | null;
  artist: string | null;
  title: string | null;
}

const EMPTY: AudioMetadata = {
  durationSeconds: null,
  genre: null,
  bpm: null,
  artist: null,
  title: null,
};

export async function readMetadata(filepath: string): Promise<AudioMetadata> {
  try {
    const { common, format } = await parseFile(filepath, { duration: true });

    const bpmRaw = common.bpm;
    const bpm = typeof bpmRaw === 'number' && isFinite(bpmRaw) ? bpmRaw : null;

    return {
      durationSeconds: format.duration ?? null,
      genre: common.genre?.[0]?.toLowerCase() ?? null,
      bpm,
      artist: common.artist ?? null,
      title: common.title ?? null,
    };
  } catch (err) {
    logger.debug(`metadata error for ${filepath}: ${String(err)}`);
    return { ...EMPTY };
  }
}
