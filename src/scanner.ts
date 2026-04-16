import * as fs from 'fs';
import * as path from 'path';
import { AUDIO_EXTENSIONS, FOLDER } from './categories';
import { logger } from './logger';

const OUTPUT_FOLDERS = new Set(Object.values(FOLDER));

export async function scanFiles(rootDir: string, recursive: boolean): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.promises.readdir(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      if (OUTPUT_FOLDERS.has(entry.name)) {
        logger.debug(`Skipping output folder: ${fullPath}`);
        continue;
      }
      if (recursive) {
        const nested = await scanFiles(fullPath, true);
        results.push(...nested);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (AUDIO_EXTENSIONS.includes(ext)) {
        results.push(fullPath);
      }
    }
  }

  return results;
}
