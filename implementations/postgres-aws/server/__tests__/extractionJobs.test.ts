// The background extraction queue.
import { describe, expect, it, vi } from 'vitest';
import { cancelExtraction, enqueueExtraction, extractionProgress, extractionsSettled } from '../src/imports/extractionJobs';

describe('background extraction queue', () => {
  it('runs one job at a time and reports where each has got to', async () => {
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = enqueueExtraction('import-1', async (onProgress) => {
      onProgress({ stage: 'recognizing', page: 2, pages: 5 });
      await firstBlocked;
    });
    const second = enqueueExtraction('import-2', async () => undefined);
    await Promise.resolve();
    await Promise.resolve();

    expect(extractionProgress('import-1')).toEqual({ stage: 'recognizing', page: 2, pages: 5 });
    expect(extractionProgress('import-2')).toEqual({ stage: 'queued', ahead: 1 });
    releaseFirst();
    await Promise.all([first, second]);
    await extractionsSettled();
    expect(extractionProgress('import-1')).toBeUndefined();
    expect(extractionProgress('import-2')).toBeUndefined();
  });

  it('drops a cancelled job that is waiting, and tells a running one to stop', async () => {
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstSignal: AbortSignal | undefined;
    const first = enqueueExtraction('import-5', async (_onProgress, signal) => {
      firstSignal = signal;
      await firstBlocked;
    });
    const waitingWork = vi.fn(async () => undefined);
    const second = enqueueExtraction('import-6', waitingWork);
    await Promise.resolve();
    await Promise.resolve();

    cancelExtraction('import-6');
    expect(extractionProgress('import-6')).toBeUndefined();
    cancelExtraction('import-5');
    expect(firstSignal?.aborted).toBe(true);
    releaseFirst();
    await Promise.all([first, second]);
    expect(waitingWork).not.toHaveBeenCalled();
  });

  it('keeps going after a failed job', async () => {
    const failed = enqueueExtraction('import-3', async () => {
      throw new Error('boom');
    });
    const next = enqueueExtraction('import-4', async () => undefined);
    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBeUndefined();
  });
});
