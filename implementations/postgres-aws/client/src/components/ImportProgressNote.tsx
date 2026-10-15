import type { ImportProgress } from '../api/client';
import { progressFraction, progressText } from '../portal/importProgress';

// A file still being read: what's happening, and a bar when pages are counted.
export function ImportProgressNote({ progress, compact = false }: { progress: ImportProgress | null; compact?: boolean }) {
  const fraction = progressFraction(progress);
  const label = progressText(progress);
  return (
    <div className={compact ? 'import-progress import-progress-compact' : 'import-progress'} role="status" aria-live="polite">
      <span>{label}</span>
      {fraction === undefined ? <progress aria-label={label} /> : <progress aria-label={label} max={1} value={fraction} />}
      {!compact && progress?.stage === 'model' && (
        <p className="compact-hint">
          The quick reading didn't add up, so an AI model is reading the page images. This can take a minute or more a
          page; you can leave this page and come back.
        </p>
      )}
      {!compact && progress?.stage === 'recognizing' && (
        <p className="compact-hint">This file is a scan, so its text is being recognized page by page.</p>
      )}
    </div>
  );
}
