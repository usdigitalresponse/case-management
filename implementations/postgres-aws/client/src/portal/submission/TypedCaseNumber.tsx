import { useRef, useState, type ReactNode } from 'react';
import { apiErrorMessage, setDraftCaseNumber } from '../../api/client';
import { CaseNumberBox } from '../../components/CaseNumberBox';
import { EXTERNAL_SYSTEM_NAME } from '../../externalSystem';

// The case number on a staff draft, read from the file or typed, saved as it changes.
export function TypedCaseNumber({
  invoiceId,
  value,
  onChange,
  editable,
  fromName,
  hasFile,
  readFromFile,
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
  fromName: string;
  hasFile: boolean;
  readFromFile: boolean;
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
  const hint = (() => {
    if (chosenCase) return `The number of its case, ${chosenCase}.`;
    if (corrected) return `Corrected by the billing office. The file said ${value || 'none'}.`;
    if (!editable) return 'As typed. It is not checked against a list of cases.';
    if (readFromFile) return 'Read from the file. Change it if it is wrong.';
    if (value.trim()) return 'Change it if it is wrong.';
    return hasFile ? 'None found in the file. Type it as it is written on the invoice.' : 'Type it as it is written on the invoice.';
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
      onChange={onChange}
      onSave={save}
      onFocus={onFocus}
      county={county}
    >
      {chosenCase ? (
        <strong>Filed under its case.</strong>
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
