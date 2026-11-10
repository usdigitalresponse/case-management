# Preauthorization requests, limits and overruns

Use synthetic providers, cases and counties. Amounts below are synthetic test
values, not configuration defaults. Rules: `request_preauthorization`,
`apply_preauthorization_limit`, `explain_preauthorization_overrun`,
`request_provider_documents`, `report_preauthorization_usage`.

1. **Threshold:** An administrator sets a default threshold of 1,000 and, for
   county B, 1,500 from a later date. A case in county A has limit 1,000 for an
   investigator; a case in county B has 1,000 before that date and 1,500 from
   it. Earlier thresholds stay listed. The appointed attorney's own fees have no
   threshold.
2. **Not needed:** An attorney starts a request for an investigator at 50 an
   hour for 15 hours (750) on a county A case. Before sending they are told the
   total is within the threshold. They send it anyway; it gets the next number.
   Staff mark it not needed with a reason the attorney sees. Nothing is
   pre-authorized.
3. **Information and approval:** The attorney asks for 2,400 for an expert at a
   flat fee. The expert has no CV on file, so the request asks for it; it is
   sent without it, marked as missing it. Staff ask why the work is needed; the
   request waits until the attorney answers, then staff approve 2,000. The
   expert's limit on the case is now 2,000, from an approved preauthorization
   with one decision. The question and answer are never changed.
4. **More:** The expert has 1,800 approved on the case. The attorney asks for a
   total of 3,000. Approving it records a revised decision with ceiling 3,000
   on the same preauthorization; the limit is 3,000, not 5,000. Approving a
   total of 1,500 is refused, since 1,800 is already approved.
5. **Overrun:** With 2,900 approved and nothing waiting, a request for 300 for
   the expert is sent. Before sending, the submitter is shown the limit 3,000
   and total 3,200 and must explain; sending without an explanation is refused.
   The reviewer sees the overrun and the explanation and approves it. The
   explanation does not appear in the export.
6. **Matched later:** A request filed with no case is matched to a case where
   it takes its provider over the limit. It is flagged with no explanation, and
   the reviewer asks for one with a review question.
7. **Withdrawn, duplicate, moot:** A request withdrawn by the attorney, one
   marked duplicate and one marked moot because the work was done are kept with
   their numbers and reasons; none changes a limit, and asking again is a new
   request.
8. **Usage by county:** For the period, county A shows its threshold, requests
   by status, amounts asked for and approved, billed (approved and waiting),
   left, providers over their limit with the amount over and how many lack an
   explanation, and providers billing within the threshold without a
   preauthorization. Each count opens the matching requests or cases.
