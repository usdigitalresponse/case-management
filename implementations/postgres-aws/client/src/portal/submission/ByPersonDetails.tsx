import { setDraftCounty, setDraftDetails, setDraftSender } from '../../api/client';
import { InvoiceDetailsFields } from '../../components/InvoiceDetailsFields';
import { SavedCountyPicker } from '../../components/CountyPicker';
import { countyValueOf } from '../../counties';
import { CaseStep } from '../../components/CaseStep';
import { DecisionTotals } from './DecisionTotals';
import { FileCaseNumber } from './FileCaseNumber';
import { TypedCaseNumber } from './TypedCaseNumber';
import { CASE_NUMBER_LOCATION, type Submission } from './useSubmission';

export function ByPersonDetails({ s }: { s: Submission }) {
  const { data, staff, onChanged, typedCaseNumber, setTypedCaseNumber, caseAnswerMissing } = s;
  const { invoice, editable, decided, fromName } = s.facts;
  const { flush } = s.entry;
  const showCaseNumberOnFile = () => s.caseNumberRegion.length > 0 && s.setFocus({ location: CASE_NUMBER_LOCATION });
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
      {staff ? (
        <TypedCaseNumber
          invoiceId={invoice.invoiceId}
          value={typedCaseNumber}
          onChange={setTypedCaseNumber}
          editable={editable && !invoice.caseId}
          chosenCase={invoice.caseId ? (data.caseNumber ?? typedCaseNumber) : null}
          fromName={fromName}
          hasFile={Boolean(data.fileSource)}
          readFromFile={s.readFromFile}
          corrected={invoice.caseNumberCorrected}
          onFocus={showCaseNumberOnFile}
          onSaved={onChanged}
          county={
            editable ? (
              <SavedCountyPicker
                id="county"
                initial={countyValueOf(invoice)}
                save={(choice) =>
                  setDraftCounty(invoice.invoiceId, choice).then((saved) => {
                    onChanged();
                    return saved;
                  })
                }
                hint="Or post-conviction or prison, if that is what it is for."
              />
            ) : (
              <p className="field-hint">County: {invoice.countyDisplayName ?? 'Not added'}</p>
            )
          }
        />
      ) : (
        <FileCaseNumber
          invoice={invoice}
          caseNumber={data.caseNumber}
          editable={editable}
          onShowOnFile={s.caseNumberRegion.length > 0 ? showCaseNumberOnFile : undefined}
        />
      )}
      {editable && staff && !invoice.caseId && <CaseStep invoice={invoice} mode="draft" missing={caseAnswerMissing} beforeChange={flush} onChanged={onChanged} />}
      {decided && data.approvedTotal !== null && <DecisionTotals data={data} />}
    </>
  );
}
