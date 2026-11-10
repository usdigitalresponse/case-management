// Upload filed by person: who billed it (and, of staff, how it arrived) is
// asked once for every file, then each becomes a draft or a reviewer's entry.
import { useEffect, useRef, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import {
  addProfessional,
  apiErrorMessage,
  createInvoice,
  createUploadDraft,
  deleteInvoice,
  discardUpload,
  invoiceTemplateUrl,
  listBillableProfessionals,
  type InvoiceReceipt,
} from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { Notice } from '../components/Notice';
import { PageHeader } from '../components/PageHeader';
import { asksWho, BILLED_BY_HINT, SenderPicker, senderLabel, type PersonDraft } from '../components/InvoiceDetailsFields';
import { ADD_NEW } from '../components/PickOrAdd';
import { countyChoiceOf } from '../counties';
import { DropZone, FileCard, Steps, useUploadEntries, type ReadyRead } from '../portal/PortalUpload';
import { ReceivedFields } from '../portal/ReceivedFields';
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

const chosen = (professionalId: string | undefined) => Boolean(professionalId && professionalId !== ADD_NEW);

export default function UploadInvoices() {
  const navigate = useNavigate();
  const { staff } = useShell();
  const reviews = useReviewsOwnUploads();
  const home = staff ? { label: 'To review', to: '/' } : { label: 'Your invoices', to: PORTAL_HOME_PATH };
  // A file's own sender; '' is the one chosen above.
  const { entries, update, addFiles, remove } = useUploadEntries(() => '');
  const { data: billable } = useApiResource(() => listBillableProfessionals(null).then((result) => result.professionals), []);
  const self = billable?.find((p) => p.isSelf);
  const asks = asksWho(staff, billable);
  const [sender, setSender] = useState('');
  const [receipt, setReceipt] = useState<InvoiceReceipt>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Set once going on was tried, so missing fields are marked where they are.
  const [tried, setTried] = useState(false);
  const [addRow, setAddRow] = useState<HTMLDivElement | null>(null);
  // Added only on going on, and reused on a retry unless edited since.
  const [draft, setDraft] = useState<PersonDraft | null>(null);
  const addedDraft = useRef<{ described: string; professionalId: string } | null>(null);

  const usable = entries.filter((entry) => !entry.error && entry.read?.status !== 'failed');
  const ready = usable.flatMap((entry) => (entry.read?.status === 'ready' ? [{ entry, read: entry.read }] : []));
  const reading = usable.length > ready.length;
  const many = usable.length > 1;
  // Also for one file, once it is billed by someone other than the choice above.
  const perFile = many || ready.some(({ entry }) => entry.details);
  const position = (entry: (typeof entries)[number]) => usable.indexOf(entry) + 1;
  const canEnterByHand = staff || Boolean(self);
  // Every file failed: it may still be entered by hand.
  const allFailed = entries.length > 0 && usable.length === 0;

  // A file's suggested sender fills an empty choice above, else becomes its own.
  const considered = useRef(new Set<string>());
  useEffect(() => {
    if (!asks) return;
    let top = sender;
    for (const { entry, read } of ready) {
      if (considered.current.has(entry.key)) continue;
      considered.current.add(entry.key);
      const suggested = read.suggested?.professionalId;
      if (!suggested) continue;
      if (!top) {
        top = suggested;
        setSender(suggested);
      } else if (suggested !== top) {
        update(entry.key, { details: suggested });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready.map(({ entry }) => entry.key).join(), asks]);

  const topChosen = chosen(sender) || (sender === ADD_NEW && Boolean(draft));
  const senderFor = (own: string | undefined, top: string) => (asks ? own || top : self?.professionalId);
  // By hand, the one above; with files, only those without their own need it.
  const senderMissing = (byHand: boolean) => asks && !topChosen && (byHand || ready.some(({ entry }) => !entry.details));
  const fieldErrors = {
    receivedVia: tried && staff && !receipt.receivedVia ? 'Choose how it arrived.' : undefined,
    receivedOn: tried && staff && !receipt.receivedOn ? 'Enter the date it arrived.' : undefined,
    sender: tried && asks && !topChosen ? (sender === ADD_NEW ? 'Give their first and last name, and their role.' : 'Choose whose work it is.') : undefined,
  };
  const complete = (byHand: boolean) => !(staff && !(receipt.receivedVia && receipt.receivedOn)) && !senderMissing(byHand);

  // The one chosen above, adding someone new first.
  async function topSender(): Promise<string> {
    if (!asks || sender !== ADD_NEW || !draft) return sender;
    const described = JSON.stringify(draft);
    if (addedDraft.current?.described !== described) {
      const added = await addProfessional(draft);
      addedDraft.current = { described, professionalId: added.professionalId };
    }
    return addedDraft.current!.professionalId;
  }

  // Every invoice from this upload is checked, one after another.
  function finish(invoiceIds: string[]) {
    const [first, ...queue] = invoiceIds;
    navigate(reviews ? reviewPath(first!) : checkLinesPath(first!, staff), { state: { queue, total: invoiceIds.length } satisfies CheckQueue });
  }

  // Goes on if nothing is missing; otherwise marks what is, and stays.
  async function goOn(byHand: boolean) {
    if (busy) return;
    if (!complete(byHand)) {
      setTried(true);
      return;
    }
    setBusy(true);
    setMessage(null);
    const received = staff ? receipt : {};
    try {
      const top = await topSender();
      if (byHand) {
        const created = await createInvoice({
          caseId: null,
          professionalId: senderFor('', top),
          submit: false,
          enterInReview: reviews,
          lines: [],
          ...received,
        });
        finish([created.invoiceId]);
        return;
      }
      const made: string[] = [];
      for (const { entry, read } of ready) {
        const created =
          entry.created ??
          // eslint-disable-next-line no-await-in-loop
          (await createUploadDraft(entry.uploadReadId!, {
            caseId: null,
            professionalId: senderFor(entry.details, top) ?? null,
            ...readPeriod(read.read),
            invoiceNumber: read.read.invoiceNumber?.trim() || undefined,
            caseNumber: read.read.caseNumber?.trim() || undefined,
            ...countyChoiceOf(read.read.county),
            // Reviewers enter and decide it in one pass, on its review.
            enterInReview: reviews,
            ...received,
          }));
        update(entry.key, { created });
        made.push(created.invoiceId);
      }
      finish(made);
    } catch (err) {
      setMessage(apiErrorMessage(err, 'The invoice could not be saved. Try again.'));
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

  const fromOptions = (billable ?? [])
    .map((p) => ({ value: p.professionalId, label: senderLabel(p) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return (
    <div className="portal-narrow">
      <PageHeader
        crumbs={[home, { label: entries.length > 1 ? 'New invoices' : 'New invoice' }]}
        title={entries.length > 1 ? 'Upload invoices' : 'Upload an invoice'}
      />
      <Steps reviewing={reviews} />
      <div className="upload-card">
        {(asks || staff) && (
          <div className="upload-card__about">
            <div className="upload-details">
              {staff && (
                <ReceivedFields
                  plain
                  idPrefix="upload"
                  value={receipt}
                  onChange={setReceipt}
                  errors={{ receivedVia: fieldErrors.receivedVia, receivedOn: fieldErrors.receivedOn }}
                />
              )}
              {asks && (
                <div className="upload-details__field">
                  <SenderPicker
                    id="upload-from"
                    value={sender}
                    billable={billable ?? []}
                    error={fieldErrors.sender}
                    hint={perFile ? `${BILLED_BY_HINT} An invoice billed by someone else is set below.` : BILLED_BY_HINT}
                    onChange={setSender}
                    addRowIn={addRow}
                    onDraft={setDraft}
                  />
                </div>
              )}
            </div>
            {/* Adding someone opens here, under all three, so none of them moves. */}
            <div ref={setAddRow} />
          </div>
        )}
        <DropZone hasFiles={entries.length > 0} onFiles={addFiles} />
        {entries.length === 0 && canEnterByHand && (
          <p className="manual-entry__offer">
            No file?{' '}
            <button type="button" className="link-button" disabled={busy} onClick={() => void goOn(true)}>
              Enter an invoice by hand
            </button>
          </p>
        )}
        {!staff && entries.length === 0 && (
          <Notice tone="info">
            Several files, or one spreadsheet that covers several cases? Use{' '}
            <RouterLink to="/portal/imports">Import invoices</RouterLink>, so you can check each one and send them together.
          </Notice>
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
        {asks && perFile && ready.length > 0 && (
          <ul className="file-senders" aria-label="Who billed each invoice">
            {ready.map(({ entry }) => (
              <li key={entry.key}>
                <label htmlFor={`upload-from-${entry.key}`}>{entry.file.name}</label>
                <select
                  id={`upload-from-${entry.key}`}
                  className="usa-select"
                  value={entry.details ?? ''}
                  disabled={Boolean(entry.created)}
                  onChange={(event) => update(entry.key, { details: event.target.value })}
                >
                  <option value="">Same as above</option>
                  {fromOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        )}
        {allFailed && canEnterByHand && (
          <p className="manual-entry__offer">
            {entries.length > 1 ? 'None of the files could be read.' : 'The file could not be read.'}{' '}
            <button type="button" className="link-button" disabled={busy} onClick={() => void goOn(true)}>
              Enter it by hand instead
            </button>
          </p>
        )}
        {message && <Notice tone="danger">{message}</Notice>}
        {entries.length > 0 && (
          <div className="upload-card__actions">
            {!allFailed && (
              <button type="button" className="btn btn--primary" disabled={busy || reading} onClick={() => void goOn(false)}>
                {busy ? 'Saving…' : 'Continue'}
              </button>
            )}
            <button type="button" className="link-button" disabled={busy} onClick={() => void cancel()}>
              Cancel
            </button>
            {reading && !busy && <span className="field-hint">Waiting for the files to be read.</span>}
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
