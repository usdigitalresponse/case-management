import { useState } from 'react';
import { Checkbox, Label, Select, TextInput } from '@trussworks/react-uswds';
import {
  mileageRateOn,
  type BillableProfessional,
  type MileageRate,
  type TimeEntryRecord,
  type TimeCategoryRate,
} from '../api/client';
import { AddProvider, type AddedProvider } from './AddProvider';
import { ProposedPersonFields } from './NewEntryFields';
import { formatDate } from '../formatDateTime';
import { ADD_NEW, PickOrAdd } from './PickOrAdd';
import { TripFields } from './TripFields';
import { formatMoney, formatRate } from '../formatMoney';
import { type DraftKind, type LineDraft, addToTrip, categoryRateNote, dropsOnSwitch, emptyLine, hasInvoiceItems, invoiceTotalPreview, isItem, isTimeKind, professionalLabel, ratesInPlay, sameTimekeeperForAll, switchKind, timeKindPreview, travelItemPreview, tripToJoin } from '../invoiceLines';

// "page 2, …" shows where it was read in the original beside the review.
export function SourceLocation({ location, onShow }: { location: string; onShow: (location: string) => void }) {
  if (!/^page \d+/.test(location)) {
    return <>{location}</>;
  }
  return (
    <button type="button" className="link-button" onClick={() => onShow(location)}>
      {location}
    </button>
  );
}

export interface DuplicateTimeSuggestion {
  invoiceLineId: string;
  timeEntryId: string;
  activityOn: string;
  durationHours: string;
  description: string;
}

