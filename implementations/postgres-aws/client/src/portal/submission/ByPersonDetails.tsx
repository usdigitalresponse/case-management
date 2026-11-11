import { setDraftCounty, setDraftDetails, setDraftSender } from '../../api/client';
import { Notice } from '../../components/ui/Notice';
import { InvoiceDetailsFields } from '../../components/InvoiceDetailsFields';
import { SavedCountyPicker } from '../../components/CountyPicker';
import { countyValueOf } from '../../counties';
import { CaseChoice } from './CaseChoice';
import { DecisionTotals } from './DecisionTotals';
import { TypedCaseNumber } from './TypedCaseNumber';
import { CASE_NUMBER_LOCATION, type Submission } from './useSubmission';

export function ByPersonDetails({ s }: { s: Submission }) {
  const { data, staff, onChanged, typedCaseNumber, setTypedCaseNumber, caseNumberMissing } = s;
  const { invoice, editable, decided, fromName } = s.facts;
  const { flush } = s.entry;
  return (
    <>
      {editable && (
        <InvoiceDetailsFields
          invoice={invoice}
          missingSender={s.senderMissing && !invoice.professionalId}
          action="send"
          warnings={data.fileSource?.warnings ?? []}
          saveSender={async (choice) => {
            if (!(await flush())) throw new Error('Line changes not saved');
            await setDraftSender(invoice.invoiceId, choice);
            onChanged();
          }}
          saveDetails={(details) => setDraftDetails(invoice.invoiceId, details)}
          onSenderRenamed={onChanged}
          onPeriodChanged={(saved) => {
            s.savedPeriod.current = saved;
          }}
        />
      )}
      {editable && !staff && (
        <CaseChoice
          invoice={invoice}
          beforeChange={flush}
          onChanged={(caseNumber) => {
            if (caseNumber) setTypedCaseNumber(caseNumber);
            onChanged();
          }}
        />
      )}
      {caseNumberMissing && !typedCaseNumber.trim() && (
        <Notice tone="warning">This invoice needs a case number before it can be sent. Type it in the box below.</Notice>
      )}
      <TypedCaseNumber
        invoiceId={invoice.invoiceId}
        value={typedCaseNumber}
        onChange={setTypedCaseNumber}
        editable={editable && !invoice.caseId}
        chosenCase={invoice.caseId ? (data.caseNumber ?? typedCaseNumber) : null}
        missing={caseNumberMissing && !typedCaseNumber.trim()}
        fromName={fromName}
        hasFile={Boolean(data.fileSource)}
        readFromFile={s.readFromFile}
        corrected={invoice.caseNumberCorrected}
        own={!staff}
        onFocus={() => s.caseNumberRegion.length > 0 && s.setFocus({ location: CASE_NUMBER_LOCATION })}
        county={
          editable ? (
            <SavedCountyPicker
              id="county"
              initial={countyValueOf(invoice)}
              save={(choice) => setDraftCounty(invoice.invoiceId, choice)}
              hint="Or post-conviction or prison, if that is what it is for."
            />
          ) : (
            <p className="field-hint">County: {invoice.countyDisplayName ?? 'Not added'}</p>
          )
        }
      />
      {decided && data.approvedTotal !== null && <DecisionTotals data={data} />}
      {decided &&
        (data.decisionComments ?? []).map((entry) => (
          <Notice
            key={entry.decidedAt}
            tone={entry.outcomeCode === 'rejected' ? 'warning' : 'info'}
            heading={entry.outcomeCode === 'rejected' ? 'Why the invoice was rejected' : 'A comment on the invoice'}
          >
            {entry.comment}
          </Notice>
        ))}
    </>
  );
}
