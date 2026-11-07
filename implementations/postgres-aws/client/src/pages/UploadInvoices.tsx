// Upload filed by person, for staff and submitters: each file becomes a draft
// as soon as it is read, or for staff an invoice under their own review, with
// what was read from it. Its sender, case number, county, billing period and
// invoice number are checked beside its lines on the next page.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  apiErrorMessage,
  createInvoice,
  createUploadDraft,
  deleteInvoice,
  discardUpload,
  invoiceTemplateUrl,
  listBillableProfessionals,
} from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { Notice } from '../components/Notice';
import { PageHeader } from '../components/PageHeader';
import { asksWho } from '../components/InvoiceDetailsFields';
import { countyChoiceOf } from '../counties';
import { DropZone, FileCard, Steps, useUploadEntries, type ReadyRead } from '../portal/PortalUpload';
import { checkLinesPath, type CheckQueue } from '../portal/InvoiceSubmission';
import { PORTAL_HOME_PATH, useShell } from '../portal/useShell';
import { reviewPath } from '../staffPaths';
import { useAuth } from '../AuthContext';

// Staff who review take their own uploads straight into review.
function useReviewsOwnUploads() {
  const { staff } = useShell();
  const { user } = useAuth();
  return staff && Boolean(user?.reviewPermissions?.reviewLines);
}

// A period read with one day, or out of order, is left to be entered.
function readPeriod({ periodStart, periodEnd }: ReadyRead['read']) {
  return periodStart && periodEnd && periodEnd >= periodStart ? { periodStart, periodEnd } : {};
}

export default function UploadInvoices() {
  const navigate = useNavigate();
  const { staff } = useShell();
  const reviews = useReviewsOwnUploads();
  const home = staff ? { label: 'To review', to: '/' } : { label: 'Your invoices', to: PORTAL_HOME_PATH };
  const { entries, update, addFiles, remove } = useUploadEntries(() => null);
  const { data: billable } = useApiResource(() => listBillableProfessionals(null).then((result) => result.professionals), []);
  const self = billable?.find((p) => p.isSelf);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Files whose draft is being made, so each is made once.
  const creating = useRef(new Set<string>());
  const [pending, setPending] = useState(0);

  const usable = entries.filter((entry) => !entry.error && entry.read?.status !== 'failed');
  const drafts = usable.flatMap((entry) => (entry.created ? [entry.created.invoiceId] : []));
  const settled = entries.length > 0 && pending === 0 && usable.every((entry) => entry.created);
  const failed = entries.length - usable.length;
  const many = entries.length > 1;
  const position = (entry: (typeof entries)[number]) => usable.indexOf(entry) + 1;
  const canEnterByHand = staff || Boolean(self);
  // No file could be read, so the lines are typed in instead.
  const byHand = canEnterByHand && entries.length > 0 && usable.length === 0;

  // Whom it bills: as suggested from the file, or the submitter when there's no choice.
  function billedFor(read: ReadyRead) {
    if (!asksWho(staff, billable)) return self?.professionalId ?? null;
    return read.suggested?.professionalId ?? null;
  }

  useEffect(() => {
    if (!billable) return;
    for (const entry of entries) {
      const read = entry.read?.status === 'ready' ? entry.read : undefined;
      if (!read || !entry.uploadReadId || entry.created || entry.error || creating.current.has(entry.key)) continue;
      creating.current.add(entry.key);
      setPending((count) => count + 1);
      createUploadDraft(entry.uploadReadId, {
        caseId: null,
        professionalId: billedFor(read),
        ...readPeriod(read.read),
        invoiceNumber: read.read.invoiceNumber?.trim() || undefined,
        caseNumber: read.read.caseNumber?.trim() || undefined,
        ...countyChoiceOf(read.read.county),
        // Reviewers enter and decide it in one pass, on its review.
        enterInReview: reviews,
      })
        .then(
          (created) => update(entry.key, { created }),
          (err: unknown) => update(entry.key, { error: apiErrorMessage(err, 'This file could not be saved. Upload it again.') }),
        )
        .finally(() => setPending((count) => count - 1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, billable]);

  // Every invoice from this upload is checked, one after another.
  function finish(invoiceIds: string[]) {
    const [first, ...queue] = invoiceIds;
    navigate(reviews ? reviewPath(first!) : checkLinesPath(first!, staff), { state: { queue, total: invoiceIds.length } satisfies CheckQueue });
  }

  // Straight on once every file is in, unless one failed and should be seen first.
  useEffect(() => {
    if (settled && failed === 0 && drafts.length > 0) finish(drafts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, failed]);

  // An empty invoice, its lines and details added on the next page.
  async function enterByHand() {
    setBusy(true);
    setMessage(null);
    try {
      const created = await createInvoice({
        caseId: null,
        professionalId: asksWho(staff, billable) ? null : self?.professionalId,
        submit: false,
        enterInReview: reviews,
        lines: [],
      });
      navigate(reviews ? reviewPath(created.invoiceId) : checkLinesPath(created.invoiceId, staff));
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

  const next = reviews ? 'Check and review the lines' : 'Check the lines';
  return (
    <div className="portal-narrow">
      <PageHeader crumbs={[home, { label: many ? 'New invoices' : 'New invoice' }]} title={many ? 'Upload invoices' : 'Upload an invoice'} />
      <Steps reviewing={reviews} />
      <div className="upload-card">
        <DropZone hasFiles={entries.length > 0} onFiles={addFiles} />
        {entries.length === 0 && canEnterByHand && (
          <p className="manual-entry__offer">
            No file?{' '}
            <button type="button" className="link-button" disabled={busy || !billable} onClick={() => void enterByHand()}>
              Enter an invoice by hand
            </button>
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
                current={false}
                onRemove={entry.created || busy ? undefined : () => void remove(entry)}
              />
            ))}
          </ul>
        )}
        {entries.length > 0 && !settled && (
          <p className="field-hint">
            {many ? 'Each file is read, then you check its lines and details' : 'Once it is read, you check its lines and details'}{' '}
            {reviews ? 'and review them ' : ''}on the next page.
          </p>
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
              disabled={busy || !(byHand || (settled && drafts.length > 0))}
              onClick={() => (byHand ? void enterByHand() : finish(drafts))}
            >
              {byHand ? 'Enter it by hand' : next}
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
