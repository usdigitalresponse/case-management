// Writes supporting invoice files that name the demo seed's own vendors, for
// cases they're really assigned to, so importing one in the demo shows
// timekeeper matching working. Read-only against the database; the files
// go to ../demo-invoices/ (gitignored), since the names come from Faker at
// seed time and change whenever the seed does. The portable, committed
// samples live in scenarios/fixtures/invoices/.
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import { db, pool } from '../src/db/client';
import { caseAssignment, caseTable, person, professional, userAccount } from '../src/db/schema';
import { EXTERNAL_DEMO_EMAIL } from '../src/db/demoAccounts';
import { representedProfessionalIds } from '../src/portal/portalActor';

const OUT_DIR = join(__dirname, '..', '..', 'demo-invoices');

const LEDES_FIELDS = [
  'INVOICE_DATE', 'INVOICE_NUMBER', 'CLIENT_ID', 'LAW_FIRM_MATTER_ID', 'INVOICE_TOTAL', 'BILLING_START_DATE',
  'BILLING_END_DATE', 'INVOICE_DESCRIPTION', 'LINE_ITEM_NUMBER', 'EXP/FEE/INV_ADJ_TYPE', 'LINE_ITEM_NUMBER_OF_UNITS',
  'LINE_ITEM_ADJUSTMENT_AMOUNT', 'LINE_ITEM_TOTAL', 'LINE_ITEM_DATE', 'LINE_ITEM_TASK_CODE', 'LINE_ITEM_EXPENSE_CODE',
  'LINE_ITEM_ACTIVITY_CODE', 'TIMEKEEPER_ID', 'LINE_ITEM_DESCRIPTION', 'LAW_FIRM_ID', 'LINE_ITEM_UNIT_COST',
  'TIMEKEEPER_NAME', 'TIMEKEEPER_CLASSIFICATION', 'CLIENT_MATTER_ID',
];

interface Item {
  type: 'F' | 'E';
  date: string;
  hours: number;
  rate: number;
  timekeeper: string;
  description: string;
  task?: string;
  activity?: string;
  expense?: string;
}

function ledes(invoiceNumber: string, items: Item[]): string {
  const total = items.reduce((sum, item) => sum + Math.round(item.hours * item.rate * 100), 0) / 100;
  const rows = items.map((item, index) => {
    const values: Record<string, string> = {
      INVOICE_DATE: '20260301', INVOICE_NUMBER: invoiceNumber, CLIENT_ID: 'DEMO-CLIENT', LAW_FIRM_MATTER_ID: 'DEMO-MATTER',
      INVOICE_TOTAL: total.toFixed(2), BILLING_START_DATE: '20260201', BILLING_END_DATE: '20260228',
      INVOICE_DESCRIPTION: 'Demo invoice', LINE_ITEM_NUMBER: String(index + 1), 'EXP/FEE/INV_ADJ_TYPE': item.type,
      LINE_ITEM_NUMBER_OF_UNITS: String(item.hours), LINE_ITEM_ADJUSTMENT_AMOUNT: '0',
      LINE_ITEM_TOTAL: (item.hours * item.rate).toFixed(2), LINE_ITEM_DATE: item.date.replace(/-/g, ''),
      LINE_ITEM_TASK_CODE: item.task ?? '', LINE_ITEM_EXPENSE_CODE: item.expense ?? '', LINE_ITEM_ACTIVITY_CODE: item.activity ?? '',
      TIMEKEEPER_ID: `TK-${index + 1}`, LINE_ITEM_DESCRIPTION: item.description, LAW_FIRM_ID: 'DEMO-FIRM',
      LINE_ITEM_UNIT_COST: item.rate.toFixed(2), TIMEKEEPER_NAME: item.timekeeper, TIMEKEEPER_CLASSIFICATION: 'PT',
      CLIENT_MATTER_ID: 'DEMO-CM',
    };
    return `${LEDES_FIELDS.map((field) => (values[field] ?? '').replace(/\|/g, ' ')).join('|')}[]`;
  });
  return ['LEDES1998B[]', `${LEDES_FIELDS.join('|')}[]`, ...rows, ''].join('\n');
}

