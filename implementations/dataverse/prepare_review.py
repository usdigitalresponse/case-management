"""Prepare the bounded Dataverse schema-review package; never deploys or authenticates."""
import argparse
import copy
from datetime import datetime
import json
from pathlib import Path
import uuid
import yaml

ROOT = Path(__file__).resolve().parents[2]


def prepare():
    schema = yaml.safe_load((ROOT / 'model/schema.yaml').read_text())
    fixture = yaml.safe_load((ROOT / 'scenarios/fixtures/review-example.yaml').read_text())
    reference_sets = sorted({f['reference_data'] for e in schema['entities'].values()
                             for f in e['fields'].values() if 'reference_data' in f})
    # Keep the two reference tables already deployed under the earlier names.
    ref_keys = {name: {'case_statuses': 'case_status', 'case_categories': 'case_category'}.get(name, name)
                for name in reference_sets}
    tables = []
    kinds = {'uuid': 'text', 'string': 'text', 'reference': 'lookup', 'date': 'date',
             'datetime': 'datetime', 'boolean': 'bool', 'integer': 'integer',
             'decimal': 'decimal', 'money': 'decimal', 'object': 'memo'}
    for key, entity in schema['entities'].items():
        fields = []
        for name, field in entity['fields'].items():
            if name == entity['primary_key']:
                continue
            target = field.get('references', '').split('.')[0] or ref_keys.get(field.get('reference_data'))
            kind = 'lookup' if target else kinds[field['type']]
            if name in ('body', 'detail', 'description', 'statement', 'reason_detail'):
                kind = 'memo'
            fields.append(dict(Key=name, Label=name.replace('_', ' ').capitalize(), Type=kind,
                               Required=field['required'], Target=target))
        tables.append(dict(Key=key, Label=entity['display_name'], Plural=entity['display_name'] + ' records',
                           Owned=key not in ('county', 'role'), Fields=fields))
    for name, key in ref_keys.items():
        tables.append(dict(Key=key, Label=name.replace('_', ' ').title(), Plural=name.replace('_', ' ').title(),
                           Owned=False, Fields=[dict(Key='active', Label='Active', Type='bool', Required=True, Target=None)]))
    records = copy.deepcopy(fixture['records'])
    ref_ids = {}
    for name, values in fixture['reference_data'].items():
        for value in values:
            ref_ids[(name, value)] = str(uuid.uuid5(uuid.NAMESPACE_URL, 'https://example.invalid/dataverse-reference/' + name + '/' + value))
    rows = []
    as_of = datetime.fromisoformat(fixture['as_of'].replace('Z', '+00:00'))
    def effective(row):
        start = datetime.fromisoformat(row['started_at'].replace('Z', '+00:00'))
        end = datetime.fromisoformat(row['ended_at'].replace('Z', '+00:00')) if row.get('ended_at') else None
        return start <= as_of and (end is None or as_of < end)
    lookup = {key: {r[schema['entities'][key]['primary_key']]: r for r in values} for key, values in records.items()}
    client_role_id = next(r['role_id'] for r in records['role']
                          if r['role_context'] == 'case_participant' and r['display_name'] == 'Client')
    for key, values in records.items():
        entity = schema['entities'][key]
        for i, row in enumerate(values):
            if key == 'case':
                events = sorted([e for e in records['case_lifecycle_event'] if e['case_id'] == row['case_id']], key=lambda e: e['sequence_number'])
                row.update(status_id=events[-1]['resulting_status_id'], opened_on=events[0]['effective_at'][:10],
                           closed_on=events[-1]['effective_at'][:10] if events[-1]['resulting_status_id'] == 'sample_closed' else None)
                identifiers = [r for r in records['case_identifier'] if r['case_id'] == row['case_id'] and r['is_primary']]
                if identifiers: row['external_reference'] = identifiers[0]['value']
                participants = [r for r in records['case_participant'] if r['case_id'] == row['case_id']
                                and r['participant_role_id'] == client_role_id and effective(r)]
                row['client_id'] = participants[0]['person_id'] if len(participants) == 1 else None
            if key == 'invoice':
                events = sorted([e for e in records['invoice_event'] if e['invoice_id'] == row['invoice_id']], key=lambda e: e['sequence_number'])
                row['status_id'] = events[-1]['resulting_status_id']
                row['submitted_at'] = next(e['occurred_at'] for e in events if e['resulting_status_id'] == 'sample_submitted')
            if key == 'preauthorization': row['status_id'] = 'sample_approved'
            if key == 'professional':
                row['display_name'] = lookup['person'][row['person_id']]['display_name']
                offices = {r['office_id'] for r in records['person_affiliation']
                           if r['person_id'] == row['person_id'] and r.get('office_id') and effective(r)}
                row['office_id'] = next(iter(offices)) if len(offices) == 1 else None
            label = row.get('display_name') or f'Sample {entity["display_name"]} {i+1}'
            values_out = {}
            for name, value in row.items():
                if name == entity['primary_key']: continue
                field = entity['fields'][name]
                if field['type'] == 'reference':
                    if (field['reference_data'], value) not in ref_ids:
                        ref_ids[(field['reference_data'], value)] = str(uuid.uuid5(uuid.NAMESPACE_URL, 'https://example.invalid/dataverse-reference/' + field['reference_data'] + '/' + value))
                    value = ref_ids[(field['reference_data'], value)]
                if field['type'] == 'object': value = json.dumps(value, separators=(',', ':'))
                values_out[name] = value
            native_inactive = key == 'case_assignment' and bool(row.get('ended_at')) and (
                datetime.fromisoformat(row['ended_at'].replace('Z', '+00:00')) <=
                datetime.fromisoformat(fixture['as_of'].replace('Z', '+00:00')))
            rows.append(dict(Table=key, Id=row[entity['primary_key']], Label=label,
                             Values=values_out, NativeInactive=native_inactive))
    for (name, value), identifier in ref_ids.items():
        rows.append(dict(Table=ref_keys[name], Id=identifier, Label=value.replace('_', ' ').title(), Values={'active': True}))
    return dict(SpecVersion=schema['spec_version'], Tables=tables, Rows=rows)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    args.output.write_text(json.dumps(prepare(), indent=2) + '\n')
    print(f'Prepared synthetic schema-review package: {args.output}')
