// Upload filed by person, for staff and submitters: each file's case number,
// billing period, invoice number and, when there's a choice, sender (needed,
// as it is filed under them) are checked in turn; each becomes a draft.
import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  apiErrorMessage,
  createInvoice,
  createUploadDraft,
  deleteInvoice,
  discardUpload,
  fieldErrorsOf,
  invoiceTemplateUrl,
  listBillableProfessionals,
  type BillableProfessional,
} from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { ImportProgressNote } from '../components/ImportProgressNote';
import { Notice } from '../components/Notice';
import { PageHeader } from '../components/PageHeader';
import { AddProvider } from '../components/AddProvider';
import { ADD_NEW, PickOrAdd } from '../components/PickOrAdd';
import { professionalLabel } from '../components/InvoiceLinesEditor';
import { DropZone, FileCard, InvoiceNumberField, Steps, UploadPeriodField, useUploadEntries, type ReadyRead } from '../portal/PortalUpload';
import { checkLinesPath, type CheckQueue } from '../portal/InvoiceSubmission';
import { PORTAL_HOME_PATH, useShell } from '../portal/useShell';

interface Details {
  // '' until chosen, or ADD_NEW while staff add someone.
  professionalId: string;
  caseNumber: string;
  // Whether caseNumber came from the file.
  caseNumberRead: boolean;
  periodStart: string;
  periodEnd: string;
  invoiceNumber: string;
}

function detailsFrom(read: ReadyRead): Details {
  return {
    professionalId: read.suggested?.professionalId ?? '',
    caseNumber: read.read.caseNumber ?? '',
    caseNumberRead: Boolean(read.read.caseNumber),
    periodStart: read.read.periodStart ?? '',
    periodEnd: read.read.periodEnd ?? '',
    invoiceNumber: read.read.invoiceNumber ?? '',
  };
}

// Asked of staff, and of a submitter who bills for more than themselves.
function asksWho(staff: boolean, billable: BillableProfessional[] | null | undefined) {
  return staff || (billable?.length ?? 0) > 1;
}

function WhoFrom({
  details,
  billable,
  errors,
  onChange,
}: {
  details: Details;
  billable: BillableProfessional[];
  errors: Record<string, string>;
  onChange: (patch: Partial<Details>) => void;
}) {
  const { staff } = useShell();
  const [added, setAdded] = useState<Array<{ professionalId: string; displayName: string }>>([]);
  const people = [
    ...billable.map((p) => ({ value: p.professionalId, label: professionalLabel(p) })),
    ...added.map((p) => ({ value: p.professionalId, label: p.displayName })),
  ];
  const hint = 'The invoice is filed under this person, so it is needed to go on.';
  // A submitter acting for others chooses among them; only staff add people.
  if (!staff) {
    return (
      <>
        <label className="usa-label" htmlFor="upload-from">Who it is from</label>
        <select
          id="upload-from"
          className="usa-select"
          value={details.professionalId}
          aria-describedby="upload-from-hint"
          onChange={(event) => onChange({ professionalId: event.target.value })}
        >
          <option value="">Choose who it is from</option>
          {people.map((person) => (
            <option key={person.value} value={person.value}>{person.label}</option>
          ))}
        </select>
        {errors.professionalId && <p className="field-error">{errors.professionalId}</p>}
        <p id="upload-from-hint" className="field-hint">{hint}</p>
      </>
    );
  }
  return (
    <PickOrAdd
      id="upload-from"
      label="Who it is from"
      value={details.professionalId}
      onChange={(professionalId) => onChange({ professionalId })}
      addLabel="+ Add someone who isn’t listed"
      placeholder="Choose who sent it"
      options={people}
      error={errors.professionalId}
      hint={hint}
    >
      <AddProvider
        inline
        idPrefix="upload-from-new"
        onAdded={(provider) => {
          setAdded((current) => [...current, provider]);
          onChange({ professionalId: provider.professionalId });
        }}
      />
    </PickOrAdd>
  );
}

