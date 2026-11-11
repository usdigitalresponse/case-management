import type { ReactNode } from 'react';
import { EntryLines } from '../../components/EntryLines';
import { InvoiceLinesTable, lineRowClass } from '../../components/InvoiceLinesTable';
import { OriginalDocument } from '../../components/OriginalDocument';
import { ChangeNote, fileChangesFor, RemovedLines, WasNote, wasAmount, wasQuantity } from '../../components/SubmitterChanges';
import { overRouteNote } from '../../components/TravelLog';
import type { LineCells } from './lineCells';
import type { ReviewFacts } from './reviewFacts';
import type { ReviewPage } from './useReviewPage';

// The lines: edited in place while entering, else a table with the file or time log beside it.
export function ReviewLines({
  page,
  facts,
  cells,
  fileShown,
  logPanel,
  sideSwitch,
}: {
  page: ReviewPage;
  facts: ReviewFacts;
  cells: LineCells;
  fileShown: boolean;
  logPanel: ReactNode;
  sideSwitch: ReactNode;
}) {
  const { invoice, data, lines, timeLog, overRoute } = facts;
  const { fileSource } = data;

  if (facts.entering) {
    return (
      <EntryLines
        key={invoice.invoiceId}
        data={data}
        saveEdits={page.saveEdits}
        period={page.period}
        setToast={page.setToast}
        // While entering, a line's time log result sits under its description.
        questions={
          timeLog
            ? (line) => (
                <>
                  {cells.logCellOf(line)}
                  {cells.lineQuestions(line)}
                </>
              )
            : cells.lineQuestions
        }
        ask={cells.askLinkOf}
        decision={cells.decisionCell}
        form={cells.lineFormOf}
        onSaved={(undecided, savedVersion) => {
          page.knownVersion.current = Math.max(page.knownVersion.current, savedVersion);
          if (undecided > 0) {
            page.setActionError(null);
            page.setToast({ message: `Changed, so ${undecided === 1 ? 'its decision was' : `${undecided} decisions were`} undone. Decide it again.` });
          }
          // An action saving first reloads once it's done.
          if (!page.busy.current) void page.refresh();
        }}
        // Its open Approve part or Reject would decide on the old figures.
        onEditing={(lineId) => page.setPanel((open) => (open?.lineId === lineId ? null : open))}
        onRefused={() => void page.refresh()}
        log={logPanel}
        sideSwitch={sideSwitch}
      />
    );
  }

  const fileChanges = fileChangesFor(fileSource, lines);
  const beside = fileShown || Boolean(logPanel);
  return (
    <div className={beside ? 'review-file-layout' : undefined}>
      {beside && (
        <div className="side-panel">
          {sideSwitch}
          {logPanel}
          {fileShown && fileSource && (
            <OriginalDocument
              invoiceId={invoice.invoiceId}
              fileName={fileSource.fileName}
              heading={`${facts.fileOwner}'s file, as uploaded`}
              focus={page.fileFocus}
              regions={fileSource.lines}
            />
          )}
        </div>
      )}
      <div className="review-file-layout__lines">
        <InvoiceLinesTable
          lines={lines}
          note={(line) => (
            <>
              {overRoute.has(line.invoiceLineId) && <span className="cell-note line-rate-differs">{overRouteNote(line)}</span>}
              {fileSource && fileChanges.tracking && (
                <ChangeNote
                  line={line}
                  read={fileChanges.readOf(line)}
                  changed={fileChanges.fieldsOf(line).length > 0}
                  who={facts.changer}
                  onShow={
                    fileSource.fileAvailable && line.sourceLocation
                      ? () => {
                          page.setShowFile(true);
                          page.setFileFocus(line.sourceLocation ? { location: line.sourceLocation } : undefined);
                        }
                      : undefined
                  }
                />
              )}
            </>
          )}
          hoursNote={(line) => <WasNote value={wasQuantity(fileChanges.readOf(line), fileChanges.fieldsOf(line))} />}
          amountNote={(line) => <WasNote value={wasAmount(line, fileChanges.readOf(line), fileChanges.fieldsOf(line))} />}
          timeLog={timeLog ? cells.logCellOf : undefined}
          decisionHeader={facts.inReview ? 'Your decision' : 'Decision'}
          rowClassName={(line) =>
            lineRowClass(facts.current(line)?.outcomeCode, Boolean(cells.openPanel(line))) ?? (overRoute.has(line.invoiceLineId) ? 'is-flagged' : undefined)
          }
          decision={cells.decisionCell}
          rowDetail={cells.lineDetail}
        />
        <RemovedLines removed={fileChanges.removed} who={facts.changer} when={facts.changedWhen} />
        {fileShown && <p className="compact-hint">The file is read-only. It is exactly what was uploaded.</p>}
      </div>
    </div>
  );
}
