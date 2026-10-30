// Upload invoices, or enter one by hand: each file is read, then its case
// and period are checked one at a time and it becomes a draft. A case or
// provider that isn't known or listed is matched later on Intake. See
// MAPPING.md "Structured invoice import".
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  apiErrorMessage,
  createInvoice,
  createUploadDraft,
  fieldErrorsOf,
  deleteInvoice,
  discardUpload,
  getUpload,
  invoiceTemplateUrl,
  listBillableProfessionals,
  listUploadCases,
  startUpload,
  type BillableProfessional,
  type ProposedCase,
  type ProposedProvider,
  type UploadCase,
  type UploadRead,
} from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { ImportProgressNote } from '../components/ImportProgressNote';
import { Notice } from '../components/Notice';
import { PageHeader } from '../components/PageHeader';
import { professionalLabel } from '../components/InvoiceLinesEditor';
import type { UploadedState } from './PortalInvoiceList';
import { useShell } from './useShell';
import { AddProvider } from '../components/AddProvider';
import { ADD_NEW, PickOrAdd } from '../components/PickOrAdd';
import {
  createCaseFromEntry,
  matchToAddedCase,
  newCaseEntry,
  NO_PROPOSED_CASE,
  NO_PROPOSED_PERSON,
  proposedCaseToSend,
  proposedPersonToSend,
  ProposedCaseFields,
  ProposedPersonFields,
  StaffNewCaseFields,
  type NewCaseEntry,
} from '../components/NewEntryFields';

