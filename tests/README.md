# Offline model checks

These tests use the actual YAML specification and synthetic linked records in
`scenarios/fixtures/review-example.yaml`. Python 3.9+ and PyYAML 6.x are required.
If PyYAML is unavailable, install it in a local virtual environment:

```sh
python3 -m venv /tmp/case-model-tests
/tmp/case-model-tests/bin/python -m pip install -r tests/requirements.txt
/tmp/case-model-tests/bin/python -B -m unittest discover -s tests -v
```

With the dependency already available, run from the repository root:

```sh
python3 -B -m unittest discover -s tests -v
```

No sign-in, deployment, external service or payment action is involved.

## Coverage

| Layer | Checked now | Not established by these tests |
| --- | --- | --- |
| Specification structure | Duplicate YAML keys, schema references, form fields, rule/workflow targets and version consistency | Complete formal validation of every metadata property |
| Sample records | Required source fields, types, IDs, foreign keys, sample lookups; reject values supplied for fields prepare_review.py computes | Every entity populated or every business rule exercised |
| Selected domain examples | Cross-case links, primary assignment overlap, closure ending all roles, new assignments after reopening, requested/approved amounts, reviewer identity, authorization allocation limits, duplicate completion | General executable rules engine, all configured roles and transition policies |
| Calculations | Repeated close/reopen projection, final approval total, authorization balances independent of completion | Correction replay, all review chains, superseded attempts or historical reporting policies |
| Snapshots | Independent retained payee values and snapshot identity/version | Runtime immutability, storage retention, signatures or document retrieval |
| External completion | Unknown date/amount remain absent; removing confirmation leaves approvals and draws intact | Integration behavior, reconciliation, actual payment execution |

The helpers deliberately interpret only the sample vocabulary and one final
line-review step. They are test code, not an implementation to reuse as an API or
full interpreter for `rules.yaml`. Invalid cases are mutations of the valid fixture,
so they stay linked to the same schema instead of maintaining a second model.

## Next testing stages

1. Review the examples with product/domain stakeholders: are the relationships,
   history and approval/completion states understandable? Extend fixtures when a
   concrete scenario or decision is added.
2. Use the Dataverse schema-review commands to load the records into the existing
   app and inspect related lists/forms. Implement runtime workflows next; the
   0.1 guided baseline cannot deploy the expanded slice.
3. Map these records into that implementation and exercise `scenarios/new-case.md`,
   `scenarios/case-history.md` and `scenarios/payment-request.md` through both forms
   and alternate write paths.
4. Verify server-side permissions, immutable evidence, atomic multi-record intake,
   concurrent authorization spending, and absence of payment initiation in the
   real implementation. Offline fixture checks cannot prove these properties.

Record actual platform results separately from offline checks. Passing this suite
is useful feedback on the model, not a claim of 0.2 application conformance.
