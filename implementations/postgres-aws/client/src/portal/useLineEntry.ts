// Entering lines beside the file, on the check page and in review. Saves go one at a time, each the whole
// set; a failure goes back to the last set the server holds, keeping changes made in place.
import { billableProfessionals } from '../resources';
import { useResource } from '../hooks/useResource';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, apiErrorMessage, type FileLine, type FileSource, type PortalInvoiceLine } from '../api/client';
import { useSaveBeforeLeaving } from '../hooks/useSaveBeforeLeaving';
import { usePortalBillingRules } from '../components/BillingRules';
import { lineDraftsFrom, linesFromDrafts, type LineDraft } from '../invoiceLines';
import type { ToastMessage } from '../components/Toast';
import { changedFields, duplicateOf, rowsInFileOrder, tracksSource } from '../fileChanges';
import { draftFromRead, priceOf, rowChanges, totalsNotice, valuesOf, type PricingContext } from './checkLines';

export function useLineEntry({
  serverLines,
  fileSource,
  caseId,
  professionalId,
  save: saveLines,
  setToast,
  ownFile,
}: {
  // Taken up again whenever it changes and nothing is waiting to save, so
  // new lines get the ids their decisions hang on.
  serverLines: PortalInvoiceLine[];
  fileSource: FileSource | null;
  caseId: string | null;
  professionalId: string | null;
  // keepalive: sent as the page closes, so the save outlives it.
  save: (lines: ReturnType<typeof linesFromDrafts>, options: { keepalive: boolean }) => Promise<unknown>;
  setToast: (toast: ToastMessage | null) => void;
  // False for staff entering someone else's invoice.
  ownFile: boolean;
}) {
  const [lines, setLines] = useState<LineDraft[]>(() => lineDraftsFrom(serverLines, { perLine: true }));
  const [error, setError] = useState<string | null>(null);
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const saved = useRef(lines);
  const pending = useRef(0);
  // Ids of lines changed in place and not saved yet; flush() saves them.
  const [edited, setEdited] = useState<ReadonlySet<string>>(() => new Set());
  const editedNow = useRef(edited);
  editedNow.current = edited;
  const latest = useRef(lines);
  latest.current = lines;

  useEffect(() => {
    if (pending.current > 0 || editedNow.current.size > 0) return;
    const fresh = lineDraftsFrom(serverLines, { perLine: true });
    saved.current = fresh;
    setLines(fresh);
  }, [serverLines]);

  const { mileageRates, timeCategoryRates } = usePortalBillingRules();
  const { data: timekeepers } = useResource(billableProfessionals(caseId));
  const ownMileageRates = timekeepers?.find((p) => p.professionalId === professionalId)?.mileageRates ?? [];
  const context: PricingContext = {
    timekeepers: timekeepers ?? [],
    billedProfessionalId: professionalId ?? undefined,
    mileageRates: ownMileageRates.length > 0 ? ownMileageRates : mileageRates,
    timeCategoryRates,
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fileLines = fileSource && tracksSource(lines.map((line) => line.carried.sourceLocation)) ? fileSource.lines : [];
  const rows = useMemo(() => rowsInFileOrder(fileLines, lines, (line) => line.carried.sourceLocation), [fileLines, lines]);
  const totals = rows.map((row) => (row.kind === 'line' ? priceOf(row.line, context).total : 0));
  const askingFor = totals.some((total) => total === null) ? null : totals.reduce<number>((sum, total) => sum + Math.round((total ?? 0) * 100), 0) / 100;
  const duplicates = duplicateOf(rows, (line) => ({ ...valuesOf(line), total: priceOf(line, context).total }));
  const changes = rowChanges(rows, (row) => Boolean(row.read) && changedFields(row.read!, valuesOf(row.line)).length > 0);
  const warningRow = rows.find(
    (row) => row.kind === 'line' && row.read && fileSource?.warnings.some((warning) => warning.location === row.read!.location),
  );
  const notice = totalsNotice({
    source: fileSource,
    askingFor,
    ...changes,
    duplicates,
    ownFile,
    warningLine:
      warningRow && warningRow.kind === 'line'
        ? {
            number: warningRow.number,
            message: fileSource!.warnings.find((warning) => warning.location === warningRow.read!.location)!.message,
          }
        : null,
  });
  // Only lines read from the file must have a date.
  const undatedRow = rows.find((row) => row.kind === 'line' && row.read && !row.line.serviceDate);
  const fileSays = fileSource ? (fileSource.statedTotal ?? fileLines.reduce((sum, line) => sum + (line.amount ?? 0), 0)) : null;

  // Lines just saved are no longer unsaved, unless changed again meanwhile.
  function markSaved(next: LineDraft[]) {
    const byId = new Map(next.map((line) => [line.invoiceLineId, line]));
    setEdited((current) => new Set([...current].filter((id) => latest.current.find((line) => line.invoiceLineId === id) !== byId.get(id))));
  }

  // Saving an unpriceable line would drop it, so its saved version goes instead.
  function savable(next: LineDraft[]): LineDraft[] {
    return next.flatMap((line) => {
      if (!editedNow.current.has(line.invoiceLineId ?? '') || priceOf(line, context).total !== null) return [line];
      const before = saved.current.find((was) => was.invoiceLineId === line.invoiceLineId);
      return before ? [before] : [];
    });
  }

  // Resolves to the lines as saved; a failure rolls back to them, keeping edits in place.
  function save(changed: LineDraft[], { rollback = true, keepalive = false } = {}): Promise<LineDraft[]> {
    // A new line gets its id now, which the server keeps, so the next save
    // finds it rather than making it again.
    const next = changed.map((line) => (line.invoiceLineId ? line : { ...line, invoiceLineId: crypto.randomUUID() }));
    setLines(next);
    const payload = savable(next);
    pending.current += 1;
    const done = saving.current.then(async () => {
      await saveLines(linesFromDrafts(payload), { keepalive });
      saved.current = payload;
      return payload;
    });
    saving.current = done
      .catch(() => {
        if (!rollback) return;
        const kept = new Map(latest.current.filter((line) => editedNow.current.has(line.invoiceLineId ?? '')).map((line) => [line.invoiceLineId, line]));
        setLines(saved.current.map((line) => kept.get(line.invoiceLineId) ?? line));
      })
      .finally(() => {
        pending.current -= 1;
      });
    return done;
  }

  // With Undo back to the set before.
  async function persist(next: LineDraft[], message: string) {
    const previous = lines;
    setError(null);
    try {
      markSaved(await save(next));
      setToast({ message, undo: () => save(previous) });
    } catch (err) {
      setError(apiErrorMessage(err, 'That change could not be saved. Try again.'));
    }
  }

  // A change in place, kept unsaved; a trip's lines share its date and route.
  function editLine(index: number, patch: Partial<LineDraft>) {
    const target = lines[index];
    if (!target) return;
    const shared = Object.fromEntries(
      Object.entries(patch).filter(([field]) => ['serviceDate', 'tripOrigin', 'tripDestination', 'roundTrip'].includes(field)),
    );
    const next = lines.map((line, at) =>
      at === index ? { ...line, ...patch } : target.tripKey && line.tripKey === target.tripKey ? { ...line, ...shared } : line,
    );
    setLines(next);
    // Typed back to what is saved, a line is no longer changed.
    const asSaved = (line: LineDraft | undefined) => JSON.stringify(line ? linesFromDrafts([line]) : null);
    const differs = (line: LineDraft) => asSaved(line) !== asSaved(saved.current.find((was) => was.invoiceLineId === line.invoiceLineId));
    const touched = next.filter((line, at) => line !== lines[at] && line.invoiceLineId);
    setEdited((current) => {
      const updated = new Set(current);
      for (const line of touched) {
        if (differs(line)) updated.add(line.invoiceLineId!);
        else updated.delete(line.invoiceLineId!);
      }
      return updated;
    });
  }

  // False if an edit can't be priced yet or the save failed; leaving saves what it can.
  async function flush({ leaving = false } = {}): Promise<boolean> {
    if (editedNow.current.size === 0) return true;
    const unpriced = rows.find(
      (row) => row.kind === 'line' && editedNow.current.has(row.line.invoiceLineId ?? '') && priceOf(row.line, context).total === null,
    );
    if (unpriced?.kind === 'line' && !leaving) {
      setError(`Line ${unpriced.number}: ${priceOf(unpriced.line, context).missing ?? 'finish it'}. Your changes are not saved yet.`);
      return false;
    }
    setError(null);
    const current = latest.current;
    try {
      markSaved(await save(current, { rollback: false, keepalive: leaving }));
      return true;
    } catch (err) {
      // Changed elsewhere: show the lines as they are now rather than overwrite them.
      if (err instanceof ApiError && err.status === 409) {
        setLines(saved.current);
        editedNow.current = new Set();
        setEdited(editedNow.current);
        setError('These lines were changed elsewhere, so your unsaved changes were not kept.');
      } else {
        setError(apiErrorMessage(err, 'Your changes could not be saved. Try again.'));
      }
      return false;
    }
  }

  // The line table's changes.
  const handlers = {
    onSaveLine: (index: number | null, drafts: LineDraft[], number: number) => {
      const [draft] = drafts;
      // A trip's lines share its date, so changing one changes them all.
      const next =
        index === null
          ? [...lines, ...drafts]
          : lines.map((line, at) =>
              at === index ? draft! : draft?.tripKey && line.tripKey === draft.tripKey ? { ...line, serviceDate: draft.serviceDate } : line,
            );
      void persist(next, index === null ? (drafts.length > 1 ? 'Trip added.' : 'Line added.') : `Line ${number} changed.`);
    },
    onRemoveLine: (index: number, number: number) => void persist(lines.filter((_, at) => at !== index), `Line ${number} removed.`),
    onTrip: (index: number, tripKey: string | undefined, number: number) => {
      // Joining takes the trip's date and route, as the server would.
      const trip = tripKey ? lines.find((line) => line.tripKey === tripKey) : undefined;
      const next = lines.map((line, at) =>
        at !== index
          ? line
          : trip
            ? { ...line, tripKey, serviceDate: trip.serviceDate, tripOrigin: trip.tripOrigin, tripDestination: trip.tripDestination, roundTrip: trip.roundTrip }
            : { ...line, tripKey: undefined },
      );
      void persist(next, tripKey ? `Line ${number} added to the trip.` : `Line ${number} taken off the trip.`);
    },
    onPutBack: (read: FileLine, number: number) => {
      // In its file place, which sets its saved position.
      const restored = draftFromRead(read, professionalId ?? undefined);
      const next = rows.flatMap((row) => (row.kind === 'line' ? [row.line] : row.read === read ? [restored] : []));
      void persist(next, `Line ${number} put back.`);
    },
    onUndoChange: (index: number, read: FileLine, number: number) =>
      void persist(
        lines.map((line, at) => (at === index ? { ...draftFromRead(read, professionalId ?? undefined), invoiceLineId: line.invoiceLineId } : line)),
        `Line ${number} put back as read.`,
      ),
  };

  useSaveBeforeLeaving({
    unsaved: () => editedNow.current.size > 0,
    save: () => flushNow.current(),
    edits: edited,
    onRefused: () => setError((shown) => shown && `${shown} Leave again to go anyway.`),
  });

  // Closing the tab, or leaving anyway, saves what was changed in place.
  const flushNow = useRef(flush);
  flushNow.current = flush;
  useEffect(() => {
    const leave = () => void flushNow.current({ leaving: true });
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
      leave();
    };
  }, []);

  return { lines, rows, context, askingFor, duplicates, changes, notice, undatedRow, fileSays, error, setError, handlers, edited, editLine, flush };
}
