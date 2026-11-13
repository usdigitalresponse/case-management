// Parts for open cases that may be one case recorded twice (Settings › Merge
// duplicates, ./MergeDuplicates.tsx). Cases belong to the external case
// management system: a "merge" moves one case's invoices to the other and closes it.
import { useState } from 'react';
import { apiErrorMessage, reviewPossibleDuplicateCase, searchCases, type CaseListRecord } from '../api/client';
import { TypeAheadPicker } from './TypeAheadPicker';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Notice } from './ui/Notice';

export const caseLabel = (record: { caseNumber: string | null; clientDisplayName: string | null }) =>
  [record.caseNumber ?? 'No case number', record.clientDisplayName].filter(Boolean).join(', ');

// Open cases matching what was typed; only: those it may be paired with.
function CaseSearch({ id, label, only = () => true, onSelect }: { id: string; label: string; only?: (record: CaseListRecord) => boolean; onSelect: (record: CaseListRecord | undefined) => void }) {
  return (
    <div className="usa-form-group">
      <label className="usa-label" id={`${id}-label`} htmlFor={id}>
        {label}
      </label>
      <TypeAheadPicker
        id={id}
        placeholder="Search by case number or client"
        noResults="No open cases found."
        search={async (query) =>
          (await searchCases(query)).filter(only).map((record) => ({ value: record.caseId, label: caseLabel(record), item: record }))
        }
        onSelect={onSelect}
      />
    </div>
  );
}

export function FlagCasesDialog({ onClose, onFlagged }: { onClose: () => void; onFlagged: () => void }) {
  const [first, setFirst] = useState<CaseListRecord>();
  const [second, setSecond] = useState<CaseListRecord>();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ready = first && second && first.caseId !== second.caseId;
  // A case in another county is a different case.
  const sameCounty = (record: CaseListRecord) => !first?.countyId || !record.countyId || record.countyId === first.countyId;

  async function flag() {
    if (!first || !second) return;
    setSaving(true);
    setError(null);
    try {
      await reviewPossibleDuplicateCase({ caseIds: [first.caseId, second.caseId], outcome: 'possible_duplicate', note });
      onFlagged();
    } catch (err) {
      setError(apiErrorMessage(err, 'They could not be flagged.'));
      setSaving(false);
    }
  }

  return (
    <Dialog title="Flag two cases as possibly the same" onClose={onClose} className="dialog--wide">
      <p>Open cases in the same county only. They are listed in Settings, under Merge duplicates, until one is closed or someone marks them as different cases.</p>
      <CaseSearch id="flag-first-case" label="One case" onSelect={setFirst} />
      <CaseSearch id="flag-second-case" label="The other" only={sameCounty} onSelect={setSecond} />
      {first && second && first.caseId === second.caseId && <p className="field-error">Choose two different cases.</p>}
      <label className="usa-label" htmlFor="flag-case-note">
        Why they may be the same (optional)
      </label>
      <textarea id="flag-case-note" className="usa-textarea" maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="dialog__actions">
        <Button kind="primary" disabled={!ready || saving} onClick={() => void flag()}>
          {saving ? 'Flagging…' : 'Flag them'}
        </Button>
        <button type="button" className="link-button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
