// Upload invoices: drop one file or several. Each is read first, then the
// submitter checks what was read (case, billing period, invoice number) one
// file at a time; each checked file becomes a draft. One file goes straight
// on to checking its lines; several go back to the list as drafts. Cancel
// keeps none of them.
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import {
  ApiError,
  apiErrorMessage,
  createUploadDraft,
  deleteInvoice,
  discardUpload,
  getUpload,
  invoiceTemplateUrl,
  startUpload,
  type UploadCase,
  type UploadRead,
} from '../api/client';
import { ImportProgressNote } from '../components/ImportProgressNote';
import { Notice } from '../components/Notice';
import { PageHeader } from '../components/PageHeader';
import type { UploadedState } from './PortalInvoiceList';
import { PORTAL_HOME_PATH } from './useShell';

interface Details {
  // `${caseId}|${professionalId}`, or '' until chosen.
  caseOption: string;
  periodStart: string;
  periodEnd: string;
  invoiceNumber: string;
}

interface Entry {
  key: string;
  file: File;
  uploadReadId?: string;
  read?: UploadRead;
  // Couldn't be sent or read; it is skipped.
  error?: string;
  details?: Details;
  created?: { invoiceImportId: string; invoiceId: string };
}

const optionValue = (row: Pick<UploadCase, 'caseId' | 'professionalId'>) => `${row.caseId}|${row.professionalId}`;

function detailsFrom(read: Extract<UploadRead, { status: 'ready' }>): Details {
  return {
    caseOption: read.suggested ? optionValue(read.suggested) : '',
    periodStart: read.read.periodStart ?? '',
    periodEnd: read.read.periodEnd ?? '',
    invoiceNumber: read.read.invoiceNumber ?? '',
  };
}

function fileBadge(name: string): string {
  const extension = name.split('.').pop()?.toUpperCase() ?? '';
  return ['PDF', 'XLSX', 'XLS', 'CSV'].includes(extension) ? extension : 'FILE';
}

function fileSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function caseLabel(row: UploadCase, showWho: boolean): string {
  const label = [row.caseNumber, row.clientDisplayName].filter(Boolean).join(' · ') || 'Unnamed case';
  return showWho && row.professionalDisplayName ? `${label} (${row.professionalDisplayName})` : label;
}

function Steps() {
  const steps = ['Upload', 'Check the lines', 'Send for review'];
  return (
    <ol className="steps" aria-label="Steps">
      {steps.map((step, index) => (
        <li key={step} className={index === 0 ? 'steps__current' : undefined} aria-current={index === 0 ? 'step' : undefined}>
          <span className="steps__number">{index + 1}</span>
          {step}
        </li>
      ))}
    </ol>
  );
}

function DropZone({ hasFiles, onFiles }: { hasFiles: boolean; onFiles: (files: File[]) => void }) {
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
      <strong>{hasFiles ? 'Drop more invoices here, or choose files' : 'Drop your invoices here, or choose files'}</strong>
      <span>PDF, Excel (.xlsx) or CSV. One invoice per file. You can add several files at once.</span>
    </label>
  );
}

