// A child process that reads one uploaded document, so a file that eats
// memory or hangs takes down only this process (isolatedExtraction.ts).
// Receives the file's bytes; sends progress, then the result or why it
// couldn't be read, and exits.
import { writeFileSync } from 'node:fs';
import { detectInvoiceFile } from './detectFormat';
import { UnreadableInvoiceFileError } from './parsedInvoice';
import type { WorkerMessage } from './isolatedExtraction';

// If its container runs out of memory, the kernel kills this reader rather
// than the server that started it (Linux; raising one's own score needs no
// privilege). Elsewhere there is no such file, which is fine.
try {
  writeFileSync('/proc/self/oom_score_adj', '1000');
} catch {
  // Not Linux, or no /proc.
}

// The server went away (crashed or restarted): nobody wants the result.
process.on('disconnect', () => process.exit(1));

const send = (message: WorkerMessage) =>
  new Promise<void>((resolve) => {
    process.send!(message, () => resolve());
  });

process.once('message', (bytes: Uint8Array) => {
  void (async () => {
    try {
      const parsed = await detectInvoiceFile(Buffer.from(bytes)).parse({
        onProgress: (progress) => void send({ type: 'progress', progress }),
      });
      await send({ type: 'result', parsed });
    } catch (error) {
      await send(
        error instanceof UnreadableInvoiceFileError
          ? { type: 'unreadable', message: error.fieldErrors.file ?? '' }
          : { type: 'error', message: error instanceof Error ? (error.stack ?? error.message) : String(error) },
      );
    }
    process.exit(0);
  })();
});
