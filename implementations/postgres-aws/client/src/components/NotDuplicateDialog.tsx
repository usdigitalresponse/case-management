import { useState } from 'react';
import { apiErrorMessage } from '../api/client';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { Notice } from './ui/Notice';

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

// Records that two people, or two cases, listed as possible duplicates are different.
export function NotDuplicateDialog({
  what,
  names,
  save,
  onClose,
  onDone,
}: {
  what: 'person' | 'case';
  names: [string, string];
  save: (note: string) => Promise<unknown>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const kinds = what === 'person' ? 'people' : 'cases';

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await save(note);
      onDone(`${names[0]} and ${names[1]} are recorded as different ${kinds}.`);
    } catch (err) {
      setError(apiErrorMessage(err, 'This could not be saved.'));
      setSaving(false);
    }
  }

  return (
    <Dialog title={`Not the same ${what}?`} onClose={onClose}>
      <p>
        {names[0]} and {names[1]} will no longer be listed as possible duplicates of each other. Anyone can flag them again later.
      </p>
      <label className="usa-label" htmlFor="not-duplicate-note">
        How you know (optional)
      </label>
      <textarea id="not-duplicate-note" className="usa-textarea" maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="dialog__actions">
        <Button kind="primary" disabled={saving} onClick={() => void submit()}>
          {saving ? 'Saving…' : `They are different ${kinds}`}
        </Button>
        <button type="button" className="link-button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
