"""Check the boundaries of the synthetic Dataverse review package."""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('prepare_review', ROOT / 'implementations/dataverse/prepare_review.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DataverseReviewTests(unittest.TestCase):
    def test_all_packaged_lookups_resolve(self):
        package = module.prepare()
        tables = {table['Key']: table for table in package['Tables']}
        rows = {(row['Table'], row['Id']) for row in package['Rows']}
        self.assertEqual(len(rows), len(package['Rows']))
        for row in package['Rows']:
            fields = {field['Key']: field for field in tables[row['Table']]['Fields']}
            for key, value in row['Values'].items():
                field = fields[key]
                if field['Type'] == 'lookup' and value is not None:
                    self.assertIn((field['Target'], value), rows)

    def test_external_unknowns_and_snapshots_survive_preparation(self):
        package = module.prepare()
        confirmation = next(row for row in package['Rows'] if row['Table'] == 'payment')
        self.assertNotIn('amount', confirmation['Values'])
        self.assertNotIn('paid_on', confirmation['Values'])
        chain = next(row for row in package['Rows'] if row['Table'] == 'invoice_approval_chain')
        snapshot = json.loads(chain['Values']['submission_snapshot'])
        self.assertEqual(snapshot['invoice_approval_chain_id'], chain['Id'])
        self.assertEqual(snapshot['records']['invoice'][0]['submitted_total'], 120)

    def test_client_projection_matches_participant_person(self):
        package = module.prepare()
        cases = [row for row in package['Rows'] if row['Table'] == 'case']
        client_participant = next(row for row in package['Rows']
                                  if row['Table'] == 'case_participant' and row['Id'] == 'ee3bb088-5e95-5045-aa69-37ff4d950757')
        self.assertEqual(cases[0]['Values']['client_id'], client_participant['Values']['person_id'])
        self.assertIsNone(cases[1]['Values']['client_id'])

    def test_closed_case_assignments_are_inactive_in_review(self):
        package = module.prepare()
        assignments = [row for row in package['Rows'] if row['Table'] == 'case_assignment']
        self.assertEqual(len(assignments), 4)
        self.assertTrue(all(row['NativeInactive'] for row in assignments))
        self.assertTrue(all(row['Values']['ended_at'] for row in assignments))

    def test_canonical_ids_and_legacy_table_names_are_retained(self):
        package = module.prepare()
        keys = {table['Key'] for table in package['Tables']}
        self.assertIn('case_status', keys)
        self.assertIn('case_category', keys)
        self.assertIn(('case', 'a760d290-6f10-5a88-bf3f-27c7c64630f5'),
                      {(row['Table'], row['Id']) for row in package['Rows']})
        self.assertEqual(module.prepare(), package)


if __name__ == '__main__':
    unittest.main()
