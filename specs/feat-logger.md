# logger.ts — Console + File Logger

**Status:** Approved  
**Date:** 2026-04-16

## Overview

`logger.ts` provides a single logger instance used by all modules. It writes to stdout/stderr and optionally appends to `organize.log` in the source folder when `--log` is passed.

## Goals

- `info`, `warn`, `error`, `debug` log levels
- Always write to console (stdout for info/debug, stderr for warn/error)
- When file logging is enabled, append all levels to `organize.log`
- `init(opts)` call to configure log file path and enable/disable file output
- Token-safe: caller is responsible for not passing tokens; logger does no scrubbing

## Non-Goals

- Log rotation
- Structured JSON logging
- Colorized output (keep it simple for binary portability)

## API

```typescript
export interface LoggerOptions {
  logFile?: string;   // absolute path to organize.log; undefined = no file output
}

export function initLogger(opts: LoggerOptions): void;

export const logger: {
  info:  (msg: string) => void;
  warn:  (msg: string) => void;
  error: (msg: string) => void;
  debug: (msg: string) => void;
};
```

## Behavior

- `initLogger` must be called before any log method; default is console-only
- File writes are synchronous (`fs.appendFileSync`) — logger is used in SIGINT handler
- Each line: `[LEVEL] message\n`
- `debug` lines go to console only (not to file), to keep the log file clean

## Implementation

```typescript
import * as fs from 'fs';

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
```

## Testing Strategy

- `initLogger` with no logFile → writes to console, no file created
- `initLogger` with logFile → file contains INFO/WARN/ERROR lines
- `debug` → not written to file
- Multiple calls → lines appended, not overwritten
