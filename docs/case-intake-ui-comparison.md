# New case intake: standard form, Power Fx and React

This worksheet records the three-interface experiment described in the
[comparison plan](case-intake-comparison-plan.md). All three use the same Dataverse
backend, intake contract and acceptance scenarios. Shared backend effort and
failures must be recorded separately from UI-specific findings.

**Status: not yet run.** The existing standard case form is a read-only review
artifact; neither the Power Fx Custom Page nor React intake has been built.
The shared transactional intake operation is also not implemented. The plan
supersedes the earlier sequential-write Custom Page experiment.

## Walkthrough prerequisites

The deployed review forms have disabled controls. Confirm an editable intake
form is available before comparing data entry; the presence of a deployed case
form alone does not establish a working intake journey. Previously deployed
command-hiding customizations may also remain even when the server-side review
guard is disabled. Verify the actual entry points in a fresh app session.

## Scenario results

| # | Scenario | Standard form | Power Fx Custom Page | React | Scope / evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Minimum case | Not run | Not run | Not run | Include atomicity and trusted actor evidence |
| 2 | Required input blocking | Not run | Not run | Not run | Verify UI feedback and server enforcement |
| 3 | Complete intake with identifier | Not run | Not run | Not run | Check relationships and time-zone handling |
| 4 | Person reuse | Not run | Not run | Not run | Intake reuse in scope; later role/participant edits are follow-on checks |
| 5 | Identifier-change history/audit | Not run | Not run | Not run | Follow-on backend check; no change UI in this slice |
| 6 | Duplicate review flagging | Not applicable | Not applicable | Not applicable | Person creation is outside this journey |
| — | Failure, retry and permission checks | Not run | Not run | Not run | Use the comparison plan's shared test cases |

Result values: **Pass** / **Fail** / **Blocked by known gap** (cite the gap) / **Not applicable** (explain scope).

Record successful UI steps separately from full acceptance results. A happy-path
save cannot establish atomicity, trusted audit facts or history protection.
Exercise the failure checks in the Custom Page recipe before usability testing.

## Comparison dimensions

(`docs/architecture-assessment.md`'s comparison methodology, applied here at
UI-choice scale rather than platform scale.)

### Development effort

Not yet assessed.

### Task success / usability

Not yet assessed.

### Performance

Not yet assessed.

### Deployment effort

Not yet assessed.

### Operating cost

Not yet assessed.

### Customization effort

Not yet assessed.

### Maintainability

Not yet assessed.

## Recommendation

Not yet drafted — pending scenario walkthroughs and dimension writeup above.
See `docs/DECISIONS.md` for the candidate entry once this is complete; that
entry is a recommendation for user sign-off, not a unilateral change to the
"Standard forms and views" default.
