import { ATTESTATION_STATEMENT } from '../api/client';

// The true-and-correct tick a submitter gives when sending their own
// invoice; staff entering one received elsewhere don't attest for its payee.
export function AttestationCheckbox({ id, checked, onChange }: { id: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="attest" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{ATTESTATION_STATEMENT}</span>
    </label>
  );
}
