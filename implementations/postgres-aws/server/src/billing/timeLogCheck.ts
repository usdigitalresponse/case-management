// Compares an invoice's time lines with a case time log (model/rules.yaml
// check_lines_against_time_log). Pure: ./reviewTimeLog.ts loads and stores.
import type { TimeLogEntry } from '../imports/readTimeLog';

export const NOT_A_PERSON = 'not_a_person';

export interface CheckLine {
  invoiceLineId: string;
  lineTypeCode: string;
  serviceDate: string | null;
  quantity: number | null;
  professionalId: string | null;
}

export interface CheckPerson {
  professionalId: string;
  displayName: string;
}

export type LineCheckStatus =
  | 'matched'
  | 'linked'
  | 'hours_differ'
  | 'several'
  | 'combined'
  | 'date_differs'
  | 'other_account'
  | 'not_in_log'
  | 'not_checked';

export interface LineCheck {
  invoiceLineId: string;
  status: LineCheckStatus;
  // Matched or linked entries, else the entries the status is about.
  entryKeys: string[];
  loggedHours: number | null;
  flagged: boolean;
}

export type EntryUse = 'matched' | 'linked' | 'suggested' | 'unbilled' | 'outside_period' | 'unreadable';

export interface EntryCheck extends TimeLogEntry {
  professionalId: string | null;
  use: EntryUse;
  invoiceLineId: string | null;
  // Stop minus start, when both are given and disagree with the hours.
  clockHours: number | null;
}

export interface WorkerCheck {
  name: string;
  entryCount: number;
  professionalId: string | null;
  notAPerson: boolean;
  // Matched by exact name, with nothing to confirm.
  automatic: boolean;
  // A likely person, until the reviewer confirms or chooses another.
  suggestedProfessionalId: string | null;
}

export interface DailyTotal {
  date: string;
  professionalId: string;
  billed: number;
  logged: number;
}

export interface TimeLogComparison {
  period: { start: string; end: string } | null;
  lines: LineCheck[];
  entries: EntryCheck[];
  workers: WorkerCheck[];
  dailyTotals: DailyTotal[];
}

const hundredths = (hours: number) => Math.round(hours * 100);
const sameHours = (a: number, b: number) => hundredths(a) === hundredths(b);
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

const normalizeName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z\s,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function nameParts(name: string): { first: string; last: string } | null {
  const normal = normalizeName(name);
  const [before, after] = normal.split(',').map((part) => part.trim());
  const words = (after ? `${after} ${before}` : normal).replace(/,/g, '').split(' ').filter(Boolean);
  return words.length >= 2 ? { first: words[0]!, last: words.at(-1)! } : null;
}

// "Last, First", a first initial, or a shortened first name, with the same last name.
function looksLike(logName: string, personName: string): boolean {
  const log = nameParts(logName);
  const person = nameParts(personName);
  if (!log || !person) {
    return false;
  }
  if (log.last === person.last) {
    return log.first === person.first || person.first.startsWith(log.first) || log.first.startsWith(person.first);
  }
  // "First L."
  return log.first === person.first && log.last.length === 1 && person.last.startsWith(log.last);
}

export function checkWorkers(entries: TimeLogEntry[], people: CheckPerson[], stored: Record<string, string>): WorkerCheck[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.worker, (counts.get(entry.worker) ?? 0) + 1);
  }
  return [...counts].map(([name, entryCount]) => {
    const choice = stored[name];
    // A name with no letters to compare is never an exact match.
    const exact = normalizeName(name) === '' ? [] : people.filter((person) => normalizeName(person.displayName) === normalizeName(name));
    const likely = people.filter((person) => looksLike(name, person.displayName));
    const automatic = choice === undefined && exact.length === 1;
    return {
      name,
      entryCount,
      professionalId: choice && choice !== NOT_A_PERSON ? choice : automatic ? exact[0]!.professionalId : null,
      notAPerson: choice === NOT_A_PERSON,
      automatic,
      suggestedProfessionalId: choice === undefined && !automatic && likely.length === 1 ? likely[0]!.professionalId : null,
    };
  });
}

// Entries that add up to `target`, fewest first; at least two of them.
function combination(entries: EntryCheck[], target: number): EntryCheck[] | null {
  const pool = entries.slice(0, 12);
  let best: EntryCheck[] | null = null;
  for (let mask = 1; mask < 1 << pool.length; mask += 1) {
    const chosen = pool.filter((_, index) => mask & (1 << index));
    if (chosen.length >= 2 && (!best || chosen.length < best.length) && sameHours(sum(chosen.map((entry) => entry.hours!)), target)) {
      best = chosen;
    }
  }
  return best;
}

const dayApart = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) === 86_400_000;

function clockHours(entry: TimeLogEntry): number | null {
  if (!entry.start || !entry.stop || entry.hours === null) {
    return null;
  }
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  let span = minutes(entry.stop) - minutes(entry.start);
  if (span < 0) span += 1440;
  return sameHours(span / 60, entry.hours) ? null : span / 60;
}

// The billing period, else the span of the lines' dates.
function periodOf(lines: CheckLine[], period: { start: string | null; end: string | null }) {
  if (period.start && period.end) {
    return { start: period.start, end: period.end };
  }
  const dates = lines.flatMap((line) => (line.serviceDate ? [line.serviceDate] : [])).sort();
  return dates.length > 0 ? { start: period.start ?? dates[0]!, end: period.end ?? dates.at(-1)! } : null;
}

