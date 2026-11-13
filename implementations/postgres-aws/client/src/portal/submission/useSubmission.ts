import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  answerQuestion,
  apiErrorMessage,
  fieldError,
  resolveInvoiceImport,
  setDraftCaseNumber,
  transitionInvoice,
  updateDraftInvoice,
  type Overrun,
  type PortalInvoice,
} from '../../api/client';
import { useAuth } from '../../AuthContext';
import { formatMoney } from '../../formatMoney';
import type { useToast } from '../../components/Toast';
import { useReceipt } from '../ReceivedFields';
import { useLineEntry } from '../useLineEntry';
import { PORTAL_HOME_PATH, useShell } from '../useShell';
import { checkLinesPath, type CheckQueue } from '../checkQueue';
import { linesSummary, submissionFacts } from './submissionFacts';

// The file viewer's location for the case number, beside the lines'.
export const CASE_NUMBER_LOCATION = 'case-number';

// As the server words it (server/src/billing/overrunExplanation.ts).
function overrunMessage(overrun: Overrun): string {
  const limit = overrun.source === 'threshold' ? 'threshold' : 'pre-authorized';
  return `This takes the provider to ${formatMoney(overrun.total)} on this case, over the ${formatMoney(overrun.limit)} ${limit}. Explain why more wasn't pre-authorized.`;
}

