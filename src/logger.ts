import * as fs from 'fs';

export interface LoggerOptions {
  logFile?: string;
}

let logFilePath: string | undefined;

function write(level: string, msg: string, toFile: boolean): void {
  const line = `[${level}] ${msg}`;
  if (level === 'ERROR' || level === 'WARN') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
  if (toFile && logFilePath) {
    fs.appendFileSync(logFilePath, line + '\n');
  }
}

export function initLogger(opts: LoggerOptions): void {
  logFilePath = opts.logFile;
}

export const logger = {
  info:  (msg: string) => write('INFO',  msg, true),
  warn:  (msg: string) => write('WARN',  msg, true),
  error: (msg: string) => write('ERROR', msg, true),
  debug: (msg: string) => write('DEBUG', msg, false),
};
