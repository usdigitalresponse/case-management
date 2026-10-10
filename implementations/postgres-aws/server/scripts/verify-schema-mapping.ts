// Heuristic drift check between model/schema.yaml (canonical model) and
// src/db/schema.ts (this implementation's Drizzle mapping). Text-level only
// (does schema.ts mention each expected column name?) — catches a field
// silently disappearing, not a wrong type. Doesn't replace MAPPING.md's
// narrative notes on deliberate scope decisions.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const SCHEMA_YAML_PATH = join(REPO_ROOT, 'model', 'schema.yaml');
const DRIZZLE_SCHEMA_PATH = join(__dirname, '..', 'src', 'db', 'schema.ts');

// Entities this implementation maps, per MAPPING.md's "Entities in scope".
// Every other schema.yaml entity is intentionally absent from
// src/db/schema.ts and is not checked here.
const IN_SCOPE_ENTITIES = [
  'user_account',
  'county',
  'case',
  'office',
  'organization',
  'role',
  'person',
  'person_affiliation',
  'case_participant',
  'case_identifier',
  'case_lifecycle_event',
  'professional',
  'case_assignment',
  'time_entry',
  'invoice',
  'invoice_line',
  'invoice_approval_chain',
  'invoice_approval_decision',
  'document',
  'invoice_import',
  'invoice_event',
];

// Fields on in-scope entities that are deliberately not mapped, with the
// reason recorded here and in MAPPING.md's "Entities in scope" section.
// Anything not listed here is expected to appear in src/db/schema.ts;
// remove an entry (and update MAPPING.md) once the field is actually added.
const DELIBERATELY_OMITTED_FIELDS: Record<string, string> = {
  'organization.organization_type_id':
    'reference_data classification not needed for intake/read scope',
  'professional.qualification_level_id':
    'qualification-based assignment checks (require_qualification_for_assignment) not implemented yet',
  'time_entry.activity_id': 'no activity entity/table exists yet',
  'time_entry.office_id': 'no office scoping on time entries in this slice',
  'time_entry.case_program_id': 'no case_program entity/table exists yet',
  'time_entry.case_funding_id': 'no case_funding entity/table exists yet',
  'invoice.service_provider_id':
    'no service_provider table exists; professional plays that role for external submitters (invoice.professional_id)',
  'invoice_line.source_expense_id': 'no expense entity/table exists yet; out of scope (time and invoices only)',
};

interface SchemaYaml {
  entities: Record<string, { fields: Record<string, unknown> }>;
}

function main(): void {
  const schemaYaml = load(readFileSync(SCHEMA_YAML_PATH, 'utf8')) as SchemaYaml;
  const drizzleSource = readFileSync(DRIZZLE_SCHEMA_PATH, 'utf8');

  const missing: string[] = [];

  for (const entityName of IN_SCOPE_ENTITIES) {
    const entity = schemaYaml.entities[entityName];
    if (!entity) {
      missing.push(`model/schema.yaml has no entity "${entityName}" (IN_SCOPE_ENTITIES is stale)`);
      continue;
    }
    for (const fieldName of Object.keys(entity.fields)) {
      const key = `${entityName}.${fieldName}`;
      if (DELIBERATELY_OMITTED_FIELDS[key]) {
        continue;
      }
      const columnDeclaration = `'${fieldName}'`;
      if (!drizzleSource.includes(columnDeclaration)) {
        missing.push(`${key}: no column named '${fieldName}' found in src/db/schema.ts`);
      }
    }
  }

  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.error('Schema mapping drift detected:\n' + missing.map((m) => `  - ${m}`).join('\n'));
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(`OK: ${IN_SCOPE_ENTITIES.length} in-scope entities all present in src/db/schema.ts.`);
}

main();
