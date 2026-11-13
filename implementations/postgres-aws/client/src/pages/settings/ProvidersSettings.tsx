// Settings › Providers (design K51): where a provider's kind and details are
// changed and new ones added (K31), and whether each may sign in.
import { useState } from 'react';
import { Select } from '@trussworks/react-uswds';
import { apiErrorMessage, rateOn, removeProfessional, setExternalSignIn, setProfessionalKind, type ProfessionalKind, type VendorRecord } from '../../api/client';
import { ConfirmButton } from '../../components/ConfirmButton';
import { useBatchedResource } from '../../hooks/useBatchedResource';
import { useResource } from '../../hooks/useResource';
import { useSearchParamText } from '../../hooks/useSearchParamState';
import { person as personResource, professionalKinds, providerList } from '../../resources';
import { MoreOnScroll } from '../../components/MoreOnScroll';
import { RecordTable } from '../../components/RecordTable';
import { LoadState } from '../../components/LoadState';
import { PersonDialog } from '../../components/PersonDialog';
import { Notice, type SaveMessage } from '../../components/ui/Notice';
import { Button } from '../../components/ui/Button';
import { formatMoney } from '../../formatMoney';

function rateText(rates: ProfessionalKind['rates']): string {
  const rate = rateOn(rates, new Date().toISOString().slice(0, 10));
  return rate ? `${formatMoney(rate)}/h` : 'No rate set';
}

// Who can send their invoices: themselves once they can sign in, and their office's billing delegates.
function sentBy(vendor: VendorRecord): string {
  const own = vendor.externalSignInEnabled ? ['Themselves'] : [];
  const names = [...own, ...vendor.sentByDisplayNames];
  const who = names.length === 0 ? 'Staff, for them' : names.join(' or ');
  return vendor.sendsForCount > 0 ? `${who}. Also sends for ${vendor.sendsForCount} ${vendor.sendsForCount === 1 ? 'other' : 'others'}.` : who;
}

// The kind whose rates price this provider's time.
function Kind({ vendor, kinds, editable, onChanged }: { vendor: VendorRecord; kinds: ProfessionalKind[] | null; editable: boolean; onChanged: (rates: ProfessionalKind['rates']) => void }) {
  const [kindId, setKindId] = useState(vendor.professionalKindId ?? '');
  const [error, setError] = useState<string | null>(null);

  async function change(next: string) {
    const previous = kindId;
    setKindId(next);
    setError(null);
    try {
      await setProfessionalKind(vendor.professionalId, next || null);
      onChanged(kinds?.find((candidate) => candidate.professionalKindId === next)?.rates ?? []);
    } catch (err) {
      setKindId(previous);
      setError(apiErrorMessage(err, 'The kind could not be changed.'));
    }
  }

  if (!editable || !kinds) {
    return <span>{vendor.professionalKindDisplayName ?? 'No kind'}</span>;
  }
  return (
    <span className="kind-cell">
      <Select
        id={`kind-${vendor.professionalId}`}
        name={`kind-${vendor.professionalId}`}
        aria-label={`Kind of provider for ${vendor.displayName ?? 'this provider'}`}
        value={kindId}
        onChange={(event) => void change(event.target.value)}
      >
        <option value="">No kind</option>
        {kinds.map((candidate) => (
          <option key={candidate.professionalKindId} value={candidate.professionalKindId}>
            {candidate.displayName}
          </option>
        ))}
      </Select>
      {error && <span className="line-row-error">{error}</span>}
    </span>
  );
}

// The same form as adding one, with their details loaded; someone added by mistake can be removed here.
function EditProvider({ professionalId, onSaved, onClose }: { professionalId: string; onSaved: (message: string) => void; onClose: () => void }) {
  const { data, error } = useResource(personResource(professionalId));
  const [removeError, setRemoveError] = useState<string | null>(null);
  if (error) return <Notice tone="danger">Their details could not be loaded.</Notice>;
  if (!data) return null;
  const name = data.displayName ?? 'them';
  return (
    <PersonDialog
      person={data}
      onClose={onClose}
      onSaved={(saved) => onSaved(`Saved ${saved.displayName}.`)}
      extraAction={
        <>
          <ConfirmButton
            label="Remove"
            prompt={`Remove ${name}? Only someone added by mistake can be removed. Unsent invoices from them will have no one chosen.`}
            confirmLabel="Yes, remove"
            onConfirm={() =>
              void removeProfessional(professionalId).then(
                () => onSaved(`Removed ${name}.`),
                (err: unknown) => setRemoveError(apiErrorMessage(err, 'They could not be removed.')),
              )
            }
          />
          {removeError && <p className="field-error" role="alert">{removeError}</p>}
        </>
      }
    />
  );
}

