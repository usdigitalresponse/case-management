import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { apiErrorMessage, getInvoiceForReview, type InvoiceReview as InvoiceReviewData } from '../../api/client';
import { useResource } from '../../hooks/useResource';
import { decisionReasons, invoiceForReview } from '../../resources';
import type { PanelMode } from '../../components/LineReview';
import { useToast, type ToastMessage } from '../../components/Toast';
import type { CheckQueue } from '../../portal/InvoiceSubmission';
import { reviewPath } from '../../staffPaths';

// The review page's data, what is open on it, and running its actions.
export function useReviewPage(invoiceId: string, userAccountId: string | undefined) {
  const { data: loaded, error } = useResource(invoiceForReview(invoiceId));
  const { data: reasonData } = useResource(decisionReasons);
  // Refreshed in place after each action, so open panels aren't unmounted.
  const [refreshed, setRefreshed] = useState<InvoiceReviewData | null>(null);
  const latestRequest = useRef(0);
  const data = refreshed?.invoice.invoiceId === invoiceId ? refreshed : loaded;

  const [panel, setPanel] = useState<{ lineId: string; mode: PanelMode } | null>(null);
  const [changing, setChanging] = useState<string | null>(null);
  // A line's id, or 'invoice' for a question about the whole invoice.
  const [asking, setAsking] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toast, setToast] = useToast();
  // Null until chosen: shown when the submitter changed anything.
  const [showFile, setShowFile] = useState<boolean | null>(null);
  // A new object on every click, so the same line scrolls the file back to it.
  const [fileFocus, setFileFocus] = useState<{ location: string } | undefined>();
  // Time log: uploading, shown, the entries in focus, and the line being linked.
  const [uploadingLog, setUploadingLog] = useState(false);
  const [logShown, setLogShown] = useState(false);
  const [logFocus, setLogFocus] = useState<string[] | undefined>();
  const [linking, setLinking] = useState<string | null>(null);
  const navigate = useNavigate();
  // The rest of an upload, entered one after another.
  const checking = useLocation().state as CheckQueue | null;
  // The newest version of its lines this page knows: loaded, or just saved
  // and not yet reloaded. Decisions while entering send it.
  const knownVersion = useRef(0);
  // The invoice shown now, for an Undo offered on the one before.
  const shownId = useRef(invoiceId);
  shownId.current = invoiceId;
  // Finishing moves on to the upload's next invoice, keeping its message and Undo.
  const keepToast = useRef(false);
  // While entering, saves lines changed in place; false if they can't be saved.
  const saveEdits = useRef<() => Promise<boolean>>(async () => true);
  // Asked only of an invoice started without it; stays shown once given.
  const receiptAsked = useRef<{ invoiceId?: string; ask: boolean }>({ ask: false });
  // While entering, the billing period saved beside the lines, for line saves to carry.
  const period = useRef<{ invoiceId?: string; periodStart: string | null; periodEnd: string | null }>({ periodStart: null, periodEnd: null });
  // Set while an action runs, so a second click doesn't start another.
  const busy = useRef(false);

  useEffect(() => {
    latestRequest.current += 1;
    knownVersion.current = 0;
    setRefreshed(null);
    setPanel(null);
    setAsking(null);
    if (!keepToast.current) setToast(null);
    keepToast.current = false;
    setShowFile(null);
    setFileFocus(undefined);
    setUploadingLog(false);
    setLogShown(false);
    setLogFocus(undefined);
    setLinking(null);
  }, [invoiceId, setToast]);

  function refresh() {
    const request = ++latestRequest.current;
    return getInvoiceForReview(invoiceId).then((result) => {
      if (request === latestRequest.current) setRefreshed(result);
    });
  }

  // Someone else is entering it: their saved changes appear as they go.
  const watching = Boolean(data?.entryOpen) && data?.assignments?.reviewer?.userAccountId !== userAccountId;
  useEffect(() => {
    if (!watching) return undefined;
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 30_000);
    return () => window.clearInterval(timer);
    // refresh reads the current invoice id; restarting on it is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching, invoiceId]);

  if (data) {
    const { invoice } = data;
    knownVersion.current = Math.max(knownVersion.current, invoice.linesVersion);
    if (period.current.invoiceId !== invoice.invoiceId) {
      period.current = { invoiceId: invoice.invoiceId, periodStart: invoice.periodStart, periodEnd: invoice.periodEnd };
    }
    if (receiptAsked.current.invoiceId !== invoice.invoiceId) {
      receiptAsked.current = { invoiceId: invoice.invoiceId, ask: !(invoice.receivedOn && invoice.receivedViaDisplayName) };
    }
  }

  // Runs an action, then shows `next` (or what it returns) and reloads.
  async function act<T>(action: () => Promise<T>, next?: ToastMessage | ((result: T) => ToastMessage)) {
    if (busy.current) return false;
    busy.current = true;
    setSaving(true);
    setActionError(null);
    try {
      // Lines changed in place save first, so nothing acts on values not yet saved.
      if (!(await saveEdits.current())) return false;
      const result = await action();
      setPanel(null);
      setChanging(null);
      setAsking(null);
      setToast(typeof next === 'function' ? next(result) : (next ?? null));
      await refresh();
      return true;
    } catch (err) {
      setActionError(apiErrorMessage(err, 'That did not save. Try again.'));
      return false;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  // For an edited line, so the panel starts from its saved figures.
  async function openAfterSaving(lineId: string, mode: PanelMode) {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setActionError(null);
    try {
      if (!(await saveEdits.current())) return;
      await refresh();
      setPanel({ lineId, mode });
    } catch (err) {
      setActionError(apiErrorMessage(err, 'The line could not be reloaded. Try again.'));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  // Sent with a decision while lines are being entered, so one made on an
  // out-of-date page is refused.
  const linesVersion = () => (data?.entryOpen ? knownVersion.current : undefined);

  // The upload's next invoice, if any; true when there is one.
  function goToNext() {
    const [next, ...rest] = checking?.queue ?? [];
    if (!next) return false;
    navigate(reviewPath(next), { state: { queue: rest, total: checking!.total } satisfies CheckQueue });
    return true;
  }

  return {
    data,
    error,
    reasons: reasonData?.reasons ?? [],
    panel,
    setPanel,
    changing,
    setChanging,
    asking,
    setAsking,
    saving,
    actionError,
    setActionError,
    toast,
    setToast,
    showFile,
    setShowFile,
    fileFocus,
    setFileFocus,
    uploadingLog,
    setUploadingLog,
    logShown,
    setLogShown,
    logFocus,
    setLogFocus,
    linking,
    setLinking,
    navigate,
    checking,
    knownVersion,
    shownId,
    keepToast,
    saveEdits,
    receiptAsked,
    period,
    busy,
    refresh,
    act,
    openAfterSaving,
    linesVersion,
    goToNext,
  };
}

export type ReviewPage = ReturnType<typeof useReviewPage>;
