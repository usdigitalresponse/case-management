import { describe, expect, it } from 'vitest';
import { createCaseInputSchema } from '../src/intake/validation';

const input = {
  requestId: '00000000-0000-4000-8000-000000000001',
  personId: '00000000-0000-4000-8000-000000000002',
  participantRoleId: '00000000-0000-4000-8000-000000000003',
  statusId: '00000000-0000-4000-8000-000000000004',
};

describe('effective timestamp validation', () => {
  it.each([null, false, true, 0, undefined, '', 'invalid', '2026-01-15', '2026-01-15T12:00:00'])
    ('rejects a missing or non-instant value: %s', (effectiveAt) => {
      expect(createCaseInputSchema.safeParse({ ...input, effectiveAt }).success).toBe(false);
    });

  it.each(['2026-01-15T12:00:00Z', '2026-01-15T04:00:00-08:00', new Date('2026-01-15T12:00:00Z')])
    ('accepts an explicit instant: %s', (effectiveAt) => {
      expect(createCaseInputSchema.parse({ ...input, effectiveAt }).effectiveAt.toISOString())
        .toBe('2026-01-15T12:00:00.000Z');
    });
});
