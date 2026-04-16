import * as fs from 'fs';
import * as path from 'path';
import { Category, FOLDER } from './categories';
import { logger } from './logger';

export interface MoveOptions {
  copy:   boolean;
  dryRun: boolean;
}

function buildSourceTag(source: string, bpm?: number): string {
  if (source === 'bpm' && bpm !== undefined) return `[bpm:${bpm}]`;
  if (source === 'tag')      return '[tag]';
  if (source === 'discogs')  return '[discogs]';
  if (source === 'filename') return '[filename]';
  return '[inbox]';
}

export async function moveFile(
  filepath: string,
  category: Category,
  rootDir: string,
  opts: MoveOptions,
  source: string,
  bpm?: number,
): Promise<void> {
  try {
    const destDir  = path.join(rootDir, FOLDER[category]);
    const destPath = path.join(destDir, path.basename(filepath));

    if (filepath === destPath) {
      logger.debug(`already in place: ${path.basename(filepath)}`);
      return;
    }

    if (opts.dryRun) {
      const tag = buildSourceTag(source, bpm);
      logger.info(`[DRY-RUN] ${path.basename(filepath)} → ${FOLDER[category]} ${tag}`);
      return;
    }

    await fs.promises.mkdir(destDir, { recursive: true });

    if (opts.copy) {
      await fs.promises.copyFile(filepath, destPath);
    } else {
      try {
        await fs.promises.rename(filepath, destPath);
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
          await fs.promises.copyFile(filepath, destPath);
          await fs.promises.unlink(filepath);
        } else {
          throw err;
        }
      }
    }

    logger.info(`${path.basename(filepath)} → ${FOLDER[category]}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`failed to move ${filepath}: ${msg}`);
  }
}
