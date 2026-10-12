import { Checkbox } from '@trussworks/react-uswds';
import type { BillableProfessional, TimeEntryRecord } from '../api/client';
import { formatDate } from '../formatDateTime';
import { formatMoney } from '../formatMoney';
import { emptyLine, professionalLabel, timeItemPreview, type LineDraft } from './InvoiceLinesEditor';

export function lineFromTimeEntry(entry: TimeEntryRecord): LineDraft {
  return {
    ...emptyLine,
    lineType: 'time',
    serviceDate: entry.activityOn,
    description: entry.description,
    quantity: String(Number(entry.durationHours)),
    timekeeperProfessionalId: entry.professionalId,
    sourceTimeEntryId: entry.timeEntryId,
  };
}

function isUntouched(line: LineDraft): boolean {
  return !line.sourceTimeEntryId && !line.serviceDate && !line.description && !line.quantity && !line.amount;
}

// Recorded time not on any invoice, ticked to bill it. Ticking adds a linked
// time item to `lines`; unticking removes it (model/rules.yaml
// validate_payment_request).
export function UnbilledTimePicker({
  idPrefix,
  entries,
  lines,
  onChange,
  timekeepers,
}: {
  idPrefix: string;
  // Unbilled entries, plus any already on these lines.
  entries: TimeEntryRecord[];
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  timekeepers: BillableProfessional[];
}) {
  if (entries.length === 0) {
    return null;
  }
  const byId = new Map(timekeepers.map((professional) => [professional.professionalId, professional]));

  function toggle(entry: TimeEntryRecord, checked: boolean) {
    if (!checked) {
      const rest = lines.filter((line) => line.sourceTimeEntryId !== entry.timeEntryId);
      onChange(rest.length > 0 ? rest : [emptyLine]);
      return;
    }
    const linked = lines.filter((line) => line.sourceTimeEntryId);
    const others = lines.filter((line) => !line.sourceTimeEntryId && !isUntouched(line));
    onChange([...linked, lineFromTimeEntry(entry), ...others]);
  }

  return (
    <fieldset className="usa-fieldset unbilled-time">
      <legend className="usa-legend">Unbilled time on this case</legend>
      {entries.map((entry) => {
        const professional = byId.get(entry.professionalId);
        const preview = timeItemPreview(lineFromTimeEntry(entry), timekeepers, undefined);
        const who = professional ? professionalLabel(professional) : 'Someone else';
        return (
          <Checkbox
            key={entry.timeEntryId}
            id={`${idPrefix}-time-${entry.timeEntryId}`}
            name={`${idPrefix}-time-${entry.timeEntryId}`}
            checked={lines.some((line) => line.sourceTimeEntryId === entry.timeEntryId)}
            onChange={(event) => toggle(entry, event.target.checked)}
            label={
              <span className="unbilled-time-row">
                <span>{formatDate(entry.activityOn)}</span>
                {timekeepers.length > 1 && <span>{who}</span>}
                <span>{Number(entry.durationHours)} h</span>
                <span className="unbilled-time-description">{entry.description}</span>
                {'amount' in preview ? (
                  <span className="amount">{formatMoney(preview.amount)}</span>
                ) : (
                  <span className="line-amount-missing">{preview.missing}</span>
                )}
              </span>
            }
          />
        );
      })}
    </fieldset>
  );
}
