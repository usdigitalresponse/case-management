// model/rules.yaml request_preauthorization; workflows.yaml preauthorization_request.
import { z } from 'zod';
import { ValidationError } from '../../errors';
import { fieldErrorsFromZodIssues } from '../../intake/validation';

export const OPEN_STATUSES = ['submitted', 'info_requested'];
export const RATE_BASES = ['hourly', 'flat', 'per_unit'] as const;
export const DECISION_OUTCOMES = ['approved', 'denied', 'not_needed', 'duplicate', 'moot'] as const;
// The status each outcome leaves.
export const CLOSING_STATUS: Record<(typeof DECISION_OUTCOMES)[number], string> = {
  approved: 'approved',
  denied: 'denied',
  not_needed: 'not_needed',
  duplicate: 'not_needed',
  moot: 'not_needed',
};

export const money = z.coerce.number().positive('Enter an amount above zero.').max(10_000_000);

export function parse<T extends z.ZodType>(schema: T, rawInput: unknown): z.infer<T> {
  const parsed = schema.safeParse(rawInput ?? {});
  if (!parsed.success) throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  return parsed.data;
}
