import type { ImportProgress } from '../api/client';

// What's happening to a file still being read, in plain words.
export function progressText(progress: ImportProgress | null): string {
  if (!progress) {
    return 'Reading the file…';
  }
  switch (progress.stage) {
    case 'queued':
      return progress.ahead > 0
        ? `Waiting to be read: ${progress.ahead} ${progress.ahead === 1 ? 'file' : 'files'} ahead`
        : 'Waiting to be read';
    case 'reading':
      return 'Reading the file…';
    case 'recognizing':
      return `Recognizing the scanned text: page ${progress.page} of ${progress.pages}`;
    case 'model':
      return `Taking a closer look with an AI model: page ${progress.page} of ${progress.pages}`;
  }
}

// How far through its pages the current stage is (0–1); undefined when
// there's no page count to show.
export function progressFraction(progress: ImportProgress | null): number | undefined {
  if (!progress || (progress.stage !== 'recognizing' && progress.stage !== 'model')) {
    return undefined;
  }
  return (progress.page - 1) / progress.pages;
}