export function ProvidersSettings({ isAdmin }: { isAdmin: boolean }) {
  const [query, setQuery] = useSearchParamText('providerQ');
  const [version, setVersion] = useState(0);
  const list = useBatchedResource(providerList(query.trim()), { resetKey: version });
  const { data: kinds } = useResource(isAdmin ? professionalKinds : null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState<SaveMessage | null>(null);
  // A kind just changed here prices their time at its rates.
  const [changedRates, setChangedRates] = useState<Record<string, ProfessionalKind['rates']>>({});
  const saved = (text: string) => {
    setAdding(false);
    setEditing(null);
    setMessage({ tone: 'success', text });
    setVersion((v) => v + 1);
  };

  async function toggleSignIn(vendor: VendorRecord) {
    setMessage(null);
    const name = vendor.displayName ?? 'They';
    try {
      await setExternalSignIn(vendor.personId, !vendor.externalSignInEnabled);
      saved(
        vendor.externalSignInEnabled
          ? `${name} can no longer sign in, and is signed out.`
          : `${name} can now sign in with ${vendor.email ?? 'their email'}. The tool doesn't email them, so let them know.`,
      );
    } catch (err) {
      setMessage({ tone: 'danger', text: apiErrorMessage(err, 'Their sign-in could not be changed.') });
    }
  }

  return (
    <>
      <div className="section-title-row">
        <p className="compact-hint">
          Attorneys, experts and investigators who bill for their work. Each one&apos;s kind sets the hourly rate their time is billed at. What you
          change here shows on the provider&apos;s page.
        </p>
        {isAdmin && (
          <Button kind="primary" onClick={() => setAdding(true)}>
            Add provider
          </Button>
        )}
      </div>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <label className="list-controls__search">
        <span className="usa-sr-only">Search providers</span>
        <input className="usa-input" type="search" placeholder="Search by name or email" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      {list.error || !list.items ? (
        <LoadState error={list.error} what="providers" />
      ) : (
        <>
          <RecordTable<VendorRecord>
            label="Providers"
            rows={list.items}
            rowKey={(vendor) => vendor.professionalId}
            emptyMessage={query.trim() ? 'No one matches.' : 'No providers yet.'}
            columns={[
              {
                header: 'Name',
                rowHeader: true,
                render: (vendor) => (
                  <>
                    <strong>{vendor.displayName ?? 'Unknown'}</strong>
                    <span className="cell-note">{vendor.email ?? 'No email yet'}</span>
                  </>
                ),
              },
              {
                header: 'Kind',
                render: (vendor) => (
                  <Kind
                    vendor={vendor}
                    kinds={kinds}
                    editable={isAdmin}
                    onChanged={(rates) => setChangedRates((current) => ({ ...current, [vendor.professionalId]: rates }))}
                  />
                ),
              },
              { header: 'Rate today', render: (vendor) => rateText(changedRates[vendor.professionalId] ?? vendor.rates) },
              { header: 'Office', render: (vendor) => vendor.officeDisplayName ?? <span className="muted">None</span> },
              { header: 'Who can send their invoices', render: (vendor) => sentBy(vendor) },
              {
                header: 'Active',
                render: (vendor) => (
                  <span className="row-actions">
                    {vendor.externalSignInEnabled ? 'Yes' : 'No'}
                    {isAdmin && (
                      <button type="button" className="link-button" onClick={() => void toggleSignIn(vendor)}>
                        {vendor.externalSignInEnabled ? 'Turn off' : 'Turn on'}{' '}
                        <span className="usa-sr-only">sign-in for {vendor.displayName}</span>
                      </button>
                    )}
                  </span>
                ),
              },
              ...(isAdmin
                ? [
                    {
                      header: 'Edit',
                      hiddenHeader: true,
                      render: (vendor: VendorRecord) => (
                        <button type="button" className="link-button" onClick={() => setEditing(vendor.professionalId)}>
                          Edit <span className="usa-sr-only">{vendor.displayName}</span>
                        </button>
                      ),
                    },
                  ]
                : []),
            ]}
          />
          <MoreOnScroll list={list} what="providers" />
        </>
      )}
      <Notice tone="info">Each kind has its own rate. A provider&apos;s own approved rate can differ from it.</Notice>
      {adding && <PersonDialog onClose={() => setAdding(false)} onSaved={(added) => saved(`Added ${added.displayName}.`)} />}
      {editing && <EditProvider professionalId={editing} onClose={() => setEditing(null)} onSaved={saved} />}
    </>
  );
}
