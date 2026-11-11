import { useParams } from 'react-router';
import { useAuth } from '../AuthContext';
import { LoadState } from '../components/LoadState';
import { Toast } from '../components/Toast';
import { SidePanelSwitch, TimeLogEntries } from '../components/TimeLogCheck';
import { useReviewPage } from './review/useReviewPage';
import { reviewFacts } from './review/reviewFacts';
import { lineCells } from './review/lineCells';
import { ReviewHeader } from './review/ReviewHeader';
import { TimeLogSection } from './review/TimeLogSection';
import { EntryAndCase } from './review/EntryAndCase';
import { ReviewFactsStrip } from './review/ReviewFactsStrip';
import { ReviewNotices } from './review/ReviewNotices';
import { ReviewLines } from './review/ReviewLines';
import { ReviewOutcome } from './review/ReviewOutcome';

export default function InvoiceReview() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const { user } = useAuth();
  const page = useReviewPage(invoiceId as string, user?.userAccountId);

  if (page.error || !page.data) {
    return <LoadState error={page.error} what="invoice" />;
  }

  const facts = reviewFacts(page.data, user?.userAccountId ?? '', user?.reviewPermissions);
  const cells = lineCells(page, facts);
  const { fileSource, timeLog } = page.data;
  // The file or the time log beside the lines, never both.
  const fileShown = Boolean(fileSource?.fileAvailable) && !page.logShown && (page.showFile ?? facts.changedCount > 0);
  const logBeside = page.logShown && timeLog ? timeLog : null;
  const logPanel = logBeside ? (
    <TimeLogEntries log={logBeside} focusKeys={page.logFocus} lineNumber={(lineId) => facts.lineNumber.get(lineId)} />
  ) : null;
  const sideSwitch =
    fileSource?.fileAvailable && timeLog ? (
      <SidePanelSwitch
        logShown={Boolean(logBeside)}
        onShowLog={(shown) => {
          page.setLogShown(shown);
          page.setShowFile(!shown);
        }}
      />
    ) : null;

  return (
    <div className="invoice-review">
      <ReviewHeader page={page} facts={facts} fileShown={fileShown} />
      <TimeLogSection page={page} facts={facts} cells={cells} logBeside={Boolean(logBeside)} />
      <EntryAndCase page={page} facts={facts} />
      <ReviewFactsStrip facts={facts} />
      <ReviewNotices page={page} facts={facts} />
      <ReviewLines page={page} facts={facts} cells={cells} fileShown={fileShown} logPanel={logPanel} sideSwitch={sideSwitch} />
      <ReviewOutcome page={page} facts={facts} />
      <Toast toast={page.toast} onUndo={(undo) => void page.act(undo, { message: 'Undone.' })} />
    </div>
  );
}
