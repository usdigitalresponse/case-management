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

export type SignOffBy = 'anyone' | 'approvers';

export interface ReviewSettings {
  defaultReviewerUserAccountId: string | null;
  defaultSignOffUserAccountIds: string[];
  // Whether any staff member may sign off, or only the named approvers.
  signOffBy: SignOffBy;
  signOffApproverUserAccountIds: string[];
  // Synthetic starting value; administrators change it.
  waitingAlertWorkingDays: number;
  // Approving the billed hours of a line a time log flags needs a reason (./reviewTimeLog.ts).
  timeLogBlocksApproval: boolean;
}

const DEFAULTS: ReviewSettings = {
  defaultReviewerUserAccountId: null,
  defaultSignOffUserAccountIds: [],
  signOffBy: 'anyone',
  signOffApproverUserAccountIds: [],
  waitingAlertWorkingDays: 10,
  timeLogBlocksApproval: false,
};

const SETTING_CODES = {
  defaultReviewerUserAccountId: 'default_reviewer',
  defaultSignOffUserAccountIds: 'default_sign_off',
  signOffBy: 'sign_off_by',
  signOffApproverUserAccountIds: 'sign_off_approvers',
  waitingAlertWorkingDays: 'waiting_alert_working_days',
  timeLogBlocksApproval: 'time_log_blocks_approval',
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

// Whether the settings let this staff member sign off.
export function allowedToSignOff(settings: Pick<ReviewSettings, 'signOffBy' | 'signOffApproverUserAccountIds'>, userAccountId: string): boolean {
  return settings.signOffBy === 'anyone' || settings.signOffApproverUserAccountIds.includes(userAccountId);
}

// Staff who may sign off under the current settings.
export async function canSignOff(db: DatabaseOrTransaction, userAccountId: string, settings?: ReviewSettings): Promise<boolean> {
  return (await loadReviewPermissions(db, userAccountId)).signOff && allowedToSignOff(settings ?? (await getReviewSettings(db)), userAccountId);
}

const uniqueIds = z
  .array(z.uuid())
  .max(20)
  .refine((ids) => new Set(ids).size === ids.length, 'List each person once.');

const settingsInputSchema = z.object({
  defaultReviewerUserAccountId: z.uuid().nullable().optional(),
  defaultSignOffUserAccountIds: uniqueIds.max(5).optional(),
  signOffBy: z.enum(['anyone', 'approvers']).optional(),
  signOffApproverUserAccountIds: uniqueIds.optional(),
  waitingAlertWorkingDays: z.coerce.number().int().min(1).max(60).optional(),
  timeLogBlocksApproval: z.boolean().optional(),
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
    throw new ValidationError({ defaultReviewerUserAccountId: 'Choose a staff member.' });
  }
  const current = await getReviewSettings(db);
  const next = { ...current, ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) } as ReviewSettings;
  // Only people newly added are checked, so someone deactivated since doesn't block other changes.
  const added = (ids: string[], before: string[]) => ids.filter((id) => !before.includes(id));
  for (const id of added(next.signOffApproverUserAccountIds, current.signOffApproverUserAccountIds)) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await loadReviewPermissions(db, id)).signOff) {
      throw new ValidationError({ signOffApproverUserAccountIds: 'Choose staff members.' });
    }
  }
  if (next.signOffBy === 'approvers' && next.signOffApproverUserAccountIds.length === 0) {
    throw new ValidationError({ signOffApproverUserAccountIds: 'Name at least one sign-off approver.' });
  }
  for (const id of added(next.defaultSignOffUserAccountIds, current.defaultSignOffUserAccountIds)) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await canSignOff(db, id, next))) {
      throw new ValidationError({ defaultSignOffUserAccountIds: 'Choose people who may sign off.' });
    }
  }
  if (next.signOffBy === 'approvers' && next.defaultSignOffUserAccountIds.some((id) => !next.signOffApproverUserAccountIds.includes(id))) {
    throw new ValidationError({ defaultSignOffUserAccountIds: 'Default sign-off approvers must be named sign-off approvers.' });
  }
  const recordedAt = new Date();
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