export function compareWithTimeLog(input: {
  lines: CheckLine[];
  entries: TimeLogEntry[];
  people: CheckPerson[];
  workerMatches: Record<string, string>;
  lineLinks: Record<string, string[]>;
  period: { start: string | null; end: string | null };
}): TimeLogComparison {
  const period = periodOf(input.lines, input.period);
  const workers = checkWorkers(input.entries, input.people, input.workerMatches);
  const personOf = new Map(workers.map((worker) => [worker.name, worker.professionalId]));
  const entries: EntryCheck[] = input.entries.map((entry) => ({
    ...entry,
    professionalId: personOf.get(entry.worker) ?? null,
    use:
      entry.date === null || entry.hours === null
        ? 'unreadable'
        : period && (entry.date < period.start || entry.date > period.end)
          ? 'outside_period'
          : 'unbilled',
    invoiceLineId: null,
    clockHours: clockHours(entry),
  }));
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  const open = () => entries.filter((entry) => entry.use === 'unbilled');
  const take = (entry: EntryCheck, use: EntryUse, invoiceLineId: string) => {
    entry.use = use;
    entry.invoiceLineId = invoiceLineId;
  };

  const checks = new Map<string, LineCheck>();
  const checkable = input.lines.filter(
    (line) => line.lineTypeCode === 'time' && line.serviceDate !== null && line.quantity !== null && line.quantity > 0,
  );
  for (const line of input.lines.filter((candidate) => !checkable.includes(candidate))) {
    checks.set(line.invoiceLineId, { invoiceLineId: line.invoiceLineId, status: 'not_checked', entryKeys: [], loggedHours: null, flagged: false });
  }

  // Linked by the reviewer, wherever the entries fall.
  for (const line of checkable) {
    const linked = (input.lineLinks[line.invoiceLineId] ?? []).flatMap((key) => {
      const entry = byKey.get(key);
      return entry && entry.hours !== null ? [entry] : [];
    });
    if (linked.length === 0) continue;
    linked.forEach((entry) => take(entry, 'linked', line.invoiceLineId));
    const logged = sum(linked.map((entry) => entry.hours!));
    checks.set(line.invoiceLineId, {
      invoiceLineId: line.invoiceLineId,
      status: 'linked',
      entryKeys: linked.map((entry) => entry.key),
      loggedHours: logged,
      flagged: !sameHours(logged, line.quantity!),
    });
  }

  const unchecked = () => checkable.filter((line) => !checks.has(line.invoiceLineId));
  const samePerson = (entry: EntryCheck, line: CheckLine) => line.professionalId !== null && entry.professionalId === line.professionalId;
  const set = (line: CheckLine, status: LineCheckStatus, related: EntryCheck[], use: EntryUse | null) => {
    if (use) related.forEach((entry) => take(entry, use, line.invoiceLineId));
    checks.set(line.invoiceLineId, {
      invoiceLineId: line.invoiceLineId,
      status,
      entryKeys: related.map((entry) => entry.key),
      loggedHours: related.length > 0 ? sum(related.map((entry) => entry.hours!)) : null,
      flagged: status !== 'matched',
    });
  };

  // Same date, person and hours: paired off in order; more entries than lines is ambiguous.
  const groups = new Map<string, CheckLine[]>();
  for (const line of unchecked()) {
    const key = `${line.serviceDate}|${line.professionalId}|${hundredths(line.quantity!)}`;
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  for (const lines of groups.values()) {
    const [first] = lines;
    const candidates = open().filter(
      (entry) => entry.date === first!.serviceDate && samePerson(entry, first!) && sameHours(entry.hours!, first!.quantity!),
    );
    if (candidates.length > lines.length) {
      lines.forEach((line) => set(line, 'several', candidates, null));
      candidates.forEach((entry) => (entry.use = 'suggested'));
    } else {
      lines.slice(0, candidates.length).forEach((line, index) => set(line, 'matched', [candidates[index]!], 'matched'));
    }
  }

  for (const line of unchecked()) {
    const sameDay = open().filter((entry) => entry.date === line.serviceDate && samePerson(entry, line));
    const combined = combination(sameDay, line.quantity!);
    const nextDay = open().filter((entry) => samePerson(entry, line) && dayApart(entry.date!, line.serviceDate!) && sameHours(entry.hours!, line.quantity!));
    const otherAccount = open().filter((entry) => entry.date === line.serviceDate && entry.professionalId === null);
    if (combined) set(line, 'combined', combined, 'suggested');
    else if (sameDay.length > 0) set(line, 'hours_differ', sameDay, 'suggested');
    else if (nextDay.length > 0) set(line, 'date_differs', nextDay.slice(0, 1), 'suggested');
    else if (otherAccount.length > 0) set(line, 'other_account', otherAccount, 'suggested');
    else set(line, 'not_in_log', [], null);
  }

  const totals = new Map<string, DailyTotal>();
  const add = (date: string, professionalId: string, field: 'billed' | 'logged', hours: number) => {
    const key = `${date}|${professionalId}`;
    const total = totals.get(key) ?? { date, professionalId, billed: 0, logged: 0 };
    total[field] += hours;
    totals.set(key, total);
  };
  checkable.forEach((line) => line.professionalId && add(line.serviceDate!, line.professionalId, 'billed', line.quantity!));
  entries
    // A linked entry may have no date once other columns are chosen.
    .filter((entry) => entry.professionalId && entry.date !== null && entry.use !== 'outside_period' && entry.use !== 'unreadable')
    .forEach((entry) => add(entry.date!, entry.professionalId!, 'logged', entry.hours!));

  return {
    period,
    lines: input.lines.map((line) => checks.get(line.invoiceLineId)!),
    entries,
    workers,
    dailyTotals: [...totals.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