function DetailsForm({
  details,
  billable,
  errors,
  onChange,
}: {
  details: Details;
  billable: BillableProfessional[] | undefined;
  errors: Record<string, string>;
  onChange: (details: Details) => void;
}) {
  const { staff } = useShell();
  const set = (patch: Partial<Details>) => onChange({ ...details, ...patch });
  const file = staff ? 'the file' : 'your file';
  return (
    <div className="upload-details">
      {asksWho(staff, billable) && (
        <div className="upload-details__field">
          <WhoFrom details={details} billable={billable ?? []} errors={errors} onChange={set} />
        </div>
      )}
      <div className="upload-details__field">
        <label className="usa-label" htmlFor="upload-case-number">Case number</label>
        <input
          id="upload-case-number"
          className="usa-input"
          placeholder="For example, 26-CR-00418"
          value={details.caseNumber}
          aria-describedby="upload-case-number-hint"
          onChange={(event) => set({ caseNumber: event.target.value, caseNumberRead: false })}
        />
        {errors.caseNumber && <p className="field-error">{errors.caseNumber}</p>}
        <p id="upload-case-number-hint" className="field-hint">
          {details.caseNumberRead
            ? `We read this from ${file}. Change it if it is wrong.`
            : details.caseNumber
              ? 'As typed. It is not checked against a list of cases.'
              : `Not found in ${file}. You can add it later.`}
        </p>
      </div>
      <UploadPeriodField
        start={details.periodStart}
        end={details.periodEnd}
        error={errors.periodStart ?? errors.periodEnd}
        hint={`From the dates on ${staff ? 'the' : 'your'} invoice.`}
        onChange={(period) => set(period)}
      />
      <InvoiceNumberField
        label={`Invoice number on ${file}`}
        value={details.invoiceNumber}
        error={errors.invoiceNumber}
        hint={staff ? 'Optional. It helps match the sender’s records.' : 'Optional. It helps the billing office match your records.'}
        onChange={(invoiceNumber) => set({ invoiceNumber })}
      />
    </div>
  );
}

