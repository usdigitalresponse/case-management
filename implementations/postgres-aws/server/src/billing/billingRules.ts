// The deployment's configurable billing rules (model/rules.yaml
// apply_billing_rules): each off, warn or require, set by administrators.
// Settings are insert-only; the latest per rule is in force.
import { z } from 'zod';
import { and, asc, desc, eq, inArray, ne, notInArray, sql } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../db/client';
import {
  billingCodes,
  billingRuleSetting,
  invoice,
  invoiceLine,
  invoiceLineTypes,
  invoiceStatuses,
  professional,
  timeEntry,
} from '../db/schema';
import { NotFoundError, ValidationError } from '../errors';
import { fieldErrorsFromZodIssues } from '../intake/validation';
import { UNSUBMITTED_INVOICE_STATUS_CODES } from './invoiceStatusCodes';

export type Enforcement = 'off' | 'warn' | 'require';

const hours = (min: number, max: number) => z.coerce.number().min(min).max(max);

export const BILLING_RULES = {
  billing_codes: {
    label: 'Billing codes',
    description: "Each time item carries a task code from the agency's list.",
    warnOnly: false,
    parameters: z.object({}),
    defaults: {},
  },
  time_increment: {
    label: 'Time increment',
    description: 'Hours are whole multiples of the increment. Hours are flagged, never rounded.',
    warnOnly: false,
    parameters: z.object({ increment: hours(0.01, 1) }),
    defaults: { increment: 0.1 },
  },
  daily_hour_cap: {
    label: 'Daily hour cap',
    description: "One person's billed hours on one date, on this invoice and those already submitted.",
    warnOnly: false,
    parameters: z.object({ hours: hours(0.5, 24) }),
    defaults: { hours: 10 },
  },
  long_entry: {
    label: 'Long entries',
    description: 'A single time item over this many hours may be block billing. Can only warn.',
    warnOnly: true,
    parameters: z.object({ hours: hours(0.5, 24) }),
    defaults: { hours: 6 },
  },
  billing_period: {
    label: 'Billing period',
    description: 'Invoices state a billing period, optionally within one calendar month.',
    warnOnly: false,
    parameters: z.object({ withinMonth: z.boolean() }),
    defaults: { withinMonth: false },
  },
} as const;

export type RuleCode = keyof typeof BILLING_RULES;
const RULE_CODES = Object.keys(BILLING_RULES) as RuleCode[];

export interface RuleSetting {
  code: RuleCode;
  label: string;
  description: string;
  warnOnly: boolean;
  enforcement: Enforcement;
  parameters: Record<string, unknown>;
}

export async function getBillingRules(db: DatabaseOrTransaction): Promise<RuleSetting[]> {
  const rows = await db.select().from(billingRuleSetting).orderBy(desc(billingRuleSetting.recordedAt));
  return RULE_CODES.map((code) => {
    const definition = BILLING_RULES[code];
    const latest = rows.find((row) => row.ruleCode === code);
    return {
      code,
      label: definition.label,
      description: definition.description,
      warnOnly: definition.warnOnly,
      enforcement: (latest?.enforcement as Enforcement | undefined) ?? 'off',
      parameters: { ...definition.defaults, ...((latest?.parameters as Record<string, unknown> | null) ?? {}) },
    };
  });
}

const settingInputSchema = z.object({
  enforcement: z.enum(['off', 'warn', 'require']),
  parameters: z.record(z.string(), z.unknown()).default({}),
});

export async function setBillingRule(
  db: DatabaseOrTransaction,
  adminUserAccountId: string,
  code: string,
  rawInput: unknown,
): Promise<RuleSetting> {
  if (!RULE_CODES.includes(code as RuleCode)) {
    throw new NotFoundError('Billing rule not found.');
  }
  const definition = BILLING_RULES[code as RuleCode];
  const input = settingInputSchema.safeParse(rawInput);
  if (!input.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(input.error.issues));
  }
  if (definition.warnOnly && input.data.enforcement === 'require') {
    throw new ValidationError({ enforcement: `${definition.label} can only warn.` });
  }
  const parameters = definition.parameters.safeParse({ ...definition.defaults, ...input.data.parameters });
  if (!parameters.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(parameters.error.issues));
  }
  await db.insert(billingRuleSetting).values({
    ruleCode: code,
    enforcement: input.data.enforcement,
    parameters: parameters.data,
    recordedByUserAccountId: adminUserAccountId,
    recordedAt: new Date(),
  });
  return (await getBillingRules(db)).find((rule) => rule.code === code)!;
}

// --- billing codes ------------------------------------------------------------

export async function listBillingCodes(db: DatabaseOrTransaction) {
  return db
    .select({ billingCodeId: billingCodes.id, code: billingCodes.code, displayName: billingCodes.displayName, active: billingCodes.active })
    .from(billingCodes)
    .orderBy(asc(billingCodes.code));
}

