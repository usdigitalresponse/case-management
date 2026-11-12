import { useRef, useState, type ReactNode } from 'react';
import { apiErrorMessage, setDraftCaseNumber } from '../../api/client';
import { CaseNumberBox } from '../../components/CaseNumberBox';
import { EXTERNAL_SYSTEM_NAME } from '../../externalSystem';

// The typed case number, saved as a draft.
export function TypedCaseNumber({
  invoiceId,
  value,
  onChange,
  editable,
  missing,
  fromName,
  hasFile,
  readFromFile,
  own,
  corrected,
  chosenCase = null,
  onFocus,
  onSaved,
  county,
}: {
  // Once a changed number is saved, so the case it finds is looked up again.
  onSaved?: () => void;
  invoiceId: string;
  county: ReactNode;
  // The sender's case it is under, instead of a typed number.
  chosenCase?: string | null;
  // A reviewer's correction, shown in its place.
  corrected: string | null;
  value: string;
  onChange: (value: string) => void;
  editable: boolean;
  missing: boolean;
  fromName: string;
  hasFile: boolean;
  readFromFile: boolean;
  // The submitter's own, not one staff entered.
  own: boolean;
  onFocus: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const saved = useRef(value);
  function save() {
    if (value.trim() === saved.current.trim()) return;
    const previous = saved.current;
    saved.current = value;
    setError(null);
    setDraftCaseNumber(invoiceId, value).then(onSaved, (err: unknown) => {
      saved.current = previous;
      setError(apiErrorMessage(err, 'The case number could not be saved. Try again.'));
    });
  }
  const yours = own ? 'your' : 'the';
  const hint = (() => {
    if (chosenCase) return `The number of the case you chose, ${chosenCase}.`;
    if (missing) return 'Add the case number before you send.';
    if (corrected) return `Corrected by the billing office. ${own ? 'You' : 'The sender'} typed ${value || 'none'}.`;
    if (!editable) return own ? 'As you typed it. The billing office did not change it.' : 'As typed. It is not checked against a list of cases.';
    if (readFromFile) return `We read this from ${yours} file. Change it if it is wrong.`;
    if (value.trim()) return 'Change it if it is wrong.';
    return hasFile ? `We could not find a case number in ${yours} file.` : `Type the case number from ${yours} court papers.`;
  })();
  return (
    <CaseNumberBox
      id="case-number"
      label="Case number"
      placeholder="For example, 26-CR-00418"
      value={corrected ?? value}
      readOnly={!editable}
      hint={hint}
      error={error}
      missing={missing}
      onChange={onChange}
      onSave={save}
      onFocus={onFocus}
      county={county}
    >
      {chosenCase ? (
        <strong>Filed under the case you chose above.</strong>
      ) : own ? (
        <>
          <strong>Your invoice is filed under your name, not under a case.</strong>
          <p>
            Type the case number from your court papers. The billing office uses it to find the case in its own system.
            This tool does not check it against a list of cases.
          </p>
        </>
      ) : (
        <>
          {/* While editable, whom it is filed under is chosen just above (InvoiceDetailsFields). */}
          {!editable && <strong>This invoice is filed under {fromName}, not under a case.</strong>}
          <p>
            Reviewers use the case number to find the case in the {EXTERNAL_SYSTEM_NAME}. This tool does not check it
            against a list of cases.
          </p>
        </>
      )}
    </CaseNumberBox>
  );
}
