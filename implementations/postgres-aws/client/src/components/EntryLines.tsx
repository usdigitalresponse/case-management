// An upload entered in review: its reviewer types or corrects its lines
// beside the file and decides each as they go. The lines lock when the
// first round is finished (server/src/billing/enterInReview.ts).
import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import {
  ApiError,
  apiErrorMessage,
  saveEnteredLines,
  setEnteredCaseNumber,
  setEnteredReceipt,
  type InvoiceReceipt,
  type InvoiceReview,
  type InvoiceReviewLine,
} from '../api/client';
import { ReceivedFields } from '../portal/ReceivedFields';
import { CheckLinesTable } from '../portal/CheckLinesTable';
import { useLineEntry } from '../portal/useLineEntry';
import { EXTERNAL_SYSTEM_NAME } from '../externalSystem';
import { formatMoney } from '../formatMoney';
import { CaseNumberBox } from './CaseNumberBox';
import { Notice } from './Notice';
import { OriginalDocument } from './OriginalDocument';
import type { ToastMessage } from './Toast';

// Needed to finish the review.
export function EnteredCaseNumber({ invoice }: { invoice: InvoiceReview['invoice'] }) {
  const [value, setValue] = useState(invoice.caseNumberAsTyped ?? '');
  const missing = !value.trim();
  const [error, setError] = useState<string | null>(null);
  const saved = useRef(value);
  function save() {
    if (value.trim() === saved.current.trim()) return;
    const previous = saved.current;
    saved.current = value;
    setError(null);
    setEnteredCaseNumber(invoice.invoiceId, value).catch((err: unknown) => {
      saved.current = previous;
      setError(apiErrorMessage(err, 'The case number could not be saved. Try again.'));
    });
  }
  return (
    <CaseNumberBox
      id="entered-case-number"
      label="Case number"
      placeholder="For example, 26-CR-00418"
      value={value}
      readOnly={false}
      hint={missing ? 'Add the case number before you finish.' : 'As written on the invoice. It is not checked against a list of cases.'}
      error={error}
      missing={missing}
      onChange={setValue}
      onSave={save}
    >
      <strong>This invoice is filed under {invoice.professionalDisplayName ?? 'whom it is from'}, not under a case.</strong>
      <p>Reviewers use the case number to find the case in the {EXTERNAL_SYSTEM_NAME}.</p>
    </CaseNumberBox>
  );
}

// How and when it came in, saved as each is chosen, so the entry can be
// finished another day.
export function EntryReceipt({ invoice, onSaved }: { invoice: InvoiceReview['invoice']; onSaved: () => void }) {
  const [value, setValue] = useState<InvoiceReceipt>({ receivedOn: invoice.receivedOn ?? undefined });
  const [error, setError] = useState<string | null>(null);
  function change(next: InvoiceReceipt) {
    setValue(next);
    setError(null);
    setEnteredReceipt(invoice.invoiceId, next).then(onSaved, (err: unknown) =>
      setError(apiErrorMessage(err, 'That could not be saved. Try again.')),
    );
  }
  return (
    <>
      <ReceivedFields idPrefix="entry" value={value} onChange={change} receivedViaDisplayName={invoice.receivedViaDisplayName} />
      {error && <p className="field-error">{error}</p>}
    </>
  );
}

