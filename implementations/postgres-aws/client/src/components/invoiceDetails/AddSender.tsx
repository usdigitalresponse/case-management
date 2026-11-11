import { useRef, useState } from 'react';
import { addProfessional, apiErrorMessage, correctProfessional } from '../../api/client';
import { useResource } from '../../hooks/useResource';
import { professionalKinds } from '../../resources';
import { Added } from './SenderPicker';

export interface PersonDraft {
  givenName: string;
  familyName: string;
  displayName: string;
  email?: string;
  professionalKindId: string;
}

// First and last name, joined into the whole name; null until both are given.
function joinName(givenName: string, familyName: string) {
  const given = givenName.trim();
  const family = familyName.trim();
  return given && family ? { givenName: given, familyName: family, displayName: `${given} ${family}` } : null;
}

export function useActiveKinds() {
  return useResource(professionalKinds).data?.filter((kind) => kind.active) ?? null;
}

// Someone new described on one line, to be added when the page goes on.
export function NewSenderFields({ id, onChange }: { id: string; onChange: (draft: PersonDraft | null) => void }) {
  const kinds = useActiveKinds();
  const [draft, setDraft] = useState({ givenName: '', familyName: '', email: '', professionalKindId: '' });
  function set(patch: Partial<typeof draft>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    const name = joinName(next.givenName, next.familyName);
    onChange(name && next.professionalKindId ? { ...name, email: next.email.trim() || undefined, professionalKindId: next.professionalKindId } : null);
  }
  return (
    <div className="add-sender">
      <input
        id={`${id}-given`}
        className="usa-input"
        aria-label="First name"
        placeholder="First name"
        value={draft.givenName}
        onChange={(event) => set({ givenName: event.target.value })}
      />
      <input
        id={`${id}-family`}
        className="usa-input"
        aria-label="Last name"
        placeholder="Last name"
        value={draft.familyName}
        onChange={(event) => set({ familyName: event.target.value })}
      />
      <input
        id={`${id}-email`}
        className="usa-input"
        type="email"
        aria-label="Their email (optional)"
        placeholder="Email (optional)"
        value={draft.email}
        onChange={(event) => set({ email: event.target.value })}
      />
      <select
        id={`${id}-role`}
        className="usa-select"
        aria-label="Their role"
        value={draft.professionalKindId}
        onChange={(event) => set({ professionalKindId: event.target.value })}
      >
        <option value="">Role</option>
        {kinds?.map((kind) => (
          <option key={kind.professionalKindId} value={kind.professionalKindId}>{kind.displayName}</option>
        ))}
      </select>
    </div>
  );
}

// Adds them once a name and role are given, then corrects that same person.
export function AddSender({
  id,
  existing,
  onAdded,
  onRenamed,
  onRoleChanged,
}: {
  id: string;
  // Added from this row.
  existing: Added | null;
  onAdded: (added: Added) => void;
  onRenamed: (professionalId: string, displayName: string) => void;
  onRoleChanged: (professionalId: string, kindDisplayName: string | undefined) => void;
}) {
  const kinds = useActiveKinds();
  const [givenName, setGivenName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [email, setEmail] = useState('');
  const [professionalKindId, setKindId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Set at once, so a blur and a role change together add them once.
  const adding = useRef(false);
  // The email as added or last corrected.
  const savedEmail = useRef('');
  async function run(action: () => Promise<void>, failure: string) {
    setError(null);
    setSaving(true);
    try {
      await action();
    } catch (err) {
      setError(apiErrorMessage(err, failure));
    } finally {
      setSaving(false);
    }
  }
  function add(kindId: string) {
    const name = joinName(givenName, familyName);
    if (adding.current || !name || !kindId) return;
    adding.current = true;
    const mail = email.trim();
    void run(async () => {
      try {
        const provider = await addProfessional({ ...name, email: mail || undefined, professionalKindId: kindId });
        onAdded({ ...provider, kindDisplayName: kinds?.find((kind) => kind.professionalKindId === kindId)?.displayName });
        savedEmail.current = mail;
      } catch (err) {
        adding.current = false;
        throw err;
      }
    }, 'They could not be added.');
  }
  function save() {
    const name = joinName(givenName, familyName);
    const mail = email.trim();
    if (!existing) {
      add(professionalKindId);
    } else if (name && (name.displayName !== existing.displayName || mail !== savedEmail.current)) {
      void run(async () => {
        await correctProfessional(existing.professionalId, { ...name, email: mail || undefined });
        savedEmail.current = mail;
        if (name.displayName !== existing.displayName) onRenamed(existing.professionalId, name.displayName);
      }, 'Their details could not be saved. Try again.');
    }
  }
  const saveOnEnter = (event: { key: string }) => {
    if (event.key === 'Enter') save();
  };
  return (
    <div className="add-sender">
      <input
        id={`${id}-given`}
        className="usa-input"
        aria-label="First name"
        placeholder="First name"
        value={givenName}
        onChange={(event) => setGivenName(event.target.value)}
        onBlur={save}
        onKeyDown={saveOnEnter}
      />
      <input
        id={`${id}-family`}
        className="usa-input"
        aria-label="Last name"
        placeholder="Last name"
        value={familyName}
        onChange={(event) => setFamilyName(event.target.value)}
        onBlur={save}
        onKeyDown={saveOnEnter}
      />
      <input
        id={`${id}-email`}
        className="usa-input"
        type="email"
        aria-label="Their email (optional)"
        placeholder="Email (optional)"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        onBlur={save}
        onKeyDown={saveOnEnter}
      />
      <select
        id={`${id}-role`}
        className="usa-select"
        aria-label="Their role"
        value={professionalKindId}
        disabled={saving}
        onChange={(event) => {
          const kindId = event.target.value;
          setKindId(kindId);
          const name = joinName(givenName, familyName);
          if (!existing) {
            add(kindId);
          } else if (kindId && name) {
            const kindDisplayName = kinds?.find((kind) => kind.professionalKindId === kindId)?.displayName;
            void run(async () => {
              await correctProfessional(existing.professionalId, { ...name, email: email.trim() || undefined, professionalKindId: kindId });
              savedEmail.current = email.trim();
              onRoleChanged(existing.professionalId, kindDisplayName);
            }, 'Their role could not be saved. Try again.');
          }
        }}
      >
        <option value="">Role</option>
        {kinds?.map((kind) => (
          <option key={kind.professionalKindId} value={kind.professionalKindId}>{kind.displayName}</option>
        ))}
      </select>
      {saving ? (
        <span className="field-hint">Saving…</span>
      ) : (
        existing && <span className="field-hint">Added, and the invoice is billed by them.</span>
      )}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
