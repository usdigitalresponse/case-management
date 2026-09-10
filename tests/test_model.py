"""Offline fixture checks, not a production rule engine or platform conformance suite."""
from copy import deepcopy
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
import unittest
from uuid import UUID

import yaml

ROOT = Path(__file__).resolve().parents[1]


class UniqueLoader(yaml.SafeLoader):
    pass


def unique_mapping(loader, node, deep=False):
    result = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in result:
            raise ValueError(f"Duplicate YAML key {key} at {key_node.start_mark}")
        result[key] = loader.construct_object(value_node, deep=deep)
    return result


UniqueLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, unique_mapping)


def load(path):
    return yaml.load(path.read_text(), Loader=UniqueLoader)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def instant(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def role_id(fixture, display_name):
    return next(r['role_id'] for r in fixture['records']['role'] if r['display_name'] == display_name)


# These fields are plain schema fields (see "Deferred: fields that should
# become read models" in model/README.md), but prepare_review.py still
# computes and injects them from event/participant/affiliation history before
# writing to Dataverse, so the hand-authored fixture deliberately leaves them
# out rather than duplicating values that must stay consistent with that
# history. Promote a field out of this set once its source fixture rows
# supply it directly instead of prepare_review.py computing it.
COMPUTED_BY_REVIEW_PREPARATION = {
    ('case', 'status_id'), ('case', 'opened_on'), ('case', 'closed_on'),
    ('case', 'external_reference'), ('case', 'client_id'),
    ('professional', 'display_name'), ('professional', 'office_id'),
    ('invoice', 'status_id'), ('invoice', 'submitted_at'),
    ('preauthorization', 'status_id'),
}


def validate_records(schema, fixture):
    """Validate source fixtures; fields computed by prepare_review.py are deliberately absent."""
    records = fixture['records']
    index = {}
    for entity, rows in records.items():
        require(entity in schema, f'Unknown entity: {entity}')
        fields = schema[entity]['fields']
        primary_key = schema[entity]['primary_key']
        index[entity] = {}
        for row in rows:
            require(not row.keys() - fields.keys(), f'Unknown fields: {entity}')
            for key, definition in fields.items():
                value = row.get(key)
                if (entity, key) in COMPUTED_BY_REVIEW_PREPARATION:
                    require(key not in row, f'Field supplied that prepare_review.py computes: {entity}.{key}')
                    continue
                require(value is not None or not definition['required'],
                        f'Missing required: {entity}.{key}')
                if value is None:
                    continue
                kind = definition['type']
                if kind in ('uuid', 'string', 'reference', 'date', 'datetime'):
                    require(isinstance(value, str), f'Expected string: {entity}.{key}')
                if kind == 'uuid':
                    UUID(value)
                elif kind == 'date':
                    date.fromisoformat(value)
                elif kind == 'datetime':
                    require(instant(value).tzinfo is not None, 'Timestamp requires time zone')
                elif kind == 'boolean':
                    require(type(value) is bool, f'Expected boolean: {entity}.{key}')
                elif kind == 'integer':
                    require(type(value) is int, f'Expected integer: {entity}.{key}')
                elif kind in ('money', 'decimal'):
                    require(type(value) in (int, float) and Decimal(str(value)).is_finite(),
                            f'Expected finite number: {entity}.{key}')
                elif kind == 'object':
                    require(isinstance(value, dict), f'Expected object: {entity}.{key}')
                if kind == 'reference':
                    require(value in fixture['reference_data'].get(definition['reference_data'], []),
                            f'Unknown reference value: {entity}.{key}')
            require(row[primary_key] not in index[entity], f'Duplicate ID: {entity}')
            index[entity][row[primary_key]] = row
    for entity, rows in records.items():
        for row in rows:
            for key, value in row.items():
                definition = schema[entity]['fields'][key]
                if value is not None and 'references' in definition:
                    target, target_key = definition['references'].split('.')
                    require(target_key == schema[target]['primary_key'], 'Reference must target primary key')
                    require(value in index.get(target, {}), f'Dangling reference: {entity}.{key}')
    return index


def check_selected_rules(fixture, index):
    """A bounded subset for the sample vocabulary, explicitly not all rules.yaml."""
    records = fixture['records']
    primary_role_id = role_id(fixture, 'Primary')
    for row in records['time_entry']:
        require(row['duration_hours'] > 0, 'Nonpositive duration')
        if row.get('activity_id'):
            require(index['activity'][row['activity_id']]['case_id'] == row['case_id'],
                    'Cross-case activity')
    assignments = records['case_assignment']
    for i, row in enumerate(assignments):
        start = instant(row['assigned_at'])
        end = instant(row['ended_at']) if row.get('ended_at') else None
        require(end is None or end > start, 'Invalid assignment interval')
        for other in assignments[i + 1:]:
            if row['case_id'] != other['case_id'] or row['assignment_role_id'] != primary_role_id or other['assignment_role_id'] != primary_role_id:
                continue
            other_end = instant(other['ended_at']) if other.get('ended_at') else None
            require(not ((end is None or instant(other['assigned_at']) < end) and
                         (other_end is None or start < other_end)), 'Overlapping primary assignment')
    for row in assignments:
        events = sorted((event for event in records['case_lifecycle_event']
                         if event['case_id'] == row['case_id']),
                        key=lambda event: event['sequence_number'])
        start = instant(row['assigned_at'])
        end = instant(row['ended_at']) if row.get('ended_at') else None
        prior = [event for event in events if instant(event['effective_at']) <= start]
        require(prior and prior[-1]['resulting_status_id'] == 'sample_open',
                'Assignment starts while case is closed')
        for event in events:
            closed_at = instant(event['effective_at'])
            if event['event_type_id'] != 'sample_close' or closed_at <= start:
                continue
            require(end is not None and end <= closed_at, 'Assignment spans case closure')
            if end == closed_at:
                require(row.get('ended_by_user_account_id') == event['actor_user_account_id']
                        and row.get('end_reason') == 'Synthetic case closure',
                        'Missing closure ending evidence')
                break
    for row in records['invoice_line']:
        require(row['case_id'] == index['invoice'][row['invoice_id']]['case_id'], 'Cross-case invoice line')
        require(row['amount'] > 0, 'Nonpositive requested amount')
    for request in records['invoice']:
        lines = [r for r in records['invoice_line'] if r['invoice_id'] == request['invoice_id']]
        require(sum(Decimal(str(r['amount'])) for r in lines) == Decimal(str(request['submitted_total'])),
                'Requested total mismatch')
    for row in records['invoice_approval_decision']:
        chain = index['invoice_approval_chain'][row['invoice_approval_chain_id']]
        line = index['invoice_line'][row['invoice_line_id']]
        require(line['invoice_id'] == chain['invoice_id'], 'Cross-request review')
        require(0 <= row['approved_amount'] <= line['amount'], 'Approval exceeds request')
    for row in records['invoice_authorization_allocation']:
        request = index['invoice'][row['invoice_id']]
        authorization = index['preauthorization'][row['preauthorization_id']]
        require(request['case_id'] == authorization['case_id'], 'Cross-case authorization')
        require(request['currency_code'] == authorization['currency_code'], 'Currency mismatch')
    for row in records['invoice_allocation_decision']:
        decision = index['invoice_approval_decision'][row['invoice_approval_decision_id']]
        require(0 <= row['approved_amount'] <= decision['approved_amount'], 'Draw exceeds line approval')
    for allocation in records['invoice_authorization_allocation']:
        draws = [r['approved_amount'] for r in records['invoice_allocation_decision']
                 if r['invoice_authorization_allocation_id'] == allocation['invoice_authorization_allocation_id']]
        require(sum(draws) <= allocation['requested_amount'], 'Draw exceeds allocation')
    for request in records['invoice']:
        confirmations = [r for r in records.get('payment', []) if r['invoice_id'] == request['invoice_id']]
        require(len(confirmations) <= 1, 'Duplicate completion confirmation')
        for confirmation in confirmations:
            chain = index['invoice_approval_chain'][confirmation['invoice_approval_chain_id']]
            require(chain['invoice_id'] == request['invoice_id'], 'Cross-request confirmation')


def case_projection(events, as_of):
    effective = sorted((e for e in events if instant(e['effective_at']) <= instant(as_of)),
                       key=lambda e: e['sequence_number'])
    latest = effective[-1]
    return (latest['resulting_status_id'], effective[0]['effective_at'][:10],
            latest['effective_at'][:10] if latest['resulting_status_id'] == 'sample_closed' else None)


class ModelTests(unittest.TestCase):
    def setUp(self):
        self.model = {p.stem: load(p) for p in (ROOT / 'model').glob('*.yaml')}
        self.schema = self.model['schema']['entities']
        self.fixture = load(ROOT / 'scenarios/fixtures/review-example.yaml')

    def validate(self, fixture):
        index = validate_records(self.schema, fixture)
        check_selected_rules(fixture, index)
        return index

    def test_specification_links(self):
        for entity in self.schema.values():
            self.assertIn(entity['primary_key'], entity['fields'])
            for field in entity['fields'].values():
                if 'references' in field:
                    target, key = field['references'].split('.')
                    self.assertIn(key, self.schema[target]['fields'])
        for rule in self.model['rules']['rules'].values():
            self.assertIn(rule['applies_to'], self.schema)
        for workflow in self.model['workflows']['workflows'].values():
            self.assertIn(workflow['entity'], self.schema)
            self.assertIn(workflow['history_entity'], self.schema)
        for form in self.model['forms']['forms'].values():
            self.assertLessEqual(set(form['fields']), self.schema[form['entity']]['fields'].keys())
            for entity, inputs in form['related_inputs'].items():
                self.assertLessEqual(set(inputs['fields']), self.schema[entity]['fields'].keys())
        for document in self.model.values():
            self.assertEqual(document['spec_version'], self.fixture['spec_version'])

    def test_sample_records(self):
        self.validate(self.fixture)

    def test_duplicate_yaml_keys_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Duplicate YAML key'):
            yaml.load('case_id: first\ncase_id: second', Loader=UniqueLoader)

    def test_invalid_examples(self):
        cases = [
            ('person', 'display_name', None, 'Missing required'),
            ('case_participant', 'person_id', '00000000-0000-0000-0000-000000000000', 'Dangling reference'),
            ('case_participant', 'participant_role_id', '00000000-0000-0000-0000-000000000000', 'Dangling reference'),
            ('case', 'status_id', 'sample_closed', 'Field supplied that prepare_review.py computes'),
            ('time_entry', 'duration_hours', 0, 'Nonpositive duration'),
            ('invoice', 'submitted_total', 121, 'Requested total mismatch'),
            ('invoice_approval_decision', 'approved_amount', 999, 'Approval exceeds request'),
            ('invoice_allocation_decision', 'approved_amount', 999, 'Draw exceeds line'),
            ('preauthorization', 'currency_code', 'sample_other_currency', 'Currency mismatch'),
        ]
        for entity, field, value, error in cases:
            with self.subTest(entity=entity, field=field):
                fixture = deepcopy(self.fixture)
                fixture['records'][entity][0][field] = value
                with self.assertRaisesRegex(ValueError, error):
                    self.validate(fixture)

    def test_cross_case_links_rejected(self):
        for entity in ['activity', 'invoice_line', 'preauthorization']:
            with self.subTest(entity=entity):
                fixture = deepcopy(self.fixture)
                fixture['records'][entity][0]['case_id'] = fixture['records']['case'][1]['case_id']
                with self.assertRaisesRegex(ValueError, 'Cross-case'):
                    self.validate(fixture)

    def test_assignment_boundary(self):
        fixture = deepcopy(self.fixture)
        fixture['records']['case_assignment'][1]['assigned_at'] = '2026-01-04T10:00:00Z'
        with self.assertRaisesRegex(ValueError, 'Overlapping primary'):
            self.validate(fixture)
        self.validate(self.fixture)  # Exact end/start boundary is valid.

    def test_closure_ends_every_assignment_role(self):
        self.validate(self.fixture)
        assignments = self.fixture['records']['case_assignment']
        closure = '2026-01-10T10:00:00Z'
        ended = [row for row in assignments if row.get('ended_at') == closure]
        self.assertEqual({row['assignment_role_id'] for row in ended},
                         {role_id(self.fixture, 'Primary'), role_id(self.fixture, 'Staff')})
        for index in (1, 2):
            with self.subTest(assignment=index):
                fixture = deepcopy(self.fixture)
                # Isolate this interval so the specific closure guard is exercised.
                fixture['records']['case_assignment'] = [fixture['records']['case_assignment'][index]]
                fixture['records']['case_assignment'][0].pop('ended_at')
                with self.assertRaisesRegex(ValueError, 'Assignment spans case closure'):
                    self.validate(fixture)

    def test_reopen_requires_new_assignment(self):
        assignments = self.fixture['records']['case_assignment']
        old = assignments[:3]
        at_reopen = instant('2026-01-15T10:00:00Z')
        active_old = [row for row in old if instant(row['assigned_at']) <= at_reopen
                      and (not row.get('ended_at') or instant(row['ended_at']) > at_reopen)]
        self.assertEqual(len(active_old), self.fixture['expected']['active_assignments_after_reopen_before_reassignment'])
        self.assertNotIn(assignments[3]['case_assignment_id'], [row['case_assignment_id'] for row in old])
        as_of = instant(self.fixture['as_of'])
        active = [row for row in assignments if instant(row['assigned_at']) <= as_of
                  and (not row.get('ended_at') or instant(row['ended_at']) > as_of)]
        self.assertEqual(len(active), self.fixture['expected']['active_assignments_after_final_close'])

    def test_assignment_on_closed_case_rejected(self):
        fixture = deepcopy(self.fixture)
        fixture['records']['case_assignment'][3]['assigned_at'] = '2026-01-12T10:00:00Z'
        with self.assertRaisesRegex(ValueError, 'Assignment starts while case is closed'):
            self.validate(fixture)

    def test_closure_ending_requires_actor_and_reason(self):
        for key in ('ended_by_user_account_id', 'end_reason'):
            with self.subTest(field=key):
                fixture = deepcopy(self.fixture)
                fixture['records']['case_assignment'][1].pop(key)
                with self.assertRaisesRegex(ValueError, 'Missing closure ending evidence'):
                    self.validate(fixture)

    def test_repeated_close_reopen(self):
        records = self.fixture['records']
        case_id = records['case'][0]['case_id']
        events = [r for r in records['case_lifecycle_event'] if r['case_id'] == case_id]
        self.assertEqual(case_projection(events, '2026-01-16T00:00:00Z'),
                         ('sample_open', '2026-01-01', None))
        expected = self.fixture['expected']
        self.assertEqual(case_projection(events, self.fixture['as_of']),
                         (expected['case_a_status'], expected['case_a_opened_on'], expected['case_a_closed_on']))

    def test_requested_approved_and_authorization_balances(self):
        records = self.fixture['records']
        self.assertEqual(records['invoice'][0]['submitted_total'], self.fixture['expected']['requested_amount'])
        approved = sum(r['approved_amount'] for r in records['invoice_approval_decision'])
        self.assertEqual(approved, self.fixture['expected']['approved_amount'])
        balances = []
        for ceiling in records['preauthorization_decision']:
            allocations = {r['invoice_authorization_allocation_id'] for r in records['invoice_authorization_allocation']
                           if r['preauthorization_id'] == ceiling['preauthorization_id']}
            consumed = sum(r['approved_amount'] for r in records['invoice_allocation_decision']
                           if r['invoice_authorization_allocation_id'] in allocations)
            balances.append(ceiling['approved_amount'] - consumed)
        self.assertEqual(balances, self.fixture['expected']['authorization_balances'])

    def test_external_completion_is_separate_and_unknown_amount_stays_unknown(self):
        self.assertEqual(self.fixture['expected']['completion'], 'confirmed')
        records = self.fixture['records']
        self.assertNotIn('amount', records['payment'][0])
        self.assertNotIn('paid_on', records['payment'][0])
        fixture = deepcopy(self.fixture)
        fixture['records']['payment'] = []
        self.validate(fixture)
        self.assertEqual(fixture['records']['invoice_approval_decision'], records['invoice_approval_decision'])
        self.assertEqual(fixture['records']['invoice_allocation_decision'], records['invoice_allocation_decision'])
        fixture['records']['payment'] = records['payment'] * 2
        with self.assertRaisesRegex(ValueError, 'Duplicate ID'):
            self.validate(fixture)

    def test_duplicate_completion_with_distinct_id_rejected(self):
        fixture = deepcopy(self.fixture)
        duplicate = deepcopy(fixture['records']['payment'][0])
        duplicate['payment_id'] = '00000000-0000-4000-8000-000000000001'
        fixture['records']['payment'].append(duplicate)
        with self.assertRaisesRegex(ValueError, 'Duplicate completion confirmation'):
            self.validate(fixture)

    def test_snapshot_retains_original_payee(self):
        snapshot = self.fixture['records']['invoice_approval_chain'][0]['submission_snapshot']
        self.fixture['records']['service_provider'][0]['email'] = 'changed@example.invalid'
        self.assertEqual(snapshot['records']['service_provider'][0]['email'], 'payee@example.invalid')
        self.assertEqual(snapshot['spec_version'], self.fixture['spec_version'])
        self.assertEqual(snapshot['invoice_approval_chain_id'],
                         self.fixture['records']['invoice_approval_chain'][0]['invoice_approval_chain_id'])


if __name__ == '__main__':
    unittest.main()