export function EntryLines({
  data,
  onSaved,
  onRefused,
  setToast,
  questions,
  ask,
  decision,
  form,
  saveEdits,
  onEditing,
}: {
  data: InvoiceReview;
  // After each save, with how many decisions it undid.
  onSaved: (undecided: number, linesVersion: number) => void;
  // A save refused because the lines changed elsewhere or the invoice was
  // taken over: the page reloads to show what is there now.
  onRefused: () => void;
  setToast: (toast: ToastMessage | null) => void;
  // Each line's questions, under its description; then a bar asking about
  // it on the left and deciding it on the right; then whatever is open on it.
  questions: (line: InvoiceReviewLine) => ReactNode;
  ask: (line: InvoiceReviewLine) => ReactNode;
  // Edited lines show the decision buttons, since saving undoes a decision.
  decision: (line: InvoiceReviewLine, edited: boolean) => ReactNode;
  form: (line: InvoiceReviewLine) => ReactNode;
  // Set to save the changes made in place, which the page does before its
  // next action, such as deciding a line or finishing.
  saveEdits: MutableRefObject<() => Promise<boolean>>;
  // A line changed in place.
  onEditing: (invoiceLineId: string) => void;
}) {
  const { invoice, fileSource } = data;
  const [focus, setFocus] = useState<{ location: string } | undefined>();
  // The version of the lines this page holds, sent with each save.
  const version = useRef(invoice.linesVersion);
  useEffect(() => {
    version.current = invoice.linesVersion;
  }, [invoice.linesVersion]);
  // Leaving saves what was changed, without telling a page that has moved on.
  const mounted = useRef(true);
  const { lines, rows, context, askingFor, duplicates, notice, undatedRow, fileSays, error, handlers, edited, editLine, flush } = useLineEntry({
    serverLines: data.lines,
    fileSource,
    caseId: invoice.caseId,
    professionalId: invoice.professionalId,
    save: async (lines, options) => {
      try {
        const saved = await saveEnteredLines(
          invoice.invoiceId,
          {
            periodStart: invoice.periodStart ?? undefined,
            periodEnd: invoice.periodEnd ?? undefined,
            lines,
            linesVersion: version.current,
          },
          options,
        );
        version.current = saved.linesVersion;
        if (mounted.current) onSaved(saved.undecided.length, saved.linesVersion);
      } catch (err) {
        if (err instanceof ApiError && err.status === 409 && mounted.current) onRefused();
        throw err;
      }
    },
    setToast,
    ownFile: false,
  });
  // One function for this page's life, so the one before it, unmounting
  // after this renders, only clears what it set.
  const latestFlush = useRef(flush);
  latestFlush.current = flush;
  const [ownSave] = useState(() => () => latestFlush.current());
  saveEdits.current = ownSave;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (saveEdits.current === ownSave) saveEdits.current = async () => true;
    };
  }, [saveEdits, ownSave]);
  const reviewLine = new Map(data.lines.map((line) => [line.invoiceLineId, line]));
  // A line not saved yet has nothing to decide.
  const lineAt = (index: number) => {
    const id = lines[index]?.invoiceLineId;
    return id ? reviewLine.get(id) : undefined;
  };

  return (
    <div className={fileSource ? 'submission__layout' : undefined}>
      {fileSource &&
        (fileSource.fileAvailable ? (
          <OriginalDocument
            invoiceId={invoice.invoiceId}
            fileName={fileSource.fileName}
            heading="The file, as uploaded"
            focus={focus}
            regions={fileSource.lines}
          />
        ) : (
          <section className="original-document original-document--gone">
            <p>The uploaded file {fileSource.fileName} is no longer kept.</p>
          </section>
        ))}
      <div className="submission__lines">
        {error && <Notice tone="danger">{error}</Notice>}
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
        {undatedRow && <Notice tone="warning">Line {undatedRow.number} has no date in the file. Enter its date before you finish.</Notice>}
        <CheckLinesTable
          rows={rows}
          context={context}
          warnings={fileSource?.warnings ?? []}
          duplicates={duplicates}
          editable
          focus={focus?.location}
          onFocus={(location) => setFocus(location ? { location } : undefined)}
          {...handlers}
          onEditLine={(index, patch) => {
            editLine(index, patch);
            const id = lines[index]?.invoiceLineId;
            if (id) onEditing(id);
          }}
          edited={(index) => edited.has(lines[index]?.invoiceLineId ?? '')}
          notes={(index) => {
            const line = lineAt(index);
            return line ? questions(line) : null;
          }}
          actions={(index) => {
            const line = lineAt(index);
            return line ? (
              <>
                <span className="line-bar__ask">{ask(line)}</span>
                <span className="line-bar__decide">{decision(line, edited.has(line.invoiceLineId))}</span>
              </>
            ) : null;
          }}
          detail={(index) => {
            const line = lineAt(index);
            return line ? form(line) : null;
          }}
          addLabel={fileSource ? 'Add a line we missed' : 'Add a line'}
          ownFile={false}
          footer={
            <div className="check-lines__totals">
              {fileSays !== null && (
                <div>
                  <span>The file says</span>
                  <span>{formatMoney(fileSays)}</span>
                </div>
              )}
              <div className="check-lines__asking">
                <span>Asked for</span>
                <strong>{formatMoney(askingFor)}</strong>
              </div>
            </div>
          }
        />
        <p className="compact-hint">
          Correct any line where it is, then decide it: your changes save when you do, or when you finish. Changing a decided
          line undoes its decision. The lines lock when you finish the review.
        </p>
      </div>
    </div>
  );
}
