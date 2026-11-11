import { type ImportInProgress } from '../../api/client';
import { caseDisplayLabel } from '../../caseDisplayLabel';
import { formatMoney } from '../../formatMoney';

// Cells shared by the check and send steps.
export function caseOf(row: ImportInProgress): string {
  return row.caseId ? caseDisplayLabel([row.caseExternalReference, row.caseClientDisplayName], undefined) : 'No case yet';
}

export function totalWithFile(row: ImportInProgress) {
  return (
    <>
      <span className="amount">{formatMoney(row.submittedTotal ?? '0')}</span>
      {row.statedTotal !== null && Number(row.statedTotal) !== Number(row.submittedTotal) && (
        <span className="line-amount-basis"> (file said {formatMoney(row.statedTotal)})</span>
      )}
    </>
  );
}
