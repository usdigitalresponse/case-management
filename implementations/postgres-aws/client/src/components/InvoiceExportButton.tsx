import { useState } from 'react';
import { invoiceExportUrl, type InvoiceExportFormat } from '../api/client';
import { useAuth } from '../AuthContext';
import {
  EXPORT_FIELDS,
  exportFieldKey,
  loadExportChoices,
  saveExportChoices,
  type ExportChoices,
  type ExportFieldGroup,
} from '../exportChoices';
import { Dialog } from './ui/Dialog';
import { buttonClass } from './ui/Button';

// Opens a choice of format and of details to redact before the file is
// sent on; each person's last choice is kept for their next export.
export function InvoiceExportButton({
  scope,
  invoiceId,
  hasTrips,
  compact,
}: {
  scope: 'staff' | 'portal';
  invoiceId: string;
  // Unknown where the invoice's lines aren't loaded; its travel log is offered.
  hasTrips?: boolean;
  // Link-style, for table rows.
  compact?: boolean;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={compact ? 'link-button' : buttonClass('secondary')} onClick={() => setOpen(true)}>
        Export Invoice
      </button>
      {open && (
        <ExportDialog
          scope={scope}
          invoiceId={invoiceId}
          hasTrips={hasTrips}
          userAccountId={user?.userAccountId ?? ''}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ExportDialog({
  scope,
  invoiceId,
  hasTrips,
  userAccountId,
  onClose,
}: {
  scope: 'staff' | 'portal';
  invoiceId: string;
  hasTrips: boolean | undefined;
  userAccountId: string;
  onClose: () => void;
}) {
  const [choices, setChoices] = useState<ExportChoices>(() => loadExportChoices(userAccountId));
  const groups: Array<{ group: ExportFieldGroup; legend: string; hint?: string; names: readonly string[] }> = [
    { group: 'summary', legend: 'Invoice details', names: EXPORT_FIELDS.summary },
    {
      group: 'lines',
      legend: 'Line items',
      // Reviewer names are only ever exported to staff.
      names: scope === 'staff' ? EXPORT_FIELDS.lines : EXPORT_FIELDS.lines.filter((name) => name !== 'Reviewed by'),
    },
    ...(hasTrips === false
      ? []
      : [{ group: 'travel' as const, legend: 'Travel log', hint: hasTrips ? undefined : 'Only on invoices with trips.', names: EXPORT_FIELDS.travel }]),
  ];
  const omit = new Set(choices.omit);
  const offered = groups.flatMap(({ group, names }) => names.map((name) => exportFieldKey(group, name)));
  const leftOut = offered.filter((key) => omit.has(key));

  function setLeftOut(key: string, left: boolean) {
    setChoices((current) => ({ ...current, omit: left ? [...current.omit, key] : current.omit.filter((other) => other !== key) }));
  }

  return (
    <Dialog title="Export invoice" className="dialog--wide" onClose={onClose}>
      <div className="export-format">
        <label className="usa-label" htmlFor="export-format">Format</label>
        <select
          id="export-format"
          className="usa-select"
          value={choices.format}
          onChange={(event) => setChoices((current) => ({ ...current, format: event.target.value as InvoiceExportFormat }))}
        >
          <option value="pdf">PDF</option>
          <option value="xlsx">Spreadsheet</option>
        </select>
      </div>

      <details className="export-redact">
        <summary>Redact some invoice details</summary>
        {groups.map(({ group, legend, hint, names }) => {
          const keys = names.map((name) => exportFieldKey(group, name));
          const included = keys.filter((key) => !omit.has(key)).length;
          return (
            <fieldset key={group} className="export-fields">
              <legend className="export-legend">
                {legend} <span className="export-count">{included} of {keys.length}</span>
              </legend>
              {hint && <p className="dialog__small">{hint}</p>}
              <div className="export-fields__grid">
                {names.map((name, index) => (
                  <label key={name} className="checkbox-row">
                    <input type="checkbox" checked={!omit.has(keys[index]!)} onChange={(event) => setLeftOut(keys[index]!, !event.target.checked)} />
                    {name}
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
      </details>

      <p className="dialog__small">
        {leftOut.length === 0
          ? 'Nothing is redacted. Totals are always included.'
          : `Redacting ${leftOut.length} ${leftOut.length === 1 ? 'detail' : 'details'}; totals stay, and the file is marked as a redacted copy.`}
      </p>
      <div className="dialog__actions">
        <a
          className={buttonClass('primary')}
          href={invoiceExportUrl(scope, invoiceId, choices.format, leftOut)}
          download
          onClick={() => {
            saveExportChoices(userAccountId, choices);
            // After the browser has followed the link.
            setTimeout(onClose, 0);
          }}
        >
          Download {choices.format === 'pdf' ? 'PDF' : 'spreadsheet'}
        </a>
        <button type="button" className="link-button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