// "Smith, Jones and Lee" -> "Lee, Smith Jones and": the same name
// in the "Last, First" order some tools export, to show looser matching.
function lastFirst(name: string): string {
  const words = name.replace(/,/g, '').split(/\s+/);
  return words.length > 1 ? `${words[words.length - 1]}, ${words.slice(0, -1).join(' ')}` : name;
}

async function assignedCase(professionalId: string) {
  const [row] = await db
    .select({ caseId: caseTable.caseId, client: person.displayName })
    .from(caseAssignment)
    .innerJoin(caseTable, eq(caseAssignment.caseId, caseTable.caseId))
    .leftJoin(person, eq(caseTable.clientId, person.personId))
    .where(and(eq(caseAssignment.professionalId, professionalId), isNull(caseAssignment.endedAt)));
  return row;
}

async function main(): Promise<void> {
  const [account] = await db.select().from(userAccount).where(eq(userAccount.email, EXTERNAL_DEMO_EMAIL));
  const [self] = account
    ? await db.select().from(professional).where(eq(professional.userAccountId, account.userAccountId))
    : [];
  if (!account || !self) {
    throw new Error('Demo partner not found; run `npm run seed` first.');
  }
  const colleagueId = (await representedProfessionalIds(db, account.userAccountId)).find((id) => id !== self.professionalId);
  const [colleague] = colleagueId ? await db.select().from(professional).where(eq(professional.professionalId, colleagueId)) : [];

  mkdirSync(OUT_DIR, { recursive: true });
  const written: string[] = [];
  const ownCase = await assignedCase(self.professionalId);
  if (ownCase) {
    const name = self.displayName ?? 'Demo Partner';
    writeFileSync(
      join(OUT_DIR, 'own-case.ledes.txt'),
      ledes('DEMO-INV-1', [
        { type: 'F', date: '2026-02-03', hours: 1.5, rate: 200, timekeeper: name, description: 'Case review and planning', task: 'L110', activity: 'A101' },
        { type: 'F', date: '2026-02-10', hours: 2, rate: 200, timekeeper: lastFirst(name), description: 'Research for hearing', task: 'L120', activity: 'A102' },
        { type: 'F', date: '2026-02-12', hours: 0.5, rate: 150, timekeeper: 'Unmatched Demo Paralegal', description: 'Document preparation', task: 'L210', activity: 'A103' },
        { type: 'E', date: '2026-02-14', hours: 1, rate: 45, timekeeper: name, description: 'Filing fee', expense: 'E112' },
      ]),
    );
    writeFileSync(
      join(OUT_DIR, 'own-case.csv'),
      'invoice_number,date,type,description,hours,rate,amount\nDEMO-INV-2,2026-02-18,time,Client meeting,1,200,200\nDEMO-INV-2,2026-02-19,expense,Copies,,,12.50\n',
    );
    written.push(`own-case.ledes.txt, own-case.csv: open case "${ownCase.client ?? ownCase.caseId}"`);
  }
  if (colleague) {
    const colleagueCase = await assignedCase(colleague.professionalId);
    if (colleagueCase) {
      writeFileSync(
        join(OUT_DIR, 'colleague-case.ledes.txt'),
        ledes('DEMO-INV-3', [
          { type: 'F', date: '2026-02-05', hours: 3, rate: 175, timekeeper: colleague.displayName ?? 'Demo Colleague', description: 'Trial preparation', task: 'L430', activity: 'A101' },
        ]),
      );
      written.push(
        `colleague-case.ledes.txt: open case "${colleagueCase.client ?? colleagueCase.caseId}" and bill for ${colleague.displayName} (as delegate)`,
      );
    }
  }

  // eslint-disable-next-line no-console
  console.log(`Wrote demo invoice files to ${OUT_DIR}.\nSign in with "Demo partner sign-in", then:\n- ${written.join('\n- ')}`);
}

main()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void pool.end());