const codeInputSchema = z.object({
  code: z.string().trim().min(1).max(20),
  displayName: z.string().trim().min(1).max(200),
});

export async function addBillingCode(db: DatabaseOrTransaction, rawInput: unknown) {
  const input = codeInputSchema.safeParse(rawInput);
  if (!input.success) {
    throw new ValidationError(fieldErrorsFromZodIssues(input.error.issues));
  }
  const code = input.data.code.toUpperCase();
  const [row] = await db
    .insert(billingCodes)
    .values({ code, displayName: input.data.displayName })
    .onConflictDoNothing({ target: billingCodes.code })
    .returning();
  if (!row) {
    throw new ValidationError({ code: `The code ${code} is already on the list.` });
  }
  return { billingCodeId: row.id, code: row.code, displayName: row.displayName, active: row.active };
}

export async function setBillingCodeActive(db: DatabaseOrTransaction, billingCodeId: string, rawInput: unknown) {
  if (!z.uuid().safeParse(billingCodeId).success) {
    throw new NotFoundError('Billing code not found.');
  }
  const input = z.object({ active: z.boolean() }).safeParse(rawInput);
  if (!input.success) {
    throw new ValidationError({ active: 'Say whether the code is active.' });
  }
  const [row] = await db
    .update(billingCodes)
    .set({ active: input.data.active })
    .where(eq(billingCodes.id, billingCodeId))
    .returning();
  if (!row) {
    throw new NotFoundError('Billing code not found.');
  }
  return { billingCodeId: row.id, code: row.code, displayName: row.displayName, active: row.active };
}

// --- evaluation -------------------------------------------------------------

export interface RuleFinding {
  rule: RuleCode;
  enforcement: 'warn' | 'require';
  message: string;
  invoiceLineId?: string;
}

function formatHours(value: number): string {
  return `${Number(value.toFixed(2))} h`;
}

export async function evaluateBillingRules(db: DatabaseOrTransaction, invoiceId: string): Promise<RuleFinding[]> {
  const rules = (await getBillingRules(db)).filter((rule) => rule.enforcement !== 'off');
  if (rules.length === 0) {
    return [];
  }
  const [header] = await db
    .select({ professionalId: invoice.professionalId, periodStart: invoice.periodStart, periodEnd: invoice.periodEnd })
    .from(invoice)
    .where(eq(invoice.invoiceId, invoiceId));
  if (!header) {
    return [];
  }
  const rows = await db
    .select({
      invoiceLineId: invoiceLine.invoiceLineId,
      lineTypeCode: invoiceLineTypes.code,
      description: invoiceLine.description,
      taskCode: invoiceLine.taskCode,
      professionalId: sql<string>`coalesce(${timeEntry.professionalId}, ${invoiceLine.timekeeperProfessionalId}, ${invoice.professionalId})`,
      date: sql<string | null>`coalesce(${timeEntry.activityOn}, ${invoiceLine.serviceDate})`,
      hours: sql<string | null>`coalesce(${timeEntry.durationHours}, ${invoiceLine.quantity})`,
    })
    .from(invoiceLine)
    .innerJoin(invoice, eq(invoiceLine.invoiceId, invoice.invoiceId))
    .innerJoin(invoiceLineTypes, eq(invoiceLine.lineTypeId, invoiceLineTypes.id))
    .leftJoin(timeEntry, eq(invoiceLine.sourceTimeEntryId, timeEntry.timeEntryId))
    .where(eq(invoiceLine.invoiceId, invoiceId));
  const timeLines = rows
    .filter((row) => row.lineTypeCode === 'time')
    .map((row) => ({ ...row, hours: row.hours === null ? undefined : Number(row.hours) }));
  const item = (line: { description: string | null; date: string | null }) =>
    line.description ? `"${line.description}"` : line.date ? `The time item on ${line.date}` : 'A time item';

  const findings: RuleFinding[] = [];
  for (const rule of rules) {
    const enforcement = rule.enforcement as 'warn' | 'require';
    const add = (message: string, invoiceLineId?: string) => findings.push({ rule: rule.code, enforcement, message, invoiceLineId });
    switch (rule.code) {
      case 'billing_codes': {
        // eslint-disable-next-line no-await-in-loop
        const active = new Set((await listBillingCodes(db)).filter((code) => code.active).map((code) => code.code));
        for (const line of timeLines) {
          const code = line.taskCode?.trim().toUpperCase();
          if (!code) {
            add(`${item(line)} needs a task code from the agency's list.`, line.invoiceLineId);
          } else if (!active.has(code)) {
            add(`${item(line)} has task code ${code}, which isn't on the agency's list.`, line.invoiceLineId);
          }
        }
        break;
      }
      case 'time_increment': {
        const increment = Number(rule.parameters.increment);
        for (const line of timeLines) {
          if (line.hours !== undefined && Math.abs(Math.round(line.hours / increment) * increment - line.hours) > 1e-6) {
            add(`${item(line)}: ${formatHours(line.hours)} isn't a whole multiple of ${formatHours(increment)}.`, line.invoiceLineId);
          }
        }
        break;
      }
      case 'long_entry': {
        const limit = Number(rule.parameters.hours);
        for (const line of timeLines) {
          if (line.hours !== undefined && line.hours > limit) {
            add(
              `${item(line)} is ${formatHours(line.hours)} in one entry; if it covers several tasks, list them separately.`,
              line.invoiceLineId,
            );
          }
        }
        break;
      }
      case 'daily_hour_cap': {
        const cap = Number(rule.parameters.hours);
        const days = new Map<string, { professionalId: string; date: string; hours: number }>();
        for (const line of timeLines) {
          if (line.date && line.hours !== undefined) {
            const key = `${line.professionalId}|${line.date}`;
            const day = days.get(key) ?? { professionalId: line.professionalId, date: line.date, hours: 0 };
            day.hours += line.hours;
            days.set(key, day);
          }
        }
        if (days.size === 0) {
          break;
        }
        // eslint-disable-next-line no-await-in-loop
        const elsewhere = await hoursOnOtherInvoices(db, invoiceId, [...days.values()]);
        // eslint-disable-next-line no-await-in-loop
        const names = await professionalNames(db, [...new Set([...days.values()].map((day) => day.professionalId))]);
        for (const [key, day] of days) {
          const total = day.hours + (elsewhere.get(key) ?? 0);
          if (total > cap + 1e-6) {
            add(
              `${names.get(day.professionalId) ?? 'Someone'} has ${formatHours(total)} billed on ${day.date}, counting submitted invoices; the daily cap is ${formatHours(cap)}.`,
            );
          }
        }
        break;
      }
      case 'billing_period': {
        if (!header.periodStart || !header.periodEnd) {
          add('This invoice needs a billing period.');
        } else if (rule.parameters.withinMonth && header.periodStart.slice(0, 7) !== header.periodEnd.slice(0, 7)) {
          add('The billing period must fall within one calendar month.');
        }
        break;
      }
    }
  }
  return findings;
}

