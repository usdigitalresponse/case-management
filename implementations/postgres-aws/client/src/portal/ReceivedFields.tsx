import { useEffect, useState } from 'react';
import { listReceiptChannels, type InvoiceReceipt } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { useShell } from './useShell';

const today = () => new Date().toISOString().slice(0, 10);

// Staff entering an invoice received outside the system say how and when it
// came in; review waiting time counts from that date.
export function ReceivedFields({
  idPrefix,
  value,
  onChange,
  receivedViaDisplayName,
  plain = false,
  errors = {},
}: {
  // Shown under each plain field.
  errors?: { receivedVia?: string; receivedOn?: string };
  idPrefix: string;
  value: InvoiceReceipt;
  onChange: (value: InvoiceReceipt) => void;
  // Already recorded on a draft, to start from.
  receivedViaDisplayName?: string | null;
  // Two fields with hints, for a grid of fields (.upload-details), not a box of their own.
  plain?: boolean;
}) {
  const { data } = useApiResource(() => listReceiptChannels().then((result) => result.channels), []);
  const recorded = data?.find((channel) => channel.displayName === receivedViaDisplayName)?.code;

  useEffect(() => {
    if (recorded && !value.receivedVia) {
      onChange({ ...value, receivedVia: recorded });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorded]);

  if (plain) {
    return (
      <>
        <div className="upload-details__field">
          <label className="usa-label" htmlFor={`${idPrefix}-received-via`}>How it arrived</label>
          <select
            id={`${idPrefix}-received-via`}
            className="usa-select"
            value={value.receivedVia ?? ''}
            aria-invalid={Boolean(errors.receivedVia) || undefined}
            onChange={(event) => onChange({ ...value, receivedVia: event.target.value || undefined })}
          >
            <option value="">Choose how it arrived</option>
            {data?.map((channel) => (
              <option key={channel.code} value={channel.code}>{channel.displayName}</option>
            ))}
          </select>
          {errors.receivedVia && <p className="field-error">{errors.receivedVia}</p>}
        </div>
        <div className="upload-details__field">
          <label className="usa-label" htmlFor={`${idPrefix}-received-on`}>Date received</label>
          <input
            id={`${idPrefix}-received-on`}
            className="usa-input"
            type="date"
            max={today()}
            value={value.receivedOn ?? ''}
            aria-describedby={`${idPrefix}-received-on-hint`}
            aria-invalid={Boolean(errors.receivedOn) || undefined}
            onChange={(event) => onChange({ ...value, receivedOn: event.target.value || undefined })}
          />
          {errors.receivedOn && <p className="field-error">{errors.receivedOn}</p>}
          <p id={`${idPrefix}-received-on-hint`} className="field-hint">Review waiting time counts from this date.</p>
        </div>
      </>
    );
  }
  return (
    <fieldset className="received-fields">
      <legend>How this invoice reached you</legend>
      <div className="inline-fields received-fields__row">
        <div className="usa-form-group">
          <label className="usa-label" htmlFor={`${idPrefix}-received-via`}>How it arrived</label>
          <select
            id={`${idPrefix}-received-via`}
            className="usa-select"
            value={value.receivedVia ?? ''}
            onChange={(event) => onChange({ ...value, receivedVia: event.target.value || undefined })}
          >
            <option value="">Choose…</option>
            {data?.map((channel) => (
              <option key={channel.code} value={channel.code}>{channel.displayName}</option>
            ))}
          </select>
        </div>
        <div className="usa-form-group">
          <label className="usa-label" htmlFor={`${idPrefix}-received-on`}>Date received</label>
          <input
            id={`${idPrefix}-received-on`}
            className="usa-input"
            type="date"
            max={today()}
            value={value.receivedOn ?? ''}
            onChange={(event) => onChange({ ...value, receivedOn: event.target.value || undefined })}
          />
        </div>
      </div>
    </fieldset>
  );
}

function hasReceipt(value: InvoiceReceipt): boolean {
  return Boolean(value.receivedVia && value.receivedOn);
}

// How and when an invoice reached staff, asked only of staff: the fields to
// render, whether submitting must wait for them, and what to send.
export function useReceipt(idPrefix: string, recorded?: { receivedOn?: string | null; receivedViaDisplayName?: string | null }) {
  const { staff } = useShell();
  const [receipt, setReceipt] = useState<InvoiceReceipt>({ receivedOn: recorded?.receivedOn ?? undefined });
  return {
    fields: staff ? (
      <ReceivedFields idPrefix={idPrefix} value={receipt} onChange={setReceipt} receivedViaDisplayName={recorded?.receivedViaDisplayName} />
    ) : null,
    missing: staff && !hasReceipt(receipt),
    payload: staff ? receipt : undefined,
    reset: () => setReceipt({}),
  };
}
