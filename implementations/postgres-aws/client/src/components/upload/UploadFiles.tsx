// Files chosen to upload: the drop zone, each file's card and the reads behind them.
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { apiErrorMessage, deleteInvoice, discardUpload, getUpload, startUpload, type UploadRead } from '../../api/client';
import { RemoveFileButton } from '../ui/RemoveFileButton';
import { ImportProgressNote } from '../ImportProgressNote';
import { countOf } from '../../portal/importProgress';
import { Button } from '../ui/Button';
import { Steps as StepList } from '../ui/Steps';

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
  return (
    <StepList
      label="Steps"
      current={0}
      steps={reviewing ? ['Upload', 'Check and review the lines', 'Finish review'] : ['Upload', 'Check', 'Send for review']}
    />
  );
}

// Files dropped elsewhere, or manual entry, to start with.
export interface UploadStart {
  files?: File[];
  manual?: boolean;
}

const READABLE = ['.pdf', '.xlsx', '.xls', '.csv', '.txt', '.ledes'];

export function DropZone({ hasFiles, onFiles }: { hasFiles: boolean; onFiles: (files: File[]) => void }) {
  const [over, setOver] = useState(false);
  const [refused, setRefused] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const add = (files: File[]) => {
    const readable = files.filter((file) => READABLE.some((ending) => file.name.toLowerCase().endsWith(ending)));
    setRefused(files.filter((file) => !readable.includes(file)).map((file) => file.name));
    if (readable.length > 0) onFiles(readable);
  };
  return (
    <div
      className={`drop-zone${over ? ' drop-zone--over' : ''}${refused.length > 0 ? ' drop-zone--error' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onClick={() => input.current?.click()}
      onDrop={(event: DragEvent) => {
        event.preventDefault();
        setOver(false);
        add([...event.dataTransfer.files]);
      }}
    >
      <input
        ref={input}
        hidden
        type="file"
        aria-label="Invoice files"
        onClick={(event) => event.stopPropagation()}
        multiple
        accept={READABLE.join(',')}
        onChange={(event) => {
          add([...(event.target.files ?? [])]);
          event.target.value = '';
        }}
      />
      <strong>{over ? 'Drop the files to add them' : hasFiles ? 'Drop more invoice files here, or choose files' : 'Drop invoice files here, or choose files'}</strong>
      <span>PDF, Excel (.xlsx), CSV or a LEDES legal billing file. One invoice per file, up to 10 MB each.</span>
      {/* Its click reaches the zone, which opens the picker. */}
      <Button kind="secondary">Choose files</Button>
      {refused.length > 0 && (
        <p className="drop-zone__error" role="alert">
          <span aria-hidden="true">×</span> {refused.join(', ')} {refused.length === 1 ? 'is not a file type' : 'are not file types'} this tool can
          read. Choose a PDF, Excel, CSV or LEDES legal billing file.
        </p>
      )}
    </div>
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
        <span className="file-card__title">
          <strong>{entry.file.name}</strong>
          {onRemove && (
            <RemoveFileButton
              fileName={entry.file.name}
              onRemove={onRemove}
              consequence={<>{entry.file.name} is taken off this upload, and nothing read from it is kept.</>}
            />
          )}
        </span>
        <span>{meta}</span>
      </span>
      <span className="file-card__status">{status}</span>
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