export default function UploadInvoices() {
  const navigate = useNavigate();
  const { staff } = useShell();
  const home = staff ? { label: 'To review', to: '/' } : { label: 'Your invoices', to: PORTAL_HOME_PATH };
  const { entries, update, addFiles, remove } = useUploadEntries(detailsFrom);
  const { data: billable } = useApiResource(() => listBillableProfessionals(null).then((result) => result.professionals), []);
  const self = billable?.find((p) => p.isSelf);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const usable = entries.filter((entry) => !entry.error && entry.read?.status !== 'failed');
  const unchecked = usable.filter((entry) => !entry.created);
  // A read file is checked before one still being read, so a slow file doesn't hold up the rest.
  const current = unchecked.find((entry) => entry.read?.status === 'ready') ?? unchecked[0];
  const drafts = usable.flatMap((entry) => (entry.created ? [entry.created.invoiceId] : []));
  // Every other file failed after these were checked.
  const finished = !current && drafts.length > 0;
  const currentRead = current?.read?.status === 'ready' ? current.read : undefined;
  const many = entries.length > 1;
  const position = (entry: (typeof entries)[number]) => usable.indexOf(entry) + 1;
  const canEnterByHand = !staff && Boolean(self);
  // No file could be read, so the lines are typed in instead.
  const byHand = canEnterByHand && entries.length > 0 && usable.length === 0;

  // Whom it bills: as chosen, or the submitter when there's no choice.
  function billedFor(details: Details) {
    if (!asksWho(staff, billable)) {
      return { professionalId: self?.professionalId ?? null };
    }
    return { professionalId: details.professionalId && details.professionalId !== ADD_NEW ? details.professionalId : null };
  }
  const currentDetails = current && currentRead ? (current.details ?? detailsFrom(currentRead)) : undefined;
  const fromChosen = Boolean(currentDetails && billedFor(currentDetails).professionalId);

  async function next() {
    if (!current || !currentRead || !current.uploadReadId) return;
    const details = current.details ?? detailsFrom(currentRead);
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      const created = await createUploadDraft(current.uploadReadId, {
        caseId: null,
        ...billedFor(details),
        periodStart: details.periodStart || undefined,
        periodEnd: details.periodEnd || undefined,
        invoiceNumber: details.invoiceNumber.trim() || undefined,
        caseNumber: details.caseNumber.trim() || undefined,
      });
      update(current.key, { created });
      if (unchecked.length === 1) {
        finish([...drafts, created.invoiceId]);
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

  // Every draft from this upload is checked, one after another.
  function finish(invoiceIds: string[]) {
    const [first, ...queue] = invoiceIds;
    navigate(checkLinesPath(first!, staff), { state: { queue, total: invoiceIds.length } satisfies CheckQueue });
  }

  // An empty draft, its lines and case number added on the next page.
  async function enterByHand() {
    setBusy(true);
    setMessage(null);
    try {
      const created = await createInvoice({ caseId: null, professionalId: self?.professionalId, submit: false, lines: [] });
      navigate(checkLinesPath(created.invoiceId, staff));
    } catch (err) {
      setMessage(apiErrorMessage(err, 'The invoice could not be started. Try again.'));
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
    navigate(home.to);
  }

  return (
    <div className="portal-narrow">
      <PageHeader
        crumbs={[home, { label: many ? 'New invoices' : 'New invoice' }]}
        title={many ? 'Upload invoices' : 'Upload an invoice'}
      />
      <Steps />
      <div className="upload-card">
        <DropZone hasFiles={entries.length > 0} onFiles={addFiles} />
        {entries.length === 0 && canEnterByHand && (
          <p className="manual-entry__offer">
            No file?{' '}
            <button type="button" className="link-button" disabled={busy} onClick={() => void enterByHand()}>
              Enter an invoice by hand
            </button>
          </p>
        )}
        {many && <p className="upload-card__intro">{entries.length} files uploaded. Check what we read from each one, then go to the next.</p>}
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
              {many
                ? `Invoice ${position(current)} of ${usable.length}: what we read from ${current.file.name}. `
                : `What we read from ${staff ? 'the' : 'your'} file. `}
              Check it is right.
            </h2>
            <DetailsForm
              key={current.key}
              details={current.details ?? detailsFrom(currentRead)}
              billable={billable ?? undefined}
              errors={errors}
              onChange={(details) => update(current.key, { details })}
            />
          </>
        )}
        {many && current && !currentRead && (
          <>
            <h2 className="upload-card__heading">
              Invoice {position(current)} of {usable.length}: reading {current.file.name}. You can check it once it is read.
            </h2>
            <ImportProgressNote progress={current.read?.status === 'reading' ? current.read.progress : null} />
          </>
        )}
        {byHand && (
          <p className="field-hint">
            {many ? 'None of the files could be read.' : 'The file could not be read.'} You can type the invoice’s lines on the next step.
          </p>
        )}
        {message && <Notice tone="danger">{message}</Notice>}
        {entries.length > 0 && (
          <div className="upload-card__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy || (!byHand && !finished && (!currentRead || !fromChosen))}
              onClick={() => (finished ? finish(drafts) : void (byHand ? enterByHand() : next()))}
            >
              {many && !byHand && !finished ? 'Next' : 'Check the lines'}
            </button>
            <button type="button" className="link-button" disabled={busy} onClick={() => void cancel()}>
              Cancel
            </button>
            {many && <span className="field-hint">Cancel stops the whole upload. None of the {entries.length} files are kept.</span>}
          </div>
        )}
      </div>
      <p className="upload-footnote">
        Using a spreadsheet? Start from the template so every column is read correctly.{' '}
        <a href={invoiceTemplateUrl('xlsx')}>Download the template</a>
      </p>
    </div>
  );
}
