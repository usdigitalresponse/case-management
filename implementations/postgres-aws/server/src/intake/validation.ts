// Request-shape validation for model/forms.yaml:new_case, kept separate from
// createCase.ts's business-rule/reference-existence checks. Using a schema
// library (rather than hand-rolled presence checks) means malformed input
// (e.g. a non-UUID personId) is rejected here, before any DB query — the
// query layer never sees a value that could produce a raw driver error.
import { z } from 'zod';

const createCaseIdentifierInputSchema = z.object({
  identifierTypeId: z.string().uuid(),
  issuer: z.string().min(1),
  value: z.string().min(1),
  isPrimary: z.boolean().optional(),
});

export const createCaseInputSchema = z.object({
  requestId: z.string().uuid(),
  personId: z.string().uuid(),
  participantRoleId: z.string().uuid(),
  statusId: z.string().uuid(),
  effectiveAt: z.date(),
  countyId: z.string().uuid().optional(),
  caseCategoryId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
  officeId: z.string().uuid().optional(),
  jurisdictionId: z.string().uuid().optional(),
  preferredLanguageId: z.string().uuid().optional(),
  identifier: createCaseIdentifierInputSchema.optional(),
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
