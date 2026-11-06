// Upload filed by person, for staff and submitters: each file's case number,
// billing period, invoice number and, when there's a choice, sender (needed,
// as it is filed under them) are checked in turn; each becomes a draft, or
// for staff an invoice under their own review, its lines entered there.
// Staff entering one by hand give the same details first.
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
import { reviewPath } from '../staffPaths';
import { useAuth } from '../AuthContext';
import { countOf } from '../portal/importProgress';

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

const noDetails: Details = { professionalId: '', caseNumber: '', caseNumberRead: false, periodStart: '', periodEnd: '', invoiceNumber: '' };

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

// Staff who review take their own uploads straight into review.
function useReviewsOwnUploads() {
  const { staff } = useShell();
  const { user } = useAuth();
  return staff && Boolean(user?.reviewPermissions?.reviewLines);
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
  byHand = false,
  onChange,
}: {
  details: Details;
  billable: BillableProfessional[] | undefined;
  errors: Record<string, string>;
  // No file: its hints don't mention one.
  byHand?: boolean;
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
              : byHand
                ? 'Optional. You can add it later.'
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
        label={byHand ? 'Invoice number' : `Invoice number on ${file}`}
        value={details.invoiceNumber}
        error={errors.invoiceNumber}
        hint={staff ? 'Optional. It helps match the sender’s records.' : 'Optional. It helps the billing office match your records.'}
        onChange={(invoiceNumber) => set({ invoiceNumber })}
      />
    </div>
  );
}

// Staff only: an empty invoice filed under whom it is from, its lines added
// on the next page; a reviewer's goes straight into their review, as an
// upload does.
function ManualEntry({ billable, onCancel }: { billable: BillableProfessional[] | undefined; onCancel: () => void }) {
  const navigate = useNavigate();
  const reviews = useReviewsOwnUploads();
  const [details, setDetails] = useState<Details>(noDetails);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const professionalId = details.professionalId === ADD_NEW ? '' : details.professionalId;

  async function start() {
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      const created = await createInvoice({
        caseId: null,
        professionalId,
        submit: false,
        periodStart: details.periodStart || undefined,
        periodEnd: details.periodEnd || undefined,
        caseNumber: details.caseNumber.trim() || undefined,
        invoiceNumber: details.invoiceNumber.trim() || undefined,
        enterInReview: reviews,
        lines: [],
      });
      navigate(reviews ? reviewPath(created.invoiceId) : checkLinesPath(created.invoiceId, true));
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
      <p className="field-hint">
        {reviews
          ? 'Say whom it is from, then enter each line of the invoice and decide it on the next step.'
          : 'Say whom it is from, then add each line of the invoice on the next step.'}
      </p>
      <DetailsForm byHand details={details} billable={billable} errors={errors} onChange={setDetails} />
      {message && <Notice tone="danger">{message}</Notice>}
      <div className="upload-card__actions">
        <button type="button" className="btn btn--primary" disabled={busy || !professionalId} onClick={() => void start()}>
          {busy ? 'Starting…' : 'Enter lines'}
        </button>
        <button type="button" className="link-button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function UploadInvoices() {
  const navigate = useNavigate();
  const { staff } = useShell();
  const reviews = useReviewsOwnUploads();
  const home = staff ? { label: 'To review', to: '/' } : { label: 'Your invoices', to: PORTAL_HOME_PATH };
  const { entries, update, addFiles, remove } = useUploadEntries(detailsFrom);
  const { data: billable } = useApiResource(() => listBillableProfessionals(null).then((result) => result.professionals), []);
  const self = billable?.find((p) => p.isSelf);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [manual, setManual] = useState(false);

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
  const canEnterByHand = staff || Boolean(self);
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
        // Reviewers enter and decide it in one pass, on its review.
        enterInReview: reviews,
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

  // Every invoice from this upload is checked, one after another.
  function finish(invoiceIds: string[]) {
    const [first, ...queue] = invoiceIds;
    navigate(reviews ? reviewPath(first!) : checkLinesPath(first!, staff), { state: { queue, total: invoiceIds.length } satisfies CheckQueue });
  }

  // A submitter's is an empty draft, its lines and case number added on the
  // next page; staff first say whom it is from.
  async function enterByHand() {
    if (staff) {
      setManual(true);
      return;
    }
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
        title={manual ? 'Enter an invoice' : many ? 'Upload invoices' : 'Upload an invoice'}
      />
      <Steps reviewing={reviews} />
      {manual ? (
        <ManualEntry billable={billable ?? undefined} onCancel={() => setManual(false)} />
      ) : (
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
                ? `Invoice ${countOf(position(current), usable.length)}: what we read from ${current.file.name}. `
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
              Invoice {countOf(position(current), usable.length)}: reading {current.file.name}. You can check it once it is read.
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
              {many && !byHand && !finished ? 'Next' : reviews ? 'Check and review the lines' : 'Check the lines'}
            </button>
            <button type="button" className="link-button" disabled={busy} onClick={() => void cancel()}>
              Cancel
            </button>
            {many && <span className="field-hint">Cancel stops the whole upload. None of the {entries.length} files are kept.</span>}
          </div>
        )}
      </div>
      )}
      <p className="upload-footnote">
        Using a spreadsheet? Start from the template so every column is read correctly.{' '}
        <a href={invoiceTemplateUrl('xlsx')}>Download the template</a>
      </p>
    </div>
  );
}