function FileCard({
  entry,
  position,
  total,
  current,
  onRemove,
}: {
  entry: Entry;
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
        <span className="file-card__ok">✓ Checked</span>
        {many && <span>Invoice {position} of {total}</span>}
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
            Invoice {position} of {total} · {current ? 'checking now' : 'next'}
          </span>
        )}
      </>
    );
  } else {
    status = <ImportProgressNote compact progress={read?.status === 'reading' ? read.progress : null} />;
  }
  return (
    <li className={`file-card${current && many ? ' file-card--current' : ''}`}>
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

function DetailsForm({
  entry,
  read,
  errors,
  onChange,
}: {
  entry: Entry;
  read: Extract<UploadRead, { status: 'ready' }>;
  errors: Record<string, string>;
  onChange: (details: Details) => void;
}) {
  const details = entry.details ?? detailsFrom(read);
  const set = (patch: Partial<Details>) => onChange({ ...details, ...patch });
  const showWho = new Set(read.cases.map((row) => row.professionalId)).size > 1;
  return (
    <div className="upload-details">
      <div className="upload-details__field">
        <label className="usa-label" htmlFor="upload-case">Case</label>
        <select
          id="upload-case"
          className="usa-select"
          value={details.caseOption}
          aria-describedby="upload-case-hint"
          aria-invalid={Boolean(errors.caseId) || undefined}
          onChange={(event) => set({ caseOption: event.target.value })}
        >
          <option value="">- Choose the case -</option>
          {read.cases.map((row) => (
            <option key={optionValue(row)} value={optionValue(row)}>
              {caseLabel(row, showWho)}
            </option>
          ))}
        </select>
        {errors.caseId && <p className="field-error">{errors.caseId}</p>}
        <p id="upload-case-hint" className="field-hint">Only cases where you are the assigned attorney appear here.</p>
      </div>
      <div className="upload-details__field">
        <span className="usa-label" id="upload-period-label">Billing period</span>
        <div className="upload-period" role="group" aria-labelledby="upload-period-label">
          <input
            className="usa-input"
            type="date"
            aria-label="First day"
            value={details.periodStart}
            onChange={(event) => set({ periodStart: event.target.value })}
          />
          <span>to</span>
          <input
            className="usa-input"
            type="date"
            aria-label="Last day"
            min={details.periodStart || undefined}
            value={details.periodEnd}
            onChange={(event) => set({ periodEnd: event.target.value })}
          />
        </div>
        {(errors.periodStart || errors.periodEnd) && <p className="field-error">{errors.periodStart ?? errors.periodEnd}</p>}
        <p className="field-hint">From the dates on your invoice.</p>
      </div>
      <div className="upload-details__field">
        <label className="usa-label" htmlFor="upload-invoice-number">Invoice number on your file</label>
        <input
          id="upload-invoice-number"
          className="usa-input"
          value={details.invoiceNumber}
          aria-describedby="upload-invoice-number-hint"
          onChange={(event) => set({ invoiceNumber: event.target.value })}
        />
        {errors.invoiceNumber && <p className="field-error">{errors.invoiceNumber}</p>}
        <p id="upload-invoice-number-hint" className="field-hint">Optional. It helps the billing office match your records.</p>
      </div>
    </div>
  );
}

function fieldErrorsOf(err: unknown): Record<string, string> {
  const body = err instanceof ApiError ? (err.body as { fieldErrors?: Record<string, string> } | undefined) : undefined;
  return body?.fieldErrors ?? {};
}

export default function PortalUpload() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const counter = useRef(0);

  const update = useCallback((key: string, patch: Partial<Entry>) => {
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
          update(key, { uploadReadId });
          void refresh(key, uploadReadId);
        },
        (err: unknown) => update(key, { error: apiErrorMessage(err, 'This file could not be uploaded.') }),
      );
    }
  }

  // Polls files still being read.
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

  const usable = entries.filter((entry) => !entry.error && entry.read?.status !== 'failed');
  const current = usable.find((entry) => !entry.created);
  const currentRead = current?.read?.status === 'ready' ? current.read : undefined;
  const many = entries.length > 1;
  const createdCount = entries.filter((entry) => entry.created).length;

  async function remove(entry: Entry) {
    setEntries((list) => list.filter((row) => row.key !== entry.key));
    if (entry.uploadReadId && !entry.created) {
      await discardUpload(entry.uploadReadId).catch(() => undefined);
    }
  }

  async function next() {
    if (!current || !currentRead || !current.uploadReadId) return;
    const details = current.details ?? detailsFrom(currentRead);
    const [caseId, professionalId] = details.caseOption.split('|');
    if (!caseId || !professionalId) {
      setErrors({ caseId: 'Choose the case this invoice is for.' });
      return;
    }
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      const created = await createUploadDraft(current.uploadReadId, {
        caseId,
        professionalId,
        periodStart: details.periodStart || undefined,
        periodEnd: details.periodEnd || undefined,
        invoiceNumber: details.invoiceNumber.trim() || undefined,
      });
      update(current.key, { created });
      const remaining = usable.filter((entry) => !entry.created && entry.key !== current.key);
      if (remaining.length === 0) {
        if (createdCount === 0 && usable.length === 1) {
          navigate(`/portal/invoices/${created.invoiceId}`);
        } else {
          navigate(PORTAL_HOME_PATH, { state: { uploadedCount: createdCount + 1 } satisfies UploadedState });
        }
      }
    } catch (err) {
      const fieldErrors = fieldErrorsOf(err);
      setErrors(fieldErrors);
      if (Object.keys(fieldErrors).length === 0) {
        setMessage(apiErrorMessage(err, 'This invoice could not be saved. Try again.'));
      }
    } finally {
      setBusy(false);
    }
  }

  // Keeps none of the files: unread ones are discarded, drafts deleted.
  async function cancel() {
    setBusy(true);
    await Promise.all(
      entries.map((entry) =>
        entry.created
          ? deleteInvoice(entry.created.invoiceId).catch(() => undefined)
          : entry.uploadReadId
            ? discardUpload(entry.uploadReadId).catch(() => undefined)
            : undefined,
      ),
    );
    navigate(PORTAL_HOME_PATH);
  }

  const position = (entry: Entry) => usable.indexOf(entry) + 1;

  return (
    <div className="portal-narrow">
      <PageHeader
        crumbs={[{ label: 'Your invoices', to: PORTAL_HOME_PATH }, { label: many ? 'New invoices' : 'New invoice' }]}
        title={many ? 'Upload invoices' : 'Upload an invoice'}
      />
      <Steps />
      <div className="upload-card">
        <DropZone hasFiles={entries.length > 0} onFiles={addFiles} />
        {many && (
          <p className="upload-card__intro">
            {entries.length} files uploaded. Check what we read from each one, then go to the next.
          </p>
        )}
        {entries.length > 0 && (
          <ul className="file-cards">
            {entries.map((entry) => (
              <FileCard
                key={entry.key}
                entry={entry}
                position={position(entry)}
                total={usable.length}
                current={entry === current}
                onRemove={
                  entry.created || busy
                    ? undefined
                    : entry.error || entry.read?.status === 'failed' || !many
                      ? () => void remove(entry)
                      : undefined
                }
              />
            ))}
          </ul>
        )}
        {current && currentRead && (
          <>
            <h2 className="upload-card__heading">
              {many ? `Invoice ${position(current)} of ${usable.length}: what we read from ${current.file.name}. ` : 'What we read from your file. '}
              Check it is right.
            </h2>
            <DetailsForm entry={current} read={currentRead} errors={errors} onChange={(details) => update(current.key, { details })} />
            {currentRead.cases.length === 0 && (
              <Notice tone="warning">You have no open cases to bill. Ask the billing office to check your case assignments.</Notice>
            )}
          </>
        )}
        {message && <Notice tone="danger">{message}</Notice>}
        {entries.length > 0 && (
          <div className="upload-card__actions">
            <button type="button" className="btn btn--primary" disabled={busy || !currentRead} onClick={() => void next()}>
              {many ? 'Next' : 'Check the lines'}
            </button>
            <button type="button" className="link-button" disabled={busy} onClick={() => void cancel()}>
              Cancel
            </button>
            {many && <span className="field-hint">Cancel stops the whole upload. None of the {entries.length} files are kept.</span>}
          </div>
        )}
        {many && (
          <p className="field-hint">
            After the last file, Next takes you back to your invoices. Each file is saved there as a draft for you to check and send.
          </p>
        )}
      </div>
      <p className="upload-footnote">
        Using a spreadsheet? Start from the template so every column is read correctly.{' '}
        <a href={invoiceTemplateUrl('xlsx')}>Download the template</a>
      </p>
      {entries.length === 0 && (
        <p className="upload-footnote">
          <RouterLink to={PORTAL_HOME_PATH}>Back to your invoices</RouterLink>
        </p>
      )}
    </div>
  );
}