export function useSubmission({
  data,
  filedByPerson,
  onChanged,
  setToast,
}: {
  data: PortalInvoice;
  // Unset: filed by person unless it was filed under a case.
  filedByPerson: boolean | undefined;
  onChanged: () => void;
  setToast: ReturnType<typeof useToast>[1];
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { staff } = useShell();
  const { user } = useAuth();
  const facts = submissionFacts(data, { userId: user?.userAccountId, staff, filedByPerson });
  const { invoice, byPerson } = facts;
  const { fileSource } = data;
  // As saved beside the lines, which carry it on each save.
  const savedPeriod = useRef({ periodStart: invoice.periodStart, periodEnd: invoice.periodEnd });
  const [senderMissing, setSenderMissing] = useState(false);
  const entry = useLineEntry({
    serverLines: data.lines,
    fileSource,
    caseId: invoice.caseId,
    professionalId: invoice.professionalId,
    save: (next, options) =>
      updateDraftInvoice(
        invoice.invoiceId,
        {
          periodStart: savedPeriod.current.periodStart ?? undefined,
          periodEnd: savedPeriod.current.periodEnd ?? undefined,
          lines: next,
        },
        options,
      ),
    setToast,
    ownFile: !staff,
  });
  const { flush, setError } = entry;
  const [typedCaseNumber, setTypedCaseNumber] = useState(invoice.caseNumberAsTyped ?? '');
  // Highlighted on the file while the box holds the number read from it.
  const fileCaseNumber = byPerson ? fileSource?.caseNumber : null;
  const readFromFile = Boolean(fileCaseNumber && typedCaseNumber.trim() === fileCaseNumber.value);
  const caseNumberRegion = readFromFile && fileCaseNumber?.region ? [{ location: CASE_NUMBER_LOCATION, region: fileCaseNumber.region }] : [];
  // A new object on every click, so clicking the same line scrolls back to it.
  const [focus, setFocus] = useState<{ location: string } | undefined>(() =>
    caseNumberRegion.length > 0 ? { location: CASE_NUMBER_LOCATION } : undefined,
  );
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  // Staff tried to send without saying which case it is for.
  const [caseAnswerMissing, setCaseAnswerMissing] = useState(false);
  const [answering, setAnswering] = useState(false);
  // From the latest load, so choosing a case shows it; a refused send's note
  // holds only until the next load.
  const [refused, setRefused] = useState<{ forData: typeof data; message: string } | null>(null);
  const overrun =
    refused?.forData === data
      ? { message: refused.message, required: true }
      : data.overrun
        ? { message: overrunMessage(data.overrun), required: !staff }
        : null;
  const receipt = useReceipt('send', { receivedOn: invoice.receivedOn, receivedViaDisplayName: invoice.receivedViaDisplayName });
  const checking = location.state as CheckQueue | null;

  // Where to go once this one is sent or saved for later.
  const goOn = () => {
    const [next, ...rest] = checking?.queue ?? [];
    if (next) {
      navigate(checkLinesPath(next, staff), { state: { queue: rest, total: checking!.total } satisfies CheckQueue });
      return true;
    }
    return false;
  };

  async function send(extra: { overrunExplanation?: string } = {}) {
    setSendError(null);
    if (!(await flush())) {
      setSending(false);
      return;
    }
    try {
      if (fileSource && fileSource.importStatusCode !== 'confirmed') {
        await resolveInvoiceImport(fileSource.invoiceImportId, 'confirm');
      }
      const { status: sentAs, caseProblem } = await transitionInvoice(
        invoice.invoiceId,
        'submit',
        { ...(byPerson ? { ...receipt.payload, attested: !staff, filedByPerson: true } : { attested: true }), ...extra },
      );
      setSending(false);
      setToast({
        message: caseProblem
          ? `Invoice sent for review, without its case: ${caseProblem} Choose it on the review page.`
          : sentAs !== 'awaiting_match'
            ? 'Invoice sent for review.'
            : 'Invoice sent. Who billed it isn’t chosen, so it waits to be matched first.',
        undo: () => transitionInvoice(invoice.invoiceId, 'recall').then(onChanged),
      });
      if (!goOn()) {
        onChanged();
      }
    } catch (err) {
      const overrunNote = fieldError(err, 'overrunExplanation');
      if (overrunNote) {
        // Lines changed since loading.
        setRefused({ forData: data, message: overrunNote });
        return;
      }
      setSendError(apiErrorMessage(err, 'The invoice could not be sent. Check the lines and try again.'));
    }
  }

  async function withdraw() {
    setWithdrawError(null);
    try {
      await transitionInvoice(invoice.invoiceId, 'recall');
      setWithdrawing(false);
      setToast({ message: 'Invoice withdrawn. It is back in your drafts.' });
      onChanged();
    } catch (err) {
      setWithdrawError(apiErrorMessage(err, 'The invoice could not be withdrawn.'));
    }
  }

  async function startSending() {
    const noSender = byPerson && !invoice.professionalId;
    // External senders may leave the case question unanswered (model/rules.yaml match_invoice_to_case).
    const noCaseAnswer =
      byPerson && staff && !invoice.caseId && (!invoice.caseChoice || (invoice.caseChoice === 'none' && !invoice.countyId));
    setSenderMissing(noSender);
    if (noCaseAnswer) setCaseAnswerMissing(true);
    if (noSender || noCaseAnswer) return;
    // The case number box otherwise saves only on losing focus.
    if (!(await flush())) return;
    try {
      if (byPerson && !invoice.caseId) await setDraftCaseNumber(invoice.invoiceId, typedCaseNumber);
      setSending(true);
    } catch (err) {
      setError(apiErrorMessage(err, 'The case number could not be saved. Try again.'));
    }
  }

  async function finishLater() {
    if (!(await flush())) return;
    if (!goOn()) navigate(byPerson && staff ? '/' : PORTAL_HOME_PATH);
  }

  async function answer(questionId: string, text: string) {
    setAnswering(true);
    setError(null);
    try {
      await answerQuestion(invoice.invoiceId, questionId, text, true);
      setToast({ message: 'Answer sent.' });
      onChanged();
      return true;
    } catch (err) {
      setError(apiErrorMessage(err, 'The answer could not be sent. Try again.'));
      return false;
    } finally {
      setAnswering(false);
    }
  }

  return {
    data,
    facts,
    staff,
    user,
    navigate,
    onChanged,
    entry,
    linesSummary: linesSummary(entry.lines.length, entry.changes),
    savedPeriod,
    senderMissing,
    typedCaseNumber,
    setTypedCaseNumber,
    readFromFile,
    caseNumberRegion,
    focus,
    setFocus,
    sending,
    setSending,
    sendError,
    setSendError,
    withdrawing,
    setWithdrawing,
    withdrawError,
    setWithdrawError,
    caseAnswerMissing,
    answering,
    overrun,
    receipt,
    checking,
    position: checking ? checking.total - checking.queue.length : null,
    send,
    withdraw,
    startSending,
    finishLater,
    answer,
  };
}

export type Submission = ReturnType<typeof useSubmission>;
