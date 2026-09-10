# Synthetic model examples

[review-example.yaml](review-example.yaml) is a portable, linked dataset for
reviewing the 0.2 model. It is not a Dataverse import file or production seed data.
All names, identifiers, vocabulary and amounts are synthetic. `XXX` is a test-only
currency marker. IDs are stable UUIDs; emails use the reserved `example.invalid`
domain. No real contacts, documents or source research are included.

The fixture contains:

- Two cases sharing one person in different participant roles, with no account
  required for that contact.
- Professional/account profiles, organization/office affiliations, and a primary
  assignment handoff at an exact end/start boundary. Closing ends the primary
  and concurrent staff assignment; a new assignment after reopening also ends
  at the second closure.
- Two issues, an external case identifier, and an open/close/reopen/close sequence.
- An activity-linked time entry and an independent time entry.
- One payment request for 120 with two lines, approved for 100, drawing 60 and 40
  against two authorizations with ceilings of 100. Remaining balances are 40 and
  60 even after external payment completion is reported.
- A supporting invoice reference, synthetic attestation, and frozen submission
  snapshot. No document attachment or electronic signature assurance is claimed.
- External completion confirmation with a source and recording actor/time. Actual
  payment amount and date are unknown and deliberately omitted.

`reference_data` declares only the sample values used by this dataset; these are
not canonical enums or policy defaults. `records` contains source records and
snapshots. Fields that `prepare_review.py` computes from event/participant/
affiliation history are omitted (see "Deferred: fields that should become read
models" in `model/README.md`), and selected expected results are in
`expected`. Calculations use the explicit `as_of` timestamp and UTC for these
examples. The snapshot's nested `records` layout is a test-owned encoding of the
contract, not a required platform storage format.

Run the checks from the repository root:

```sh
python3 -B -m unittest discover -s tests -v
```

See [the test guide](../../tests/README.md) for dependencies and coverage limits.
