import { useEffect } from 'react';
import { listReceiptChannels, type InvoiceReceipt } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';

const today = () => new Date().toISOString().slice(0, 10);

// Staff entering an invoice received outside the system say how and when it
// came in; review waiting time counts from that date.
export function ReceivedFields({
  idPrefix,
  value,
  onChange,
  receivedViaDisplayName,
}: {
  idPrefix: string;
  value: InvoiceReceipt;
  onChange: (value: InvoiceReceipt) => void;
  // Already recorded on a draft, to start from.
  receivedViaDisplayName?: string | null;
}) {
  const { data } = useApiResource(() => listReceiptChannels().then((result) => result.channels), []);
  const recorded = data?.find((channel) => channel.displayName === receivedViaDisplayName)?.code;

  useEffect(() => {
    if (recorded && !value.receivedVia) {
      onChange({ ...value, receivedVia: recorded });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorded]);

  return (
    <fieldset className="received-fields">
      <legend>How this invoice reached you</legend>
      <div className="inline-fields received-fields__row">
        <div className="usa-form-group">
          <label className="usa-label" htmlFor={`${idPrefix}-received-via`}>Received by</label>
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

export function hasReceipt(value: InvoiceReceipt): boolean {
  return Boolean(value.receivedVia && value.receivedOn);
}
