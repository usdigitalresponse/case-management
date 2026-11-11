import { type TimeLogCheck, type TimeLogEntryCheck } from '../../../api/client';

// Checking time lines against a case time log (model/rules.yaml check_lines_against_time_log).

export interface LogPerson {
  professionalId: string;
  displayName: string;
}

export type LineCheck = TimeLogCheck['lines'][number];

export const hours = (value: number) => `${Number(value.toFixed(2))} h`;
export const entryLabel = (entry: TimeLogEntryCheck) => entry.entryId ?? `row ${entry.key.slice(1)}`;
