// Request-shape validation for model/forms.yaml:new_case, kept separate from
// createCase.ts's business-rule/reference-existence checks. Using a schema
// library (rather than hand-rolled presence checks) means malformed input
// (e.g. a non-UUID personId) is rejected here, before any DB query — the
// query layer never sees a value that could produce a raw driver error.
import { z } from 'zod';
import { optionalEmail } from '../people/emails';

const createCaseIdentifierInputSchema = z.object({
  identifierTypeId: z.string().uuid(),
  issuer: z.string().min(1),
  value: z.string().min(1),
  isPrimary: z.boolean().optional(),
});

export const createCaseInputSchema = z.object({
  requestId: z.string().uuid(),
  // An existing person, or a new one created with the case.
  personId: z.string().uuid().optional(),
  newClient: z
    .object({
      displayName: z.string().trim().min(2, 'Enter the client’s name.').max(200),
      email: optionalEmail,
      // Someone else with the same name as a person already in the system.
      confirmedNew: z.boolean().default(false),
    })
    .optional(),
  // Kept as the case's external reference when no primary identifier is given.
  caseNumber: z.string().trim().min(1).max(100).optional(),
  participantRoleId: z.string().uuid(),
  statusId: z.string().uuid(),
  // HTTP callers send an explicit instant; internal callers may pass a Date.
  effectiveAt: z.union([z.date(), z.iso.datetime({ offset: true })]).pipe(z.coerce.date()),
  countyId: z.string().uuid().optional(),
  caseCategoryId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
  officeId: z.string().uuid().optional(),
  jurisdictionId: z.string().uuid().optional(),
  preferredLanguageId: z.string().uuid().optional(),
  identifier: createCaseIdentifierInputSchema.optional(),
}).refine((input) => Boolean(input.personId) !== Boolean(input.newClient), {
  message: 'Choose the client, or add them.',
  path: ['personId'],
});

export type CreateCaseIdentifierInput = z.infer<typeof createCaseIdentifierInputSchema>;
export type CreateCaseInput = z.infer<typeof createCaseInputSchema>;

export function fieldErrorsFromZodIssues(issues: z.ZodIssue[]): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const path = issue.path.join('.') || '(root)';
    // First issue per field wins; that's enough detail for a field-level UI.
    fieldErrors[path] ??= issue.message;
  }
  return fieldErrors;
}
