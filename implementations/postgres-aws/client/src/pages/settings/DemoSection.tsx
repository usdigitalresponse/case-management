import { useState } from 'react';
import { FormGroup, Label, Select } from '@trussworks/react-uswds';
import { apiErrorMessage, resetDemoData, setOwnDemoRole } from '../../api/client';
import { useResource } from '../../hooks/useResource';
import { ownDemoRole } from '../../resources';
import { useAuth } from '../../AuthContext';
import { Notice, type SaveMessage } from '../../components/ui/Notice';
import { Button } from '../../components/ui/Button';

// Only on servers with the staff demo sign-in.
export function DemoSettings({ isAdmin }: { isAdmin: boolean }) {
  return (
    <section className="settings-section" id="settings-demo">
      <h2>Demo</h2>
      <OwnRoleCard />
      {isAdmin && <DemoDataReset />}
    </section>
  );
}

// Anyone switches their own role to try each view; it applies at once.
function OwnRoleCard() {
  const { refreshUser } = useAuth();
  const [version, setVersion] = useState(0);
  const { data, error: loadError } = useResource(ownDemoRole, { resetKey: version });
  const [message, setMessage] = useState<SaveMessage | null>(null);
  const [saving, setSaving] = useState(false);

  async function change(roleId: string) {
    setSaving(true);
    setMessage(null);
    try {
      await setOwnDemoRole(roleId);
      await refreshUser();
      setVersion((v) => v + 1);
      setMessage({ tone: 'success', text: 'Your role is changed.' });
    } catch (err) {
      setMessage({ tone: 'danger', text: apiErrorMessage(err, 'Your role could not be changed.') });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card compact-card">
      <h3>Your role</h3>
      <p className="compact-hint">
        Switch roles to try each view. Staff review and sign off; administrators also change settings.
      </p>
      {Boolean(loadError) && <Notice tone="danger">Failed to load your role.</Notice>}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {data && (
        <FormGroup>
          <Label htmlFor="own-demo-role">Role</Label>
          <Select id="own-demo-role" name="roleId" disabled={saving} value={data.roleId} onChange={(event) => void change(event.target.value)}>
            {data.roles.map((role) => (
              <option key={role.roleId} value={role.roleId}>
                {role.displayName}
              </option>
            ))}
          </Select>
        </FormGroup>
      )}
    </section>
  );
}

// Accounts are recreated, so it signs out afterwards.
function DemoDataReset() {
  const { logout } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reset() {
    setResetting(true);
    setError(null);
    try {
      await resetDemoData();
      await logout();
    } catch (err) {
      setError(apiErrorMessage(err, 'The demo data could not be reset.'));
      setResetting(false);
    }
  }

  return (
    <section className="card compact-card">
      <h3>Reset demo data</h3>
      <p className="compact-hint">
        Deletes every case, invoice, account and setting, including anything entered here, and recreates the
        synthetic demo data. Everyone is signed out.
      </p>
      {error && <Notice tone="danger">{error}</Notice>}
      {confirming ? (
        <>
          <Notice tone="warning">This can't be undone. Reset all data to the demo data?</Notice>
          <div className="close-case-buttons">
            <Button type="button" kind="danger" disabled={resetting} onClick={() => void reset()}>
              {resetting ? 'Resetting…' : 'Yes, reset all data'}
            </Button>
            <Button type="button" kind="secondary" disabled={resetting} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <Button type="button" kind="danger" onClick={() => setConfirming(true)}>
          Reset demo data
        </Button>
      )}
    </section>
  );
}