// One grid row per item. With several timekeepers, or on import review, "work
// done by" shows under the description; importReview adds notes and
// duplicate-time links.
export function InvoiceLinesEditor({
  idPrefix,
  lines,
  onChange,
  timekeepers = [],
  billedProfessionalId,
  recordedTime = [],
  billingCodes = [],
  mileageRates = [],
  timeCategoryRates = [],
  importReview,
  onProviderAdded,
}: {
  idPrefix: string;
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  timekeepers?: BillableProfessional[];
  // Whose work an item with no "work done by" is.
  billedProfessionalId?: string;
  // Unbilled recorded time, to spot typed items that repeat it.
  recordedTime?: TimeEntryRecord[];
  // The agency's task codes, when it uses them: adds a code column.
  billingCodes?: Array<{ code: string; displayName: string }>;
  // Price mileage, travel and waiting time in the preview.
  mileageRates?: MileageRate[];
  timeCategoryRates?: TimeCategoryRate[];
  importReview?: {
    duplicateTime: DuplicateTimeSuggestion[];
    sourceLocations?: string[];
    onShowSource: (location: string) => void;
    // A file designated to one professional: "work done by" is fixed.
    fixedTimekeeper?: boolean;
  };
  // Staff only: "add" creates the provider, and this readies them to be
  // billed (on a case, assigns them to it). Others name someone instead.
  // Expected to add them to `timekeepers` (useAddedProviders).
  onProviderAdded?: (provider: AddedProvider) => Promise<void>;
}) {
  // Added here, to offer using them for the other items.
  const [addedIds, setAddedIds] = useState<string[]>([]);
  // A switch away from a trip that would drop some of it, until confirmed.
  const [pendingSwitch, setPendingSwitch] = useState<{ index: number; kind: DraftKind; drops: string[] }>();
  const showTimekeeper = timekeepers.length > 1 || Boolean(importReview);
  // Staff review's columns, led by the kind of item, which decides hours or an amount; a trip's miles
  // and costs go below, and who did it and its code under the description (styles/line-editor.css).
  const columns = ['Kind', 'Date', 'What was done', 'Hours', 'Rate', 'Amount', ''];

  function update(index: number, changes: Partial<LineDraft>) {
    onChange(lines.map((line, i) => (i === index ? { ...line, ...changes } : line)));
  }

  function chooseKind(index: number, kind: DraftKind) {
    const drops = dropsOnSwitch(lines[index]!, kind);
    if (drops.length > 0) {
      setPendingSwitch({ index, kind, drops });
      return;
    }
    setPendingSwitch(undefined);
    onChange(lines.map((line, i) => (i === index ? switchKind(line, kind) : line)));
  }

  async function addProvider(index: number, provider: AddedProvider) {
    // If putting them on the case fails, saving says so.
    await onProviderAdded?.(provider).catch(() => undefined);
    setAddedIds((current) => [...current, provider.professionalId]);
    update(index, { timekeeperProfessionalId: provider.professionalId, proposedTimekeeperName: '', proposedTimekeeperEmail: '' });
  }

  const pricingFor = importReview ? undefined : billedProfessionalId;
  const inPlay = ratesInPlay(lines, timekeepers, pricingFor);
  const totals = invoiceTotalPreview(lines, timekeepers, pricingFor, mileageRates, timeCategoryRates);
  const mileageRateToday = mileageRateOn(mileageRates, new Date().toISOString().slice(0, 10));

  return (
    <>
      {inPlay.length > 0 && (
        <p className="rate-note">
          Time is billed at{' '}
          {inPlay
            .map(({ professional, rates }) => {
              const amounts =
                rates.length === 0
                  ? 'no rate set yet'
                  : rates
                      .map((rate) => `${formatMoney(rate.hourlyRate)}/h${rate.from ? ` from ${formatDate(rate.from)}` : ''}`)
                      .join(', then ');
              const kind = professional.kindDisplayName ? `, ${professional.kindDisplayName.toLowerCase()}` : '';
              return `${amounts} for ${professionalLabel(professional)}${kind}`;
            })
            .join('; ')}
          . Administrators set the rates.
        </p>
      )}
      {lines.some((line) => line.lineType === 'travel') && (
        <p className="rate-note">
          Travel time is billed at {categoryRateNote(timeCategoryRates, 'travel')}, and mileage at{' '}
          {mileageRateToday ? `${formatRate(mileageRateToday)} per mile` : 'a rate not set yet'}.
        </p>
      )}
      {lines.some((line) => line.lineType === 'waiting') && (
        <p className="rate-note">Waiting time is billed at {categoryRateNote(timeCategoryRates, 'waiting')}.</p>
      )}
    <div className="card line-editor">
      <div className="line-editor-head" aria-hidden="true">
        {columns.map((label, index) => (
          // Hours to Amount are right-aligned figures.
          <span key={index} className={index >= 3 && index <= 5 ? 'amount' : undefined}>
            {label}
          </span>
        ))}
      </div>
      {lines.map((line, index) => {
        const id = (field: string) => `${idPrefix}-${field}-${index}`;
        const item = `Item ${index + 1}`;
        const duplicate = importReview?.duplicateTime.find((candidate) => candidate.invoiceLineId === line.invoiceLineId);
        const unmatched = Boolean(importReview) && !line.timekeeperProfessionalId;
        const linked = Boolean(line.sourceTimeEntryId || line.travelTime?.sourceTimeEntryId);
        const travel = line.lineType === 'travel';
        const pricingProfessionalId = importReview ? undefined : billedProfessionalId;
        const travelPreview = travel ? travelItemPreview(line, timekeepers, pricingProfessionalId, mileageRates, timeCategoryRates) : undefined;
        // The hours column's: time worked or waiting, or a trip's travel time.
        const preview = isTimeKind(line.lineType)
          ? timeKindPreview(line, timekeepers, pricingProfessionalId, timeCategoryRates)
          : travelPreview?.time;
        const joinTrip = tripToJoin(lines, index);
        const mileagePreview = travelPreview?.mileage;
        const stated = line.carried.statedAmount;
        // The file's stated amount is on a time line or a trip's mileage.
        const priced = travel ? mileagePreview : preview;
        const missing = [preview, mileagePreview].flatMap((part) => (part && 'missing' in part ? [part.missing] : []));
        // A trip's task code is its travel time's.
        const taskCode = travel ? line.travelTime?.carried.taskCode : line.carried.taskCode;
        const setTaskCode = (code: string | undefined) =>
          travel
            ? update(index, {
                travelTime: { sourceTimeEntryId: '', ...line.travelTime, carried: { ...line.travelTime?.carried, taskCode: code } },
              })
            : update(index, { carried: { ...line.carried, taskCode: code } });
        const differsFromFile =
          stated !== undefined && priced && 'amount' in priced && Math.abs(Number(priced.amount) - stated) >= 0.005;
        // Typed time that looks like work already recorded: offered, never merged.
        const sameAsRecorded =
          line.lineType === 'time' && !linked
            ? recordedTime.find(
                (entry) =>
                  entry.professionalId === (line.timekeeperProfessionalId || billedProfessionalId) &&
                  entry.activityOn === line.serviceDate &&
                  Number(entry.durationHours) === Number(line.quantity) &&
                  !lines.some((other) => other.sourceTimeEntryId === entry.timeEntryId),
              )
            : undefined;
        return (
          // data-label: a short visible label when a narrow editor stacks its cells (styles/line-editor.css).
          <div key={index} className="line-row inline-fields" role="group" aria-label={item}>
            <div className="usa-form-group" data-label="Kind">
              <Label htmlFor={id('type')} className="line-label">{`${item} kind`}</Label>
              <Select
                id={id('type')}
                name={id('type')}
                value={line.lineType}
                disabled={linked}
                title="Time and waiting time are priced by the hour. A trip takes its travel time, miles and other costs together; each is billed as its own item. Enter an amount for an expense or other cost."
                onChange={(event) => chooseKind(index, event.target.value as DraftKind)}
              >
                <option value="time">Time worked</option>
                <option value="waiting">Waiting time</option>
                <option value="travel">Travel</option>
                <option value="expense">Expense</option>
                <option value="other">Other cost</option>
              </Select>
              {pendingSwitch?.index === index && (
                <p className="line-switch-confirm" role="alert">
                  This removes {pendingSwitch.drops.join(' and ')}.{' '}
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      setPendingSwitch(undefined);
                      onChange(lines.map((other, i) => (i === index ? switchKind(other, pendingSwitch.kind) : other)));
                    }}
                  >
                    Switch
                  </button>{' '}
                  <button type="button" className="link-button" onClick={() => setPendingSwitch(undefined)}>
                    Keep the trip
                  </button>
                </p>
              )}
            </div>
            <div className="usa-form-group" data-label="Date">
              <Label htmlFor={id('date')} className="line-label">{`${item} date`}</Label>
              <input
                id={id('date')}
                type="date"
                className="usa-input"
                value={line.serviceDate}
                required={Boolean(line.carried.sourceLocation)}
                onChange={(event) => update(index, { serviceDate: event.target.value })}
              />
            </div>
            <div className="usa-form-group line-what" data-label="What was done">
              <Label htmlFor={id('description')} className="line-label">{`${item} description`}</Label>
              <TextInput
                id={id('description')}
                name={id('description')}
                type="text"
                placeholder="What was done"
                value={line.description}
                onChange={(event) => update(index, { description: event.target.value })}
              />
              {(showTimekeeper || (billingCodes.length > 0 && (isTimeKind(line.lineType) || travel))) && (
              <div className="line-meta">
                {showTimekeeper && (
                  <>
                    <Label htmlFor={id('timekeeper')} className="line-label">{`${item} work done by`}</Label>
                    <PickOrAdd
                      id={id('timekeeper')}
                      value={line.timekeeperProfessionalId}
                      // Recorded time stays whose it is.
                      disabled={linked || Boolean(importReview?.fixedTimekeeper)}
                      onChange={(value) =>
                        update(index, {
                          timekeeperProfessionalId: value,
                          proposedTimekeeperName: value === ADD_NEW ? line.proposedTimekeeperName || (line.carried.timekeeperLabel ?? '') : '',
                          proposedTimekeeperEmail: value === ADD_NEW ? line.proposedTimekeeperEmail : '',
                          suggestedTimekeeper: false,
                        })
                      }
                      addLabel="+ Add new person"
                      placeholder={importReview ? '- Who did the work? -' : 'Billed professional'}
                      options={timekeepers.map((professional) => ({ value: professional.professionalId, label: professionalLabel(professional) }))}
                    >
                      {onProviderAdded ? (
                        <AddProvider
                          inline
                          idPrefix={id('timekeeper-new')}
                          initial={{ displayName: line.proposedTimekeeperName, email: line.proposedTimekeeperEmail || undefined }}
                          onAdded={(provider) => void addProvider(index, provider)}
                        />
                      ) : (
                        <ProposedPersonFields
                          idPrefix={id('timekeeper-new')}
                          value={{ displayName: line.proposedTimekeeperName, email: line.proposedTimekeeperEmail }}
                          onChange={(person) => update(index, { proposedTimekeeperName: person.displayName, proposedTimekeeperEmail: person.email ?? '' })}
                        />
                      )}
                    </PickOrAdd>
                    {lines.length > 1 &&
                      (line.timekeeperProfessionalId === ADD_NEW ? line.proposedTimekeeperName.trim() : addedIds.includes(line.timekeeperProfessionalId)) && (
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => onChange(sameTimekeeperForAll(lines, line, Boolean(importReview?.fixedTimekeeper)))}
                        >
                          {`Use ${line.timekeeperProfessionalId === ADD_NEW ? line.proposedTimekeeperName.trim() : timekeepers.find((p) => p.professionalId === line.timekeeperProfessionalId)?.displayName} for every other item`}
                        </button>
                      )}
                  </>
                )}
                {billingCodes.length > 0 && (isTimeKind(line.lineType) || travel) && (
                  <>
                    <Label htmlFor={id('task-code')} className="line-label">{`${item} ${travel ? 'travel time ' : ''}task code`}</Label>
                    <Select
                      id={id('task-code')}
                      name={id('task-code')}
                      value={taskCode ?? ''}
                      onChange={(event) => setTaskCode(event.target.value || undefined)}
                    >
                      <option value="">{travel ? '- Travel time task code -' : '- Task code -'}</option>
                      {taskCode && !billingCodes.some((code) => code.code === taskCode) && (
                        <option value={taskCode}>{taskCode} (not on list)</option>
                      )}
                      {billingCodes.map((code) => (
                        <option key={code.code} value={code.code}>
                          {code.code} {code.displayName}
                        </option>
                      ))}
                    </Select>
                  </>
                )}
              </div>
              )}
            </div>
            <div className="usa-form-group" data-label={travel ? 'Travel hours' : 'Hours'}>
              <Label htmlFor={id('quantity')} className="line-label">{`${item} ${travel ? 'travel hours' : 'hours'}`}</Label>
              <TextInput
                id={id('quantity')}
                name={id('quantity')}
                type="number"
                min="0"
                step="0.01"
                placeholder={isTimeKind(line.lineType) ? 'Hours' : travel ? 'Travel hours' : 'Optional'}
                value={travel ? line.travelHours : line.quantity}
                onChange={(event) => update(index, travel ? { travelHours: event.target.value } : { quantity: event.target.value })}
              />
            </div>
            <div className="line-amount line-rate" data-label="Rate">
              <span className="line-label">{`${item} rate`}</span>
              {preview && 'amount' in preview ? (
                <span className="line-amount-priced">
                  <span className="amount">{formatMoney(preview.rate)}/h</span>
                  {Number(preview.rate) !== Number(preview.configuredRate) && (
                    <span className="line-amount-basis line-rate-differs">Configured {formatMoney(preview.configuredRate)}</span>
                  )}
                </span>
              ) : (
                <span className="muted amount">—</span>
              )}
            </div>
            {isTimeKind(line.lineType) ? (
              <div className="usa-form-group line-amount" data-label="Amount">
                <span className="line-label">{`${item} amount in dollars`}</span>
                {preview && 'amount' in preview ? (
                  <strong className="amount">{formatMoney(preview.amount)}</strong>
                ) : (
                  <span className="line-amount-missing">{preview?.missing}</span>
                )}
              </div>
            ) : travelPreview ? (
              // The trip's total; each part is priced below.
              <div className="usa-form-group line-amount" data-label="Trip total">
                <span className="line-label">{`${item} trip total in dollars`}</span>
                {missing.length > 0 || !isItem(line) ? (
                  <span className="line-amount-missing">{missing.length > 0 ? missing.join('; ') : 'Add hours, miles or a cost'}</span>
                ) : (
                  <strong className="amount">{formatMoney(((travelPreview.timeCents + travelPreview.otherCents) / 100).toFixed(2))}</strong>
                )}
              </div>
            ) : (
              <div className="usa-form-group" data-label="Amount">
                <Label htmlFor={id('amount')} className="line-label">{`${item} amount in dollars`}</Label>
                <TextInput
                  id={id('amount')}
                  name={id('amount')}
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={line.amount}
                  onChange={(event) => update(index, { amount: event.target.value })}
                />
              </div>
            )}
            {lines.length > 1 ? (
              <button
                type="button"
                className="line-remove"
                aria-label={`Remove ${item.toLowerCase()}`}
                title={linked ? 'Remove item (the time stays recorded, unbilled)' : 'Remove item'}
                onClick={() => onChange(lines.filter((_, i) => i !== index))}
              >
                ×
              </button>
            ) : (
              <span />
            )}
            {travel && (
              <TripFields idPrefix={`${idPrefix}-${index}`} line={line} mileagePreview={mileagePreview} onChange={(changes) => update(index, changes)} />
            )}
            {(importReview || linked || differsFromFile || sameAsRecorded || joinTrip !== undefined) && (
              <p className="line-row-note">
                {joinTrip !== undefined && (
                  // Offered, never done for them: grouping is optional.
                  <span>
                    A trip on the same day is item {joinTrip + 1}.{' '}
                    <button type="button" className="link-button" onClick={() => onChange(addToTrip(lines, index, joinTrip))}>
                      {line.lineType === 'time' ? 'Make this its travel time' : 'Add this as one of its travel expenses'}
                    </button>
                  </span>
                )}
                {sameAsRecorded && (
                  <span className="line-row-suggested">
                    Matches time already recorded on {formatDate(sameAsRecorded.activityOn)} ({Number(sameAsRecorded.durationHours)} h).{' '}
                    <button
                      type="button"
                      className="link-button"
                      onClick={() =>
                        update(index, {
                          sourceTimeEntryId: sameAsRecorded.timeEntryId,
                          description: sameAsRecorded.description,
                          timekeeperProfessionalId: sameAsRecorded.professionalId,
                        })
                      }
                    >
                      Bill that instead
                    </button>
                  </span>
                )}
                {linked && <span>Recorded time: changes here update it.</span>}
                {importReview?.sourceLocations?.[index] && line.invoiceLineId ? (
                  <span>
                    In the original: <SourceLocation location={importReview.sourceLocations[index]!} onShow={importReview.onShowSource} />
                  </span>
                ) : null}
                {line.carried.timekeeperLabel ? <span>On file: {line.carried.timekeeperLabel}</span> : null}
                {differsFromFile ? (
                  <span className="line-row-suggested">
                    The file says {formatMoney(String(stated))}
                    {line.carried.unitRate !== undefined
                      ? ` at ${formatRate(String(line.carried.unitRate))}${travel ? '/mi' : '/h'}`
                      : ''}
                    , which doesn't match the {travel ? 'miles' : 'hours'} and rate.
                  </span>
                ) : null}
                {unmatched ? (
                  <span className="line-row-suggested">Who did this work will be matched on Intake</span>
                ) : line.timekeeperProfessionalId === ADD_NEW ? (
                  <span className="line-row-suggested">Not in the system yet: matched on Intake</span>
                ) : line.suggestedTimekeeper ? (
                  <span className="line-row-suggested">Suggested match: check it</span>
                ) : null}
              </p>
            )}
            {duplicate && (
              <Checkbox
                id={id('link-time')}
                name={id('link-time')}
                checked={line.sourceTimeEntryId === duplicate.timeEntryId}
                onChange={(event) => update(index, { sourceTimeEntryId: event.target.checked ? duplicate.timeEntryId : '' })}
                label={`Time already recorded on ${duplicate.activityOn} (${duplicate.durationHours} h): link it instead of recording this work again`}
              />
            )}
          </div>
        );
      })}
      <div className="line-editor-foot">
        <button type="button" className="link-button line-add" onClick={() => onChange([...lines, emptyLine])}>
          + Add item
        </button>
        {hasInvoiceItems(lines) && (
          <p className="line-total" aria-live="polite">
            <strong>
              {totals.complete ? 'Total' : 'Total so far'} {formatMoney(totals.total.toFixed(2))}
            </strong>{' '}
            <span>
              (time {formatMoney(totals.time.toFixed(2))} · expenses and other {formatMoney(totals.other.toFixed(2))})
            </span>
            {!totals.complete && <span className="line-amount-missing"> Some items can't be priced yet.</span>}
          </p>
        )}
      </div>
    </div>
    </>
  );
}
