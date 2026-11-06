// Entering an invoice's lines beside its file, on the check page and on an
// invoice entered in review. Saves go one at a time, each the whole set of
// lines; on a failure the page goes back to the last set the server holds.
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiErrorMessage, listBillableProfessionals, type FileLine, type FileSource, type PortalInvoiceLine } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { usePortalBillingRules } from '../components/BillingRules';
import { lineDraftsFrom, linesFromDrafts, type LineDraft } from '../components/InvoiceLinesEditor';
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
  save: (lines: ReturnType<typeof linesFromDrafts>) => Promise<unknown>;
  setToast: (toast: ToastMessage | null) => void;
  // False for staff entering someone else's invoice.
  ownFile: boolean;
}) {
  const [lines, setLines] = useState<LineDraft[]>(() => lineDraftsFrom(serverLines, { perLine: true }));
  const [error, setError] = useState<string | null>(null);
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const saved = useRef(lines);
  const pending = useRef(0);

  useEffect(() => {
    if (pending.current > 0) return;
    const fresh = lineDraftsFrom(serverLines, { perLine: true });
    saved.current = fresh;
    setLines(fresh);
  }, [serverLines]);

  const { mileageRates, timeCategoryRates } = usePortalBillingRules();
  const { data: timekeepers } = useApiResource(() => listBillableProfessionals(caseId).then((result) => result.professionals), [caseId]);
  const ownMileageRates = timekeepers?.find((p) => p.professionalId === professionalId)?.mileageRates ?? [];
  const context: PricingContext = {
    timekeepers: timekeepers ?? [],
    billedProfessionalId: professionalId ?? undefined,
    mileageRates: ownMileageRates.length > 0 ? ownMileageRates : mileageRates,
    timeCategoryRates,
  };

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

  function save(changed: LineDraft[]): Promise<void> {
    // A new line gets its id now, which the server keeps, so the next save
    // finds it rather than making it again.
    const next = changed.map((line) => (line.invoiceLineId ? line : { ...line, invoiceLineId: crypto.randomUUID() }));
    setLines(next);
    pending.current += 1;
    const done = saving.current.then(async () => {
      await saveLines(linesFromDrafts(next));
      saved.current = next;
    });
    saving.current = done.catch(() => setLines(saved.current)).finally(() => {
      pending.current -= 1;
    });
    return done;
  }

  // With Undo back to the set before.
  async function persist(next: LineDraft[], message: string) {
    const previous = lines;
    setError(null);
    try {
      await save(next);
      setToast({ message, undo: () => save(previous) });
    } catch (err) {
      setError(apiErrorMessage(err, 'That change could not be saved. Try again.'));
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

  return { lines, rows, context, askingFor, duplicates, changes, notice, undatedRow, fileSays, error, setError, handlers };
}