interface Details {
  // `${caseId}|${professionalId}`, ADD_NEW, or '' (not known: matched on Intake).
  caseOption: string;
  // A new case: a submitter's details, or one staff create.
  proposedCase: ProposedCase;
  newCase: NewCaseEntry;
  // With no case chosen: whom it's from, ADD_NEW, or '' (not known yet).
  fromProfessionalId: string;
  proposedProvider: ProposedProvider;
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
    ...noDetails(),
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

// Who the user may bill with no case chosen: staff, any active provider; a
// submitter, themselves and anyone they act for.
function useBillable() {
  return useApiResource(() => listBillableProfessionals(null).then((result) => result.professionals), []);
}

// Asked only when there's more than one to choose from.
function asksWho(staff: boolean, billable: BillableProfessional[] | null | undefined) {
  return staff || (billable?.length ?? 0) > 1;
}

// The case, billing period and (for a file) invoice number, for an upload
// or an invoice entered by hand. Nothing here has to be chosen: what isn't
// known is matched on Intake.
function DetailsForm({
  details,
  cases,
  billable,
  withInvoiceNumber,
  errors,
  onChange,
}: {
  details: Details;
  cases: UploadCase[];
  billable: BillableProfessional[] | null | undefined;
  withInvoiceNumber: boolean;
  errors: Record<string, string>;
  onChange: (details: Details) => void;
}) {
  const { staff } = useShell();
  const set = (patch: Partial<Details>) => onChange({ ...details, ...patch });
  const showWho = new Set(cases.map((row) => row.professionalId)).size > 1;
  const noCase = details.caseOption === '' || details.caseOption === ADD_NEW;
  const [added, setAdded] = useState<Array<{ professionalId: string; displayName: string }>>([]);
  const from = [...(billable ?? []).map((p) => ({ value: p.professionalId, label: professionalLabel(p) })), ...added.map((p) => ({ value: p.professionalId, label: p.displayName }))];
  return (
    <div className="upload-details">
      <div className="upload-details__field">
        <PickOrAdd
          id="upload-case"
          label="Case"
          value={details.caseOption}
          onChange={(caseOption) => set({ caseOption })}
          addLabel="+ Add a case that isn’t listed"
          placeholder="Choose the case"
          options={cases.map((row) => ({ value: optionValue(row), label: caseLabel(row, showWho) }))}
          error={errors.caseId}
          hint={
            staff
              ? 'Cases with an assigned provider appear here, with whom each invoice bills. Leave it blank to match it later on Intake.'
              : 'Only cases where you are the assigned attorney appear here. If yours isn’t, add what you know of it. If you’re not sure, leave it blank and the billing office will match it.'
          }
        >
          {staff ? (
            <StaffNewCaseFields idPrefix="upload-new-case" value={details.newCase} onChange={(newCase) => set({ newCase })} errors={errors} />
          ) : (
            <ProposedCaseFields idPrefix="upload-new-case" value={details.proposedCase} onChange={(proposedCase) => set({ proposedCase })} errors={errors} />
          )}
        </PickOrAdd>
      </div>
      {noCase && asksWho(staff, billable) && (
        <div className="upload-details__field">
          <PickOrAdd
            id="upload-from"
            label="From"
            value={details.fromProfessionalId}
            onChange={(fromProfessionalId) => set({ fromProfessionalId })}
            addLabel="+ Add someone who isn’t listed"
            placeholder="Choose who it’s from"
            options={from}
            error={errors.professionalId}
            hint="Leave it blank if you’re not sure. It waits on Intake until its case is matched."
          >
            {staff ? (
              <AddProvider
                inline
                idPrefix="upload-from-new"
                onAdded={(provider) => {
                  setAdded((current) => [...current, provider]);
                  set({ fromProfessionalId: provider.professionalId });
                }}
              />
            ) : (
              <ProposedPersonFields idPrefix="upload-from-new" value={details.proposedProvider} onChange={(proposedProvider) => set({ proposedProvider })} />
            )}
          </PickOrAdd>
        </div>
      )}
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
        <p className="field-hint">{withInvoiceNumber ? 'From the dates on your invoice.' : 'Optional. The dates the work covers.'}</p>
      </div>
      {withInvoiceNumber && (
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
          <p id="upload-invoice-number-hint" className="field-hint">
            {staff ? "Optional. It helps match the provider's records." : 'Optional. It helps the billing office match your records.'}
          </p>
        </div>
      )}
    </div>
  );
}

// Each gets its own new-case entry, so one file's new case is never taken for another's.
const noDetails = (): Details => ({
  caseOption: '',
  proposedCase: NO_PROPOSED_CASE,
  newCase: newCaseEntry(),
  fromProfessionalId: '',
  proposedProvider: NO_PROPOSED_PERSON,
  periodStart: '',
  periodEnd: '',
  invoiceNumber: '',
});

// Where an invoice goes: its chosen case, or Intake with what's known. A case
// staff add is created first; with whom it's from known, the invoice is then
// matched to it straight away (`matchTo`).
async function destination(details: Details, staff: boolean, billable: BillableProfessional[] | null | undefined) {
  if (details.caseOption && details.caseOption !== ADD_NEW) {
    const [caseId, professionalId] = details.caseOption.split('|');
    return { caseId: caseId!, professionalId: professionalId! };
  }
  const chosenFrom = details.fromProfessionalId && details.fromProfessionalId !== ADD_NEW ? details.fromProfessionalId : null;
  const professionalId = asksWho(staff, billable) ? chosenFrom : (billable?.find((p) => p.isSelf)?.professionalId ?? null);
  const addingCase = details.caseOption === ADD_NEW;
  const matchTo = staff && addingCase && professionalId ? await createCaseFromEntry(details.newCase) : undefined;
  return {
    caseId: null,
    professionalId,
    proposedCase: addingCase && !matchTo ? proposedCaseToSend(staff ? details.newCase : details.proposedCase) : undefined,
    proposedProvider: !staff && details.fromProfessionalId === ADD_NEW ? proposedPersonToSend(details.proposedProvider) : undefined,
    matchTo,
  };
}


// Starts an empty draft, then adds its lines on the check-the-lines page.
function ManualEntry({ onCancel }: { onCancel: () => void }) {
  const navigate = useNavigate();
  const { staff } = useShell();
  const { data, error: loadError } = useApiResource(() => listUploadCases().then((result) => result.cases), []);
  const { data: billable } = useBillable();
  const [details, setDetails] = useState<Details>(noDetails);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cases = data ?? [];
  // A submitter with one case starts on it.
  useEffect(() => {
    if (data?.length === 1 && !staff) {
      setDetails((current) => ({ ...current, caseOption: optionValue(data[0]!) }));
    }
  }, [data, staff]);

  async function start() {
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      const { matchTo, ...target } = await destination(details, staff, billable);
      const created = await createInvoice({
        ...target,
        submit: false,
        periodStart: details.periodStart || undefined,
        periodEnd: details.periodEnd || undefined,
        lines: [],
      });
      const matched = matchTo ? await matchToAddedCase(created.invoiceId, matchTo) : undefined;
      if (matched && 'problem' in matched) {
        setMessage(matched.problem);
        return;
      }
      navigate(`/portal/invoices/${created.invoiceId}`);
    } catch (err) {
      const fieldErrors = fieldErrorsOf(err);
      setErrors(fieldErrors);
      if (Object.keys(fieldErrors).length === 0) {
        setMessage(apiErrorMessage(err, 'The invoice could not be started. Try again.'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="upload-card manual-entry">
      <h2 className="upload-card__heading">Enter an invoice by hand</h2>
      <p className="field-hint">Choose the case, then add each line of the invoice on the next step.</p>
      {Boolean(loadError) && <Notice tone="danger">Your cases could not be loaded.</Notice>}
      <DetailsForm
        details={details}
        cases={cases}
        billable={billable}
        withInvoiceNumber={false}
        errors={errors}
        onChange={setDetails}
      />
      {message && <Notice tone="danger">{message}</Notice>}
      <div className="upload-card__actions">
        <button type="button" className="btn btn--primary" disabled={busy || !data} onClick={() => void start()}>
          {busy ? 'Starting…' : 'Add the lines'}
        </button>
        <button type="button" className="link-button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function PortalUpload() {
  const navigate = useNavigate();
  // Staff come from and go back to Intake; submitters to their invoices.
  const { staff, invoicesPath, invoicesLabel } = useShell();
  const [entries, setEntries] = useState<Entry[]>([]);
  const { data: billable } = useBillable();
  const [manual, setManual] = useState(false);
  const location = useLocation();
  const started = useRef(false);
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
  // Once, even in development's double render; the state is cleared so a
  // reload doesn't upload the files again.
  useEffect(() => {
    const start = location.state as UploadStart | null;
    if (started.current || !start) return;
    started.current = true;
    navigate(location.pathname, { replace: true, state: null });
    if (start.manual) setManual(true);
    if (start.files?.length) addFiles(start.files);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


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
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      const { matchTo, ...target } = await destination(details, staff, billable);
      const created = await createUploadDraft(current.uploadReadId, {
        ...target,
        periodStart: details.periodStart || undefined,
        periodEnd: details.periodEnd || undefined,
        invoiceNumber: details.invoiceNumber.trim() || undefined,
      });
      const matched = matchTo ? await matchToAddedCase(created.invoiceId, matchTo) : undefined;
      update(current.key, { created });
      const remaining = usable.filter((entry) => !entry.created && entry.key !== current.key);
      // Stays here to say so; the next file, if any, is checked as usual.
      if (matched && 'problem' in matched) {
        setMessage(matched.problem);
      } else if (remaining.length === 0) {
        if (createdCount === 0 && usable.length === 1) {
          // Staff check the lines on the import review page, in their shell.
          navigate(staff ? `/portal/imports/${created.invoiceImportId}` : `/portal/invoices/${created.invoiceId}`);
        } else {
          navigate(invoicesPath, { state: { uploadedCount: createdCount + 1 } satisfies UploadedState });
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
    navigate(invoicesPath);
  }

  const position = (entry: Entry) => usable.indexOf(entry) + 1;

  return (
    <div className="portal-narrow">
      <PageHeader
        crumbs={[{ label: invoicesLabel, to: invoicesPath }, { label: many ? 'New invoices' : 'New invoice' }]}
        title={manual ? 'Enter an invoice' : many ? 'Upload invoices' : 'Upload an invoice'}
      />
      <Steps />
      {manual ? (
        <ManualEntry onCancel={() => setManual(false)} />
      ) : (
      <div className="upload-card">
        <DropZone hasFiles={entries.length > 0} onFiles={addFiles} />
        {entries.length === 0 && (
          <p className="manual-entry__offer">
            No file?{' '}
            <button type="button" className="link-button" onClick={() => setManual(true)}>
              Enter an invoice by hand
            </button>
          </p>
        )}
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
            <DetailsForm
              details={current.details ?? detailsFrom(currentRead)}
              cases={currentRead.cases}
              billable={billable}
              withInvoiceNumber
              errors={errors}
              onChange={(details) => update(current.key, { details })}
            />
            {currentRead.cases.length === 0 && !staff && (
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
            {staff
              ? 'After the last file, Next takes you back to Intake. Each file is saved there as a draft, or waits for a case.'
              : 'After the last file, Next takes you back to your invoices. Each file is saved there as a draft for you to check and send.'}
          </p>
        )}
      </div>
      )}
      {!manual && (
        <p className="upload-footnote">
          Using a spreadsheet? Start from the template so every column is read correctly.{' '}
          <a href={invoiceTemplateUrl('xlsx')}>Download the template</a>
        </p>
      )}
    </div>
  );
}
