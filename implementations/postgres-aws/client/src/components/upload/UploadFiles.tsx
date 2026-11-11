// Files chosen to upload: the drop zone, each file's card and the reads behind them.
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { apiErrorMessage, deleteInvoice, discardUpload, getUpload, startUpload, type UploadRead } from '../../api/client';
import { ImportProgressNote } from '../ImportProgressNote';
import { countOf } from '../../portal/importProgress';
import { Tag } from '../ui/Tag';
import { buttonClass } from '../ui/Button';

export interface Entry<D> {
  key: string;
  file: File;
  uploadReadId?: string;
  read?: UploadRead;
  // Couldn't be sent or read; it is skipped.
  error?: string;
  details?: D;
  created?: { invoiceImportId: string; invoiceId: string };
}

function fileBadge(name: string): string {
  const extension = name.split('.').pop()?.toUpperCase() ?? '';
  return ['PDF', 'XLSX', 'XLS', 'CSV'].includes(extension) ? extension : 'FILE';
}

function fileSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// A reviewer's own upload goes straight into their review, so there is
// nothing to send.
export function Steps({ reviewing = false }: { reviewing?: boolean }) {
  const steps = reviewing ? ['Upload', 'Check and review the lines', 'Finish the review'] : ['Upload', 'Check the lines', 'Send for review'];
  return (
    <ol className="tag-steps" aria-label="Steps">
      {steps.map((step, index) => (
        <li key={step} aria-current={index === 0 ? 'step' : undefined}>
          <Tag tone={index === 0 ? 'strong' : 'neutral'}>{index + 1} {step}</Tag>
        </li>
      ))}
    </ol>
  );
}

// Files dropped elsewhere (Intake), or manual entry, to start with.
export interface UploadStart {
  files?: File[];
  manual?: boolean;
}

export function DropZone({ hasFiles, onFiles }: { hasFiles: boolean; onFiles: (files: File[]) => void }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const drop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    onFiles([...event.dataTransfer.files]);
  };
  return (
    <label
      className={`drop-zone${over ? ' drop-zone--over' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <input
        ref={input}
        className="usa-sr-only"
        type="file"
        multiple
        accept=".pdf,.xlsx,.xls,.csv,.txt,.ledes"
        onChange={(event) => {
          onFiles([...(event.target.files ?? [])]);
          event.target.value = '';
        }}
      />
      <strong>{hasFiles ? 'Drop more invoice files here, or choose files' : 'Drop invoice files here, or choose files'}</strong>
      <span>PDF, LEDES 1998B, Excel (.xlsx) or CSV. One invoice per file, up to 10 MB each.</span>
      {/* The label opens the file picker; this only looks like the design's button. */}
      <span className={buttonClass('secondary')} aria-hidden="true">Choose files</span>
    </label>
  );
}

export function FileCard({
  entry,
  position,
  total,
  current,
  onRemove,
}: {
  entry: Entry<unknown>;
  position: number;
  total: number;
  current: boolean;
  onRemove?: () => void;
}) {
  const read = entry.read;
  const size = read?.file.sizeBytes ?? entry.file.size;
  const meta = [read?.file.format === 'spreadsheet' ? 'Spreadsheet' : null, fileSize(size)].filter(Boolean).join(' · ');
  const many = total > 1;
  let status;
  if (entry.created) {
    status = (
      <>
        <span className="file-card__ok">✓ Imported</span>
        {many && <span>Invoice {countOf(position, total)}</span>}
      </>
    );
  } else if (entry.error || read?.status === 'failed') {
    status = <span className="file-card__error">{entry.error ?? (read?.status === 'failed' ? read.failureMessage : '')}</span>;
  } else if (read?.status === 'ready') {
    status = (
      <>
        <span className={current || !many ? 'file-card__ok' : undefined}>
          Read: {read.read.lineCount} {read.read.lineCount === 1 ? 'line' : 'lines'} found
        </span>
        {many && (
          <span className={current ? 'file-card__current' : undefined}>
            Invoice {countOf(position, total)} · {current ? 'checking now' : 'next'}
          </span>
        )}
      </>
    );
  } else {
    status = <ImportProgressNote compact progress={read?.status === 'reading' ? read.progress : null} />;
  }
  return (
    <li className={`card file-card${current && many ? ' file-card--current' : ''}`}>
      <span className="file-card__badge" aria-hidden="true">{fileBadge(entry.file.name)}</span>
      <span className="file-card__name">
        <strong>{entry.file.name}</strong>
        <span>{meta}</span>
      </span>
      <span className="file-card__status">
        {status}
        {onRemove && (
          <button type="button" className="link-button" onClick={onRemove}>
            Remove file
          </button>
        )}
      </span>
    </li>
  );
}

export type ReadyRead = Extract<UploadRead, { status: 'ready' }>;

// Files sent to be read, polled until each is read; a read file's details
// start from `detailsFrom`.
export function useUploadEntries<D>(detailsFrom: (read: ReadyRead) => D) {
  const [entries, setEntries] = useState<Array<Entry<D>>>([]);
  const counter = useRef(0);
  // Removed or cancelled; an upload still in flight is discarded when it lands.
  const gone = useRef(new Set<string>());

  const update = useCallback((key: string, patch: Partial<Entry<D>>) => {
    setEntries((current) => current.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)));
  }, []);

  async function refresh(key: string, uploadReadId: string) {
    try {
      const read = await getUpload(uploadReadId);
      setEntries((current) =>
        current.map((entry) =>
          entry.key === key ? { ...entry, read, details: entry.details ?? (read.status === 'ready' ? detailsFrom(read) : undefined) } : entry,
        ),
      );
    } catch (err) {
      update(key, { error: apiErrorMessage(err, 'This file could not be read. Upload it again.') });
    }
  }

  function addFiles(files: File[]) {
    for (const file of files) {
      counter.current += 1;
      const key = `file-${counter.current}`;
      setEntries((current) => [...current, { key, file }]);
      startUpload(file).then(
        ({ uploadReadId }) => {
          if (gone.current.has(key)) {
            void discardUpload(uploadReadId).catch(() => undefined);
            return;
          }
          update(key, { uploadReadId });
          void refresh(key, uploadReadId);
        },
        (err: unknown) => update(key, { error: apiErrorMessage(err, 'This file could not be uploaded.') }),
      );
    }
  }

  const reading = entries.filter((entry) => entry.uploadReadId && !entry.error && (!entry.read || entry.read.status === 'reading'));
  const readingKey = reading.map((entry) => entry.key).join(',');
  useEffect(() => {
    if (!readingKey) return undefined;
    const timer = window.setInterval(() => {
      for (const entry of reading) {
        void refresh(entry.key, entry.uploadReadId!);
      }
    }, 2000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readingKey]);

  async function remove(entry: Entry<D>) {
    gone.current.add(entry.key);
    setEntries((list) => list.filter((row) => row.key !== entry.key));
    if (entry.uploadReadId && !entry.created) {
      await discardUpload(entry.uploadReadId).catch(() => undefined);
    }
  }

  // Keeps none of the files: unread ones are discarded, drafts deleted.
  async function discardAll() {
    for (const entry of entries) gone.current.add(entry.key);
    await Promise.all(
      entries.map((entry) =>
        entry.created
          ? deleteInvoice(entry.created.invoiceId).catch(() => undefined)
          : entry.uploadReadId
            ? discardUpload(entry.uploadReadId).catch(() => undefined)
            : undefined,
      ),
    );
  }

  return { entries, update, addFiles, remove, discardAll };
}
