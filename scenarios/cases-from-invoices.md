# Cases added through invoices, and fixing them

Use synthetic staff, administrators, providers, cases and counties. Case numbers
and amounts are synthetic test values. Rules: `match_invoice_to_case`,
`add_case_from_request`, `correct_case_records`, `request_preauthorization`,
`record_case_county`.

1. **Found:** Case CR-24-0477 is in county A. Staff upload an invoice whose
   file gives CR-24-0477 and county A. The case is chosen without asking; on
   sending, the invoice is matched to it, keeping its sent prices, and its
   provider is assigned to the case if they weren't.
2. **Similar:** The file gives CR240477 in county A. Staff are offered
   CR-24-0477 and must say whether it is that case or a new one; sending
   without an answer is refused. Choosing it matches the invoice to CR-24-0477
   and keeps CR240477 as typed beside it. A case CR240477 in county B is
   never offered, though staff are told the same number is a case there.
3. **New:** The file gives CR-26-1312 in county B and no case has a close
   number. Staff choose to add it, giving the client's name. On sending, case
   CR-26-1312 is added in county B with that client, recording who added it and
   from which invoice. Adding CR-26-1312 in county B again is refused, offering
   the existing case; adding it in county A is allowed.
4. **Staff must answer:** Staff send an invoice with no answer to the case
   question; it is refused. A staff member's upload entered in review can't
   finish its first round until the question is answered.
5. **Work not for one case:** An attorney bills 3.0 hours of court observation
   in county C with no case number. Staff choose "not for one case" and give
   county C. It is reviewed, decided and signed off without a case, with the
   no-case warnings. It counts under county C in billing trends and by county,
   is not listed in All cases, and its possible double billing is checked
   only against the attorney's other time on the same dates. A reviewer later
   adds it to a case; it then counts under that case's county.
6. **External suggestion:** An external sender uploads a file reading
   CR-24-0477 in county A; the number is shown, read-only, and they send
   without choosing a case. It goes straight to review with no case. The
   reviewer is offered CR-24-0477 as a suggestion and matches it with one step.
   An external sender never answers the case question or types a number, so
   never adds or chooses a case of the organization's. A file with no number
   is sent the same way, and the reviewer adds the number before any case is
   found.
7. **Pre-authorization not for one case:** An attorney asks to pre-authorize 900
   for court observation in county C, not for one case. Staff approve 900; the
   decision and amount are recorded on the request, and no preauthorization or
   limit is created. A request for a case chosen or added the same way records
   a ceiling decision as before.
8. **Same case as another:** CR240477 was added by mistake and has one invoice
   in review and one signed off. An administrator in Settings, Edit data sees
   exactly what will move, then moves both invoices to CR-24-0477; the
   signed-off one keeps its approved amount and now counts under CR-24-0477's
   county. CR240477 is closed as added by mistake and leaves every list and
   picker. When both cases have a preauthorization for the same provider, the
   administrator chooses which to keep; the other stays on the closed case.
9. **Undo:** The administrator undoes that fix. Both invoices return to
   CR240477, which is open again; a value changed since the fix stays as it
   was changed. Staff who aren't administrators can't open Edit data.
10. **Corrected and taken off:** An administrator corrects a case's county; its
    invoices keep the number they were sent with. Another case's invoices are
    not for one case: taking them off leaves each with its own county and
    closes the case as added by mistake.
11. **Counties:** Staff can't choose or add a case for an invoice with no
    county; they add the county first. An invoice not for one case with no
    county is refused when sent until its county is added. A case CR-26-1500
    with no county is offered as similar for an invoice in county B; choosing
    it gives the case county B, recorded. A reviewer changes a matched
    invoice's county from its case's; the invoice is flagged in review, not
    refused. A case added as CR-26-1400 in county B while CR-26-1400 is in
    county A is listed in Edit data with the same number in county A as a
    hint; fixing it means correcting its county, then moving its invoices.
