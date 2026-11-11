import { TimeLogSummary, TimeLogUpload } from '../../components/TimeLogCheck';
import { EXTERNAL_SYSTEM_NAME } from '../../externalSystem';
import type { LineCells } from './lineCells';
import type { ReviewFacts } from './reviewFacts';
import type { ReviewPage } from './useReviewPage';

// Under the header, beside the button that opens it.
export function TimeLogSection({ page, facts, cells, logBeside }: { page: ReviewPage; facts: ReviewFacts; cells: LineCells; logBeside: boolean }) {
  const { invoice, lines, timeLog, canDecide } = facts;
  if (timeLog) {
    const people = [
      ...new Map(
        [
          ...lines.flatMap((line) =>
            line.timekeeperProfessionalId && line.timekeeperDisplayName ? [[line.timekeeperProfessionalId, line.timekeeperDisplayName] as const] : [],
          ),
          ...(invoice.professionalId && invoice.professionalDisplayName ? [[invoice.professionalId, invoice.professionalDisplayName] as const] : []),
        ],
      ),
    ].map(([professionalId, displayName]) => ({ professionalId, displayName }));
    return (
      <TimeLogSummary
        invoiceId={invoice.invoiceId}
        log={timeLog}
        people={people}
        canChange={canDecide}
        logShown={logBeside}
        onShowLog={(shown) => {
          page.setLogShown(shown);
          if (shown) page.setShowFile(false);
        }}
        onChanged={(message) => void cells.onLogChanged(message)}
      />
    );
  }
  if (!page.uploadingLog || !canDecide) return null;
  return (
    <section className="card time-log-summary" aria-labelledby="time-log-heading">
      <h2 id="time-log-heading">Check a time log</h2>
      <p className="cell-note">
        Upload this case's time log, exported from your {EXTERNAL_SYSTEM_NAME} as .xlsx or .csv. Each time line is compared with it by date,
        person and hours. The log is kept only until you finish the review.
      </p>
      <TimeLogUpload
        invoiceId={invoice.invoiceId}
        replacing={false}
        onCancel={() => page.setUploadingLog(false)}
        onUploaded={() => {
          page.setUploadingLog(false);
          void cells.onLogChanged('Time log uploaded. Each time line shows what the log says.');
        }}
      />
    </section>
  );
}
