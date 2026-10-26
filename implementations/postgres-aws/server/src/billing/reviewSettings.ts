// Deployment-wide review settings (model/schema.yaml invoice_review_setting):
// the default reviewer, the default sign-off approvers and when a waiting
// invoice is called out. Insert-only; the latest per code is in force.
import { z } from 'zod';
import { desc } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../db/client';
import { invoiceReviewSetting } from '../db/schema';
import { ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import { loadReviewPermissions } from './reviewAccess';

export interface ReviewSettings {
  defaultReviewerUserAccountId: string | null;
  defaultSignOffUserAccountIds: string[];
  // Synthetic starting value; administrators change it.
  waitingAlertWorkingDays: number;
}

const DEFAULTS: ReviewSettings = {
  defaultReviewerUserAccountId: null,
  defaultSignOffUserAccountIds: [],
  waitingAlertWorkingDays: 10,
};

const SETTING_CODES = {
  defaultReviewerUserAccountId: 'default_reviewer',
  defaultSignOffUserAccountIds: 'default_sign_off',
  waitingAlertWorkingDays: 'waiting_alert_working_days',
} as const;

export async function getReviewSettings(db: DatabaseOrTransaction): Promise<ReviewSettings> {
  const rows = await db.select().from(invoiceReviewSetting).orderBy(desc(invoiceReviewSetting.recordedAt));
  const latest = (code: string) => rows.find((row) => row.settingCode === code)?.parameters as { value?: unknown } | undefined;
  const settings = { ...DEFAULTS };
  for (const [key, code] of Object.entries(SETTING_CODES) as Array<[keyof ReviewSettings, string]>) {
    const value = latest(code)?.value;
    if (value !== undefined) {
      (settings as Record<string, unknown>)[key] = value;
    }
  }
  return settings;
}

const settingsInputSchema = z.object({
  defaultReviewerUserAccountId: z.uuid().nullable().optional(),
  defaultSignOffUserAccountIds: z.array(z.uuid()).max(5).optional(),
  waitingAlertWorkingDays: z.coerce.number().int().min(1).max(60).optional(),
});

export async function setReviewSettings(
  db: DatabaseOrTransaction,
  adminUserAccountId: string,
  rawInput: unknown,
): Promise<ReviewSettings> {
  const parsed = settingsInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parsed.error.issues));
  }
  const input = parsed.data;
  if (input.defaultReviewerUserAccountId && !(await loadReviewPermissions(db, input.defaultReviewerUserAccountId)).reviewLines) {
    throw new ValidationError({ defaultReviewerUserAccountId: 'Choose someone who reviews invoices.' });
  }
  if (input.defaultSignOffUserAccountIds) {
    if (new Set(input.defaultSignOffUserAccountIds).size !== input.defaultSignOffUserAccountIds.length) {
      throw new ValidationError({ defaultSignOffUserAccountIds: 'List each person once.' });
    }
    for (const id of input.defaultSignOffUserAccountIds) {
      // eslint-disable-next-line no-await-in-loop
      if (!(await loadReviewPermissions(db, id)).signOff) {
        throw new ValidationError({ defaultSignOffUserAccountIds: 'Choose people who sign off invoices.' });
      }
    }
  }
  const recordedAt = new Date();
  const current = await getReviewSettings(db);
  const changed = (Object.keys(SETTING_CODES) as Array<keyof ReviewSettings>).filter(
    (key) => input[key] !== undefined && JSON.stringify(input[key]) !== JSON.stringify(current[key]),
  );
  if (changed.length > 0) {
    await db.insert(invoiceReviewSetting).values(
      changed.map((key) => ({
        settingCode: SETTING_CODES[key],
        parameters: { value: input[key] },
        recordedByUserAccountId: adminUserAccountId,
        recordedAt,
      })),
    );
  }
  return getReviewSettings(db);
}
