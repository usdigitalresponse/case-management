// Bulk synthetic data in SQL; md5-derived ids (perfId) let tests name rows.
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { BaselineFixtureIds } from '../src/db/fixtures';

export interface Volume {
  professionals: number;
  cases: number;
  invoicesPerCase: number;
  linesPerInvoice: number;
}

// PERF_SCALE multiplies the default, e.g. 0.1 for a quick check, 4 for growth.
export function volumeFor(scale: number): Volume {
  return {
    professionals: Math.max(20, Math.round(200 * scale)),
    cases: Math.max(100, Math.round(2000 * scale)),
    invoicesPerCase: 5,
    linesPerInvoice: 20,
  };
}

export function perfId(kind: string, n: number | string): string {
  const hex = createHash('md5').update(`perf-${kind}-${n}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

export const caseReference = (c: number) => `PF-${String(c).padStart(6, '0')}`;

// Status by invoice number, as the SQL below assigns it.
const STATUS_BY_REMAINDER = [
  'draft', 'draft', 'withdrawn', 'rejected', 'submitted', 'submitted', 'submitted', 'submitted', 'under_review', 'under_review',
  'awaiting_sign_off', 'approved', 'approved', 'approved', 'approved', 'approved', 'approved', 'approved', 'approved', 'approved',
];
export const invoiceStatus = (g: number) => STATUS_BY_REMAINDER[g % 20]!;
// Every tenth invoice is filed by person with only a typed case number.
export const filedByPerson = (g: number) => g % 10 === 0;
export const caseOfInvoice = (volume: Volume, g: number) => 1 + ((g - 1) % volume.cases);
// Approved pre-authorizations, for the case's first provider.
export const preauthorizedCase = (c: number) => c % 10 === 5;
export const firstProfessionalOfCase = (volume: Volume, c: number) => 1 + (c % volume.professionals);

const GIVEN = [
  'Avery', 'Blake', 'Casey', 'Devon', 'Emery', 'Finley', 'Gray', 'Harper', 'Indigo', 'Jordan', 'Kai', 'Logan', 'Morgan', 'Noel',
  'Oakley', 'Parker', 'Quinn', 'Reese', 'Sage', 'Taylor', 'Umber', 'Vale', 'Wren', 'Xen', 'Yael', 'Zion', 'Ash', 'Bay', 'Cedar',
  'Dale', 'Eden', 'Fern', 'Glen', 'Hollis', 'Ira', 'Jules', 'Kit', 'Lane', 'Marlo', 'Nico',
];
const FAMILY = [
  'Alder', 'Birch', 'Cobalt', 'Dune', 'Ember', 'Frost', 'Garnet', 'Heath', 'Iris', 'Juniper', 'Kestrel', 'Larch', 'Maple', 'Nimbus',
  'Onyx', 'Pine', 'Quartz', 'Rowan', 'Slate', 'Thistle', 'Umbra', 'Vesper', 'Willow', 'Yarrow', 'Zephyr', 'Ashby', 'Brook', 'Clay',
  'Dell', 'Elm', 'Ford', 'Gale', 'Hale', 'Isle', 'Jett', 'Knoll', 'Lark', 'Moss', 'North', 'Orchard', 'Plum', 'Reed', 'Shore',
  'Thorn', 'Vale', 'West', 'Yew', 'Ridge', 'Stone', 'Field', 'Grove', 'Hill', 'Lake', 'Marsh', 'Park', 'River', 'Sand', 'Wood',
  'Bloom', 'Crest',
];
const MIDDLE = [
  'Amber', 'Basil', 'Coral', 'Dusk', 'Echo', 'Flint', 'Ginger', 'Hazel', 'Ivy', 'Jade', 'Kale', 'Lilac', 'Mint', 'Nova', 'Olive',
  'Pearl', 'Quill', 'Rain', 'Sky', 'Tide', 'Upton', 'Violet', 'Wade', 'Yuri', 'Zest', 'Bram',
];
const sqlArray = (values: string[]) => `array[${values.map((value) => `'${value}'`).join(',')}]`;
// Unique for n below 62,400 under nameKey, which ignores initials: given, middle, family.
const given = (n: string) => `(${sqlArray(GIVEN)})[1 + (${n}) % ${GIVEN.length}]`;
const family = (n: string) => `(${sqlArray(FAMILY)})[1 + ((${n}) / ${GIVEN.length}) % ${FAMILY.length}]`;
const middle = (n: string) => `(${sqlArray(MIDDLE)})[1 + ((${n}) / ${GIVEN.length * FAMILY.length}) % ${MIDDLE.length}]`;
// Version 4 and variant digits set, so the routes' uuid checks accept them.
const id = (kind: string, n: string) => `pg_temp.perf_uuid(md5('perf-${kind}-' || (${n})))`;

export async function loadVolume(pool: Pool, fixtures: BaselineFixtureIds, volume: Volume): Promise<void> {
  const { professionals: P, cases: C, invoicesPerCase, linesPerInvoice: L } = volume;
  const I = C * invoicesPerCase;
  const staff = fixtures.staffUserAccountId;
  const { rows: counties } = await pool.query<{ county_id: string }>('select county_id from county where is_county order by display_name');
  const countyArray = `array[${counties.map((row) => `'${row.county_id}'::uuid`).join(',')}]`;
  const countyOf = (c: string) => `(${countyArray})[1 + (${c}) % ${counties.length}]`;
  // Near-duplicate cases: every 40th repeats the last in its county, every 41st in another.
  const caseCounty = (c: string) => `case when (${c}) % 40 = 0 then ${countyOf(`(${c}) - 1`)} else ${countyOf(c)} end`;
  const caseRef = (c: string) =>
    `case when (${c}) % 40 = 0 then 'PF ' || lpad(((${c}) - 1)::text, 6, '0')
          when (${c}) % 41 = 0 then 'PF-' || lpad(((${c}) - 1)::text, 6, '0')
          else 'PF-' || lpad((${c})::text, 6, '0') end`;
  const ref = (table: string, code: string) => `(select id from ${table} where code = '${code}')`;

  const statements = [
    `create or replace function pg_temp.perf_uuid(h text) returns uuid language sql immutable as
     $$ select (substr(h, 1, 12) || '4' || substr(h, 14, 3) || '8' || substr(h, 18))::uuid $$`,
    `insert into person (person_id, given_name, family_name, display_name, email, external_sign_in_enabled)
     select ${id('pro-person', 'g')}, ${given('g + 30000')}, ${family('g + 30000')},
            ${given('g + 30000')} || ' ' || ${middle('g + 30000')} || ' ' || ${family('g + 30000')}, 'demo-vendor-perf-' || g || '@example.invalid', true
     from generate_series(1, ${P}) g`,
    `insert into user_account (user_account_id, display_name, email, person_id, active)
     select ${id('pro-account', 'g')}, p.display_name, p.email, p.person_id, true
     from generate_series(1, ${P}) g join person p on p.person_id = ${id('pro-person', 'g')}`,
    `insert into professional (professional_id, user_account_id, person_id, display_name, office_id)
     select ${id('pro', 'g')}, ${id('pro-account', 'g')}, p.person_id, p.display_name, '${fixtures.officeId}'::uuid
     from generate_series(1, ${P}) g join person p on p.person_id = ${id('pro-person', 'g')}`,
    // Planted duplicates: same name (50th), email (70th), birth date and family name (90th).
    `insert into person (person_id, given_name, family_name, display_name, date_of_birth, email)
     select ${id('client', 'c')}, ${given('n')}, ${family('f')},
            ${given('n')} || ' ' || ${middle('n')} || ' ' || ${family('f')},
            date '1960-01-01' + ((d * 37) % 15000),
            case when c % 70 = 0 then 'perf-client-' || (c - 1) || '@example.test'
                 when c % 10 = 1 or c % 70 = 69 then 'perf-client-' || c || '@example.test' end
     from generate_series(1, ${C}) c,
          lateral (select case when c % 50 = 0 then c - 1 else c end as n,
                          case when c % 50 = 0 or c % 90 = 0 then c - 1 else c end as f,
                          case when c % 90 = 0 then c - 1 else c end as d) k`,
    `insert into "case" (case_id, client_id, county_id, external_reference, status_id, opened_on, closed_on, organization_id, office_id)
     select ${id('case', 'c')}, ${id('client', 'c')}, ${caseCounty('c')}, ${caseRef('c')},
            case when c % 25 = 0 then '${fixtures.caseStatusClosedId}'::uuid else '${fixtures.caseStatusOpenId}'::uuid end,
            date '2025-01-01', case when c % 25 = 0 then date '2026-09-30' end, '${fixtures.organizationId}'::uuid, '${fixtures.officeId}'::uuid
     from generate_series(1, ${C}) c`,
    `insert into case_identifier (case_identifier_id, case_id, identifier_type_id, issuer, value)
     select ${id('case-identifier', 'c')}, ${id('case', 'c')}, ${ref('case_identifier_types', 'sample_docket')}, 'perf', 'D-' || c
     from generate_series(1, ${C}) c`,
    // One provider per case, and a second on every third case.
    `insert into case_assignment (case_id, professional_id, assigned_at, assignment_role_id, assigned_by_user_account_id)
     select ${id('case', 'c')}, ${id('pro', `1 + c % ${P}`)}, timestamptz '2025-01-01 12:00Z', '${fixtures.externalSubmitterAssignmentRoleId}'::uuid, '${staff}'::uuid
     from generate_series(1, ${C}) c
     union all
     select ${id('case', 'c')}, ${id('pro', `1 + (c * 7 + 1) % ${P}`)}, timestamptz '2025-01-01 12:00Z', '${fixtures.externalSubmitterAssignmentRoleId}'::uuid, '${staff}'::uuid
     from generate_series(1, ${C}) c where c % 3 = 0 and (c * 7 + 1) % ${P} <> c % ${P}`,
    `insert into preauthorization (preauthorization_id, case_id, professional_id, status_id, requested_amount, requested_at, authorization_number)
     select ${id('preauthorization', 'c')}, ${id('case', 'c')}, ${id('pro', `1 + c % ${P}`)}, ${ref('preauthorization_statuses', 'approved')},
            5000, timestamptz '2025-01-02 12:00Z', 'PA-' || c
     from generate_series(1, ${C}) c where c % 10 = 5`,
    `insert into preauthorization_decision (preauthorization_id, sequence_number, outcome_id, approved_amount, effective_at, decided_at, decided_by_user_account_id)
     select ${id('preauthorization', 'c')}, 1, ${ref('preauthorization_outcomes', 'approved')}, 5000,
            timestamptz '2025-01-03 12:00Z', timestamptz '2025-01-03 12:00Z', '${staff}'::uuid
     from generate_series(1, ${C}) c where c % 10 = 5`,
    // Invoices: five per case over 18 months, so periods on a case repeat and overlap.
    `create temporary table perf_invoice on commit drop as
     select g, c, pro, status_code, period_start, (period_start + interval '1 month' - interval '1 day')::date as period_end
     from generate_series(1, ${I}) g,
          lateral (select 1 + (g - 1) % ${C} as c) cc,
          lateral (select case when g % 4 = 0 and c % 3 = 0 and (c * 7 + 1) % ${P} <> c % ${P} then 1 + (c * 7 + 1) % ${P} else 1 + c % ${P} end as pro,
                          (${sqlArray(STATUS_BY_REMAINDER)})[1 + g % 20] as status_code,
                          (date '2025-06-01' + ((g * 7) % 18) * interval '1 month')::date as period_start) k`,
    `insert into invoice (invoice_id, submitted_by_user_account_id, professional_id, status_id, submitted_at, submitted_total, case_id,
                          period_start, period_end, case_number_as_typed, county_id)
     select ${id('invoice', 'g')}, ${id('pro-account', 'pro')}, ${id('pro', 'pro')}, s.id,
            case when status_code <> 'draft' then period_end + interval '3 days' end, 0,
            case when g % 10 <> 0 then ${id('case', 'c')} end, period_start, period_end,
            case when g % 30 = 0 then ${caseRef('c')} || 'X' when g % 10 = 0 then ${caseRef('c')} end, ${caseCounty('c')}
     from perf_invoice join invoice_statuses s on s.code = status_code`,
    `insert into trip (trip_id, invoice_id, trip_date, trip_origin, trip_destination, round_trip, route_distance)
     select ${id('trip', 'g')}, ${id('invoice', 'g')}, period_start + 20, 'Synthetic office', 'Synthetic courthouse', true, 18.0
     from perf_invoice`,
    // Every seventh invoice on a case carries its first three items as time entries.
    `insert into time_entry (time_entry_id, case_id, professional_id, activity_type_id, activity_on, duration_hours, description, recorded_by_user_account_id)
     select ${id('time-entry', `g || '-' || k`)}, ${id('case', 'c')}, ${id('pro', 'pro')}, ${ref('activity_types', 'legal_services')},
            period_start + (k * 3) % 28, 0.5 + ((g + k) % 6) * 0.5, 'Synthetic work item ' || k, ${id('pro-account', 'pro')}
     from perf_invoice, generate_series(0, 2) k where g % 7 = 0 and g % 10 <> 0`,
    // Items: time first, then travel time and mileage for the trip, then costs.
    `insert into invoice_line (invoice_line_id, invoice_id, case_id, line_type_id, source_time_entry_id, amount, service_date, position, description,
                               quantity, unit_rate, billed_rate, configured_rate, timekeeper_professional_id, expense_type_id, trip_id, task_code)
     select ${id('line', `g || '-' || k`)}, ${id('invoice', 'g')}, case when g % 10 <> 0 then ${id('case', 'c')} end,
            case when k < ${L - 3} then ${ref('invoice_line_types', 'time')} else ${ref('invoice_line_types', 'expense')} end,
            case when g % 7 = 0 and g % 10 <> 0 and k < 3 then ${id('time-entry', `g || '-' || k`)} end,
            qty * rate, case when k = ${L - 4} or k = ${L - 3} then period_start + 20 else period_start + (k * 3) % 28 end, k,
            case when k = ${L - 4} then 'Travel to court' when k = ${L - 3} then 'Mileage' when k > ${L - 3} then 'Copies' else 'Synthetic work item ' || k end,
            qty, rate, rate, rate,
            case when k < ${L - 3} then ${id('pro', `case when g % 6 = 0 and k % 5 = 0 then 1 + pro % ${P} else pro end`)} end,
            case when k = ${L - 3} then (select id from expense_types where code = 'mileage') end,
            case when k = ${L - 4} or k = ${L - 3} then ${id('trip', 'g')} end,
            case when k < ${L - 3} then 'L1' || (k % 4) end
     from perf_invoice, generate_series(0, ${L - 1}) k,
          lateral (select case when k = ${L - 3} then 40 when k > ${L - 3} then 1 else 0.5 + ((g + k) % 6) * 0.5 end as qty,
                          case when k = ${L - 3} then 0.67 when k > ${L - 3} then 25 else 150 end as rate) r`,
    `update invoice i set submitted_total = t.total
     from (select invoice_id, sum(amount) as total from invoice_line group by invoice_id) t where t.invoice_id = i.invoice_id`,
    `insert into invoice_approval_chain (invoice_approval_chain_id, invoice_id, created_by_user_account_id, created_at, submission_snapshot)
     select ${id('chain', 'g')}, ${id('invoice', 'g')}, ${id('pro-account', 'pro')}, period_end + interval '3 days', '{"billing_rules":{"findings":[]}}'::jsonb
     from perf_invoice where status_code not in ('draft', 'withdrawn')`,
    `insert into invoice_review_assignment (invoice_id, step_type_id, position, assigned_user_account_id, assigned_at, assigned_by_user_account_id)
     select ${id('invoice', 'g')}, ${ref('invoice_approval_step_types', 'line_review')}, 0, '${staff}'::uuid, period_end + interval '4 days', '${staff}'::uuid
     from perf_invoice where status_code in ('under_review', 'awaiting_sign_off')`,
    `insert into supporting_invoice (invoice_id, invoice_number, period_start, period_end)
     select ${id('invoice', 'g')}, 'INV-' || g, period_start, period_end from perf_invoice where status_code <> 'draft'`,
    // Half were uploaded; every 60th repeats a file, every 45th an invoice number.
    `insert into document (document_id, storage_reference, display_name, media_type, content_hash, recorded_at, recorded_by_user_account_id)
     select ${id('document', 'g')}, 'perf/' || g, 'invoice-' || g || '.pdf', 'application/pdf',
            md5('perf-file-' || case when g % 60 = 0 and g > ${C} then g - ${C} else g end), period_end + interval '1 day', ${id('pro-account', 'pro')}
     from perf_invoice where g % 2 = 0`,
    `insert into invoice_import (invoice_import_id, document_id, uploaded_by_user_account_id, uploaded_at, case_id, source_format_id, status_id,
                                 extraction_method, extracted_at, extraction_result, invoice_id)
     select ${id('import', 'g')}, ${id('document', 'g')}, ${id('pro-account', 'pro')}, period_end + interval '1 day',
            case when g % 10 <> 0 then ${id('case', 'c')} end, ${ref('invoice_import_formats', 'document')}, ${ref('invoice_import_statuses', 'confirmed')},
            'perf', period_end + interval '1 day',
            jsonb_build_object('warnings', '[]'::jsonb, 'invoice', jsonb_build_object('invoice_number',
              jsonb_build_object('value', 'INV-' || case when g % 45 = 0 and g > ${C} then g - ${C} else g end))),
            ${id('invoice', 'g')}
     from perf_invoice where g % 2 = 0`,
  ];
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const statement of statements) {
      await client.query(statement);
    }
    await client.query('commit');
    await client.query('analyze');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
