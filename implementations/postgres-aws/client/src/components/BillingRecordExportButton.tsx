import { useState } from 'react';
import { billingRecordUrl } from '../api/client';
import { useAuth } from '../AuthContext';
import { useResource } from '../hooks/useResource';
import { counties as countiesResource } from '../resources';
import {
  BILLING_RECORD_FIELDS,
  loadBillingRecordChoices,
  saveBillingRecordChoices,
  type BillingRecordChoices,
  type BillingRecordFormat,
} from '../exportChoices';
import { Dialog } from './ui/Dialog';
import { Notice } from './ui/Notice';
import { PeriodFields } from './PeriodFields';
import { Button, buttonClass } from './ui/Button';

export function BillingRecordExportButton() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" kind="secondary" onClick={() => setOpen(true)}>
        Export billing record
      </Button>
      {open && <ExportDialog userAccountId={user?.userAccountId ?? ''} onClose={() => setOpen(false)} />}
    </>
  );
}

// Each person's last choices other than county and period are kept for their next export.
function ExportDialog({ userAccountId, onClose }: { userAccountId: string; onClose: () => void }) {
  const { data } = useResource(countiesResource);
  const counties = data ?? [];
  const [countyId, setCountyId] = useState('');
  const [period, setPeriod] = useState({ start: '', end: '' });
  const [choices, setChoices] = useState<BillingRecordChoices>(() => loadBillingRecordChoices(userAccountId));
  const backwards = Boolean(period.start && period.end && period.start > period.end);
  const omit = new Set(choices.omit);
  const leftOut = BILLING_RECORD_FIELDS.filter((name) => omit.has(name));
  const href = billingRecordUrl(choices.format, {
    countyId: countyId || undefined,
    from: period.start,
    to: period.end,
    signedOffOnly: choices.signedOffOnly,
    omit: leftOut,
  });

  function setLeftOut(name: string, left: boolean) {
    setChoices((current) => ({ ...current, omit: left ? [...current.omit, name] : current.omit.filter((other) => other !== name) }));
  }

  return (
    <Dialog title="Export billing record" className="dialog--wide" onClose={onClose}>
      <p className="dialog__small">
        One row per invoice. A billing period keeps invoices whose period overlaps it, leaving out invoices with none.
      </p>
      <div className="export-format">
        <label className="usa-label" htmlFor="billing-record-county">County</label>
        <select id="billing-record-county" className="usa-select" value={countyId} onChange={(event) => setCountyId(event.target.value)}>
          <option value="">All counties</option>
          {[false, true].map((isCounty) => (
            <optgroup key={String(isCounty)} label={isCounty ? 'Counties' : 'In place of a county'}>
              {counties
                .filter((option) => option.isCounty === isCounty)
                .map((option) => (
                  <option key={option.countyId} value={option.countyId}>
                    {option.displayName}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </div>
      <PeriodFields idPrefix="billing-record" start={period.start} end={period.end} onChange={setPeriod} />
      <div className="export-choice-pair">
        <div className="export-format">
          <label className="usa-label" htmlFor="billing-record-status">Invoices</label>
          <select
            id="billing-record-status"
            className="usa-select"
            value={choices.signedOffOnly ? 'signed-off' : 'all'}
            onChange={(event) => setChoices((current) => ({ ...current, signedOffOnly: event.target.value === 'signed-off' }))}
          >
            <option value="signed-off">Signed off only</option>
            <option value="all">Every sent invoice</option>
          </select>
        </div>
        <div className="export-format">
          <label className="usa-label" htmlFor="billing-record-format">Format</label>
          <select
            id="billing-record-format"
            className="usa-select"
            value={choices.format}
            onChange={(event) => setChoices((current) => ({ ...current, format: event.target.value as BillingRecordFormat }))}
          >
            <option value="xlsx">Spreadsheet</option>
            <option value="csv">CSV</option>
          </select>
        </div>
      </div>

      <details className="export-redact">
        <summary>Redact some columns</summary>
        <fieldset className="export-fields">
          <legend className="export-legend">
            Columns{' '}
            <span className="export-count">
              {BILLING_RECORD_FIELDS.length - leftOut.length} of {BILLING_RECORD_FIELDS.length}
            </span>
          </legend>
          <div className="export-fields__grid">
            {BILLING_RECORD_FIELDS.map((name) => (
              <label key={name} className="checkbox-row">
                <input type="checkbox" checked={!omit.has(name)} onChange={(event) => setLeftOut(name, !event.target.checked)} />
                {name}
              </label>
            ))}
          </div>
        </fieldset>
      </details>
      <p className="dialog__small">
        {leftOut.length === 0
          ? 'Nothing is redacted. The invoice number and amounts are always included.'
          : `Redacting ${leftOut.length} ${leftOut.length === 1 ? 'column' : 'columns'}; the invoice number and amounts stay, and the file is marked as a redacted copy.`}
      </p>

      {backwards && <Notice tone="warning">The end date is before the start date.</Notice>}
      <div className="dialog__actions">
        {!backwards && (
          <a
            className={buttonClass('primary')}
            href={href}
            download
            onClick={() => {
              saveBillingRecordChoices(userAccountId, choices);
              // After the browser has followed the link.
              setTimeout(onClose, 0);
            }}
          >
            Download {choices.format === 'csv' ? 'CSV' : 'spreadsheet'}
          </a>
        )}
        <button type="button" className="link-button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
