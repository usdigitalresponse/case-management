// Reads uploaded documents in a child process with a time limit and a
// JavaScript heap limit (model/rules.yaml validate_invoice_import: parse in
// isolation with time and memory limits), so a hostile or pathological file
// fails its import, not the server. Memory outside the heap (page images,
// text recognition's WebAssembly) is bounded only by the render size cap;
// a container memory limit has to cap the rest.
// INVOICE_EXTRACTION_ISOLATION=inline reads in-process instead, as the tests
// do.
import { fork } from 'node:child_process';
import { extname, join } from 'node:path';
import type { ExtractionProgress } from './extractors/types';
import { UnreadableInvoiceFileError, type ParsedInvoice } from './parsedInvoice';

// The reader's JavaScript heap peaked under 20 MB on a 12-page scan; nearly
// all its memory is recognition's and page images', which the container
// limit bounds (docker-compose.prod.yml). This only stops runaway scripts.
const DEFAULT_MEMORY_LIMIT_MB = 512;
// A value this small is almost certainly a typo (e.g. one meant in GB), and
// would leave readers too little to load PDF.js.
const MIN_MEMORY_LIMIT_MB = 64;

export function memoryLimitMb(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.INVOICE_EXTRACTION_MEMORY_MB);
  if (!Number.isInteger(configured) || configured <= 0) {
    return DEFAULT_MEMORY_LIMIT_MB;
  }
  if (configured < MIN_MEMORY_LIMIT_MB) {
    // eslint-disable-next-line no-console
    console.error(`INVOICE_EXTRACTION_MEMORY_MB=${configured} is below ${MIN_MEMORY_LIMIT_MB} MB; using ${DEFAULT_MEMORY_LIMIT_MB}.`);
    return DEFAULT_MEMORY_LIMIT_MB;
  }
  return configured;
}
// Generous for a 50-page scan through recognition on a small server.
const TIME_LIMIT_MS = 60 * 60 * 1000;

export type WorkerMessage =
  | { type: 'progress'; progress: ExtractionProgress }
  | { type: 'result'; parsed: ParsedInvoice }
  | { type: 'unreadable'; message: string }
  | { type: 'error'; message: string };

// The TypeScript loader flags a development server runs with (tsx), so the
// child can load the same sources; compiled builds have none.
function loaderFlags(): string[] {
  const flags: string[] = [];
  for (let index = 0; index < process.execArgv.length; index += 1) {
    const flag = process.execArgv[index]!;
    if (['--require', '--import', '--loader', '-r'].includes(flag) && index + 1 < process.execArgv.length) {
      flags.push(flag, process.execArgv[index + 1]!);
      index += 1;
    }
  }
  return flags;
}

export function isolationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.INVOICE_EXTRACTION_ISOLATION !== 'inline';
}

// The read was stopped because its import was discarded.
export class ExtractionCancelledError extends Error {
  constructor() {
    super('Extraction cancelled.');
  }
}

export function parseIsolated(
  bytes: Buffer,
  onProgress: (progress: ExtractionProgress) => void,
  limits: { memoryMb?: number; timeMs?: number; execArgv?: string[]; signal?: AbortSignal } = {},
): Promise<ParsedInvoice> {
  if (limits.signal?.aborted) {
    return Promise.reject(new ExtractionCancelledError());
  }
  return new Promise((resolve, reject) => {
    // Beside this file, as .ts from the sources or .js from a build.
    const child = fork(join(__dirname, `extractionWorker${extname(__filename)}`), [], {
      execArgv: [...(limits.execArgv ?? loaderFlags()), `--max-old-space-size=${limits.memoryMb ?? memoryLimitMb()}`],
      serialization: 'advanced',
    });
    let settled = false;
    const finish = (outcome: () => void) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        limits.signal?.removeEventListener('abort', cancel);
        outcome();
      }
    };
    const cancel = () => {
      finish(() => reject(new ExtractionCancelledError()));
      child.kill('SIGKILL');
    };
    limits.signal?.addEventListener('abort', cancel);
    const timer = setTimeout(() => {
      finish(() => reject(new UnreadableInvoiceFileError('Reading this file took too long. Enter the items by hand instead.')));
      child.kill('SIGKILL');
    }, limits.timeMs ?? TIME_LIMIT_MS);
    child.on('message', (message: WorkerMessage) => {
      if (message.type === 'progress') {
        onProgress(message.progress);
      } else if (message.type === 'result') {
        finish(() => resolve(message.parsed));
      } else if (message.type === 'unreadable') {
        finish(() => reject(new UnreadableInvoiceFileError(message.message)));
      } else {
        finish(() => reject(new Error(`Extraction failed in its process: ${message.message}`)));
      }
    });
    child.on('error', (error) => finish(() => reject(error)));
    // Out of memory or killed before answering. 'close' comes after every
    // message, where 'exit' can overtake the last one.
    child.on('close', (code, signal) =>
      finish(() =>
        reject(
          new UnreadableInvoiceFileError(
            `This file couldn’t be read within the allowed memory (the reader stopped: ${signal ?? `exit ${code}`}). Enter the items by hand instead.`,
          ),
        ),
      ),
    );
    child.send(new Uint8Array(bytes));
  });
}
