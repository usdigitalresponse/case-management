// Slow extractions (scans, the vision model) run in the background, one at a
// time so they don't compete for the processor, and report where they are
// for the uploader's screen. Jobs live in this process: an import left
// received by a restart is failed on startup (failInterruptedExtractions in
// invoiceImports.ts), so this needs a single server instance.
import type { ExtractionProgress } from './extractors/types';

export type ImportProgress = ExtractionProgress | { stage: 'queued'; ahead: number };

const waiting: string[] = [];
const running = new Map<string, ExtractionProgress>();
const controllers = new Map<string, AbortController>();
let queue: Promise<void> = Promise.resolve();

function leaveQueue(importId: string) {
  const index = waiting.indexOf(importId);
  if (index >= 0) {
    waiting.splice(index, 1);
  }
}

// `signal` aborts when the import is discarded (cancelExtraction); a job
// cancelled while waiting never starts.
export function enqueueExtraction(
  importId: string,
  work: (onProgress: (progress: ExtractionProgress) => void, signal: AbortSignal) => Promise<void>,
): Promise<void> {
  const controller = new AbortController();
  controllers.set(importId, controller);
  waiting.push(importId);
  const job = queue.then(async () => {
    leaveQueue(importId);
    if (controller.signal.aborted) {
      return;
    }
    running.set(importId, { stage: 'reading' });
    try {
      await work((progress) => running.set(importId, progress), controller.signal);
    } finally {
      running.delete(importId);
      controllers.delete(importId);
    }
  });
  queue = job.catch(() => undefined);
  return job;
}

// Stops a discarded import's read: dropped from the queue, or told to stop.
export function cancelExtraction(importId: string): void {
  leaveQueue(importId);
  controllers.get(importId)?.abort();
  controllers.delete(importId);
}

// Undefined when no job is waiting or running for the import.
export function extractionProgress(importId: string): ImportProgress | undefined {
  const progress = running.get(importId);
  if (progress) {
    return progress;
  }
  const index = waiting.indexOf(importId);
  return index < 0 ? undefined : { stage: 'queued', ahead: index + running.size };
}

// Resolves once every job queued so far has finished (tests, shutdown).
export function extractionsSettled(): Promise<void> {
  return queue;
}