async function hoursOnOtherInvoices(
  db: DatabaseOrTransaction,
  invoiceId: string,
  days: Array<{ professionalId: string; date: string }>,
): Promise<Map<string, number>> {
  const professionalIds = [...new Set(days.map((day) => day.professionalId))];
  const dates = [...new Set(days.map((day) => day.date))];
  const who = sql<string>`coalesce(${timeEntry.professionalId}, ${invoiceLine.timekeeperProfessionalId}, ${invoice.professionalId})`;
  const when = sql<string>`coalesce(${timeEntry.activityOn}, ${invoiceLine.serviceDate})`;
  const rows = await db
    .select({
      professionalId: who,
      date: when,
      hours: sql<string>`sum(coalesce(${timeEntry.durationHours}, ${invoiceLine.quantity}))`,
    })
    .from(invoiceLine)
    .innerJoin(invoice, eq(invoiceLine.invoiceId, invoice.invoiceId))
    .innerJoin(invoiceStatuses, eq(invoice.statusId, invoiceStatuses.id))
    .innerJoin(invoiceLineTypes, eq(invoiceLine.lineTypeId, invoiceLineTypes.id))
    .leftJoin(timeEntry, eq(invoiceLine.sourceTimeEntryId, timeEntry.timeEntryId))
    .where(
      and(
        ne(invoiceLine.invoiceId, invoiceId),
        // Other drafts may be abandoned, so only submitted invoices count.
        notInArray(invoiceStatuses.code, UNSUBMITTED_INVOICE_STATUS_CODES),
        eq(invoiceLineTypes.code, 'time'),
        inArray(who, professionalIds),
        inArray(when, dates),
      ),
    )
    .groupBy(who, when);
  return new Map(rows.map((row) => [`${row.professionalId}|${row.date}`, Number(row.hours)]));
}

async function professionalNames(db: DatabaseOrTransaction, professionalIds: string[]) {
  const rows = await db
    .select({ professionalId: professional.professionalId, displayName: professional.displayName })
    .from(professional)
    .where(inArray(professional.professionalId, professionalIds));
  return new Map(rows.map((row) => [row.professionalId, row.displayName ?? undefined]));
}

// Blocks on any "require" finding; returns every finding and the settings
// they came from, for the submission snapshot.
export async function enforceBillingRules(db: DatabaseOrTransaction, invoiceId: string) {
  const findings = await evaluateBillingRules(db, invoiceId);
  const blocking = findings.filter((finding) => finding.enforcement === 'require');
  if (blocking.length > 0) {
    throw new ValidationError({ lines: blocking.map((finding) => finding.message).join(' ') });
  }
  const settings = (await getBillingRules(db))
    .filter((rule) => rule.enforcement !== 'off')
    .map(({ code, enforcement, parameters }) => ({ code, enforcement, parameters }));
  return { settings, findings };
}
