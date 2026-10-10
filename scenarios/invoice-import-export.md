# Supporting invoice import and export

These platform-neutral scenarios apply to `invoice_import`, the
`invoice_import` and `payment_request` workflows and the import/export rules in
`model/rules.yaml`. Use synthetic payees, cases, files and amounts only. No
implementation has passed these scenarios yet.

1. **Structured file:** An external submitter with an active assignment uploads
   a synthetic standard legal billing exchange file with three time lines and one
   flat-fee line for that case. The file is stored as a document with its hash
   until the import is confirmed or discarded. Parsing records the method and version and creates one draft
   request whose lines carry the stated date, description, hours, rate, codes and
   amount. Nothing is submitted.
2. **Free-form document:** Upload a synthetic PDF invoice with the same content.
   Extraction proposes the same draft, recording confidence for each value. The
   submitter sees the original file beside the draft, corrects one description
   and confirms. The file content is deleted and `content_deleted_at` is set;
   its metadata and hash remain. The extraction result keeps the original
   extracted value; the draft holds the corrected value.
3. **Edit, recall and start over:** After confirming, the submitter edits a
   line amount in the draft and submits; the original file is no longer
   available. Before any review decision they recall the submission: the
   request returns to draft, the recalled attempt's snapshot is preserved, and
   they edit and resubmit. Recall after a review decision is blocked. Instead of
   resubmitting, they may withdraw the draft and upload a new file, which
   creates a new import and request. Until a reviewer records a decision, a draft
   or withdrawn request can be deleted outright, including the recalled draft
   above with its earlier attempt, its import and file, and the time entries
   its import created that no other request uses.
4. **Reconciliation warnings:** Upload files whose stated total differs from the
   sum of lines, whose hours times rate differs from a line amount, and whose
   service date is outside the billing period. Each discrepancy is shown beside
   the source value. The request total is calculated from lines; the stated total
   is never trusted.
5. **Duplicates:** Upload the same file again, even after the first file's
   content was deleted, then a different file with a supporting invoice number
   already submitted by the same payee. Both warn and show the earlier record;
   nothing is merged or discarded automatically.
6. **Time entries:** Before confirming, the submitter matches each timekeeper
   label to an existing professional assigned to the case on that line's
   service date; one unmatched label blocks confirmation, and a label matching
   no professional creates nobody. A match from an earlier upload by the same
   payee is suggested but must be confirmed. The submitter classifies each line
   as time, expense or other. On submission, each time line with a date and
   hours creates one time entry for its matched professional, and each expense
   line creates one expense with a configured type, both linked from the line
   and to the import. A line matching an existing expense for the same case,
   date, type and amount warns like a duplicate time entry. A line matching an existing entry for
   the same professional, case, date and hours warns, and the submitter may link
   the existing entry instead. Discarding an import or withdrawing its draft
   creates no time entries or expenses.
7. **Access:** A submitter cannot upload for a case without an active
   assignment, and cannot view or export another payee's imports or requests.
   Selecting a case on upload or extracting a case reference grants no access.
8. **Delegate:** A support-staff user with a configured delegate role in an
   office, and no professional profile, uploads an invoice covering two
   professionals in that office who are assigned to the case. They match both
   timekeepers, confirm and submit; the request records the delegate as
   submitter, and each time entry belongs to its professional. The same user
   is blocked for a professional in another office, for a professional not
   assigned to the case, and after their delegate affiliation ends. Another
   member of the office without the delegate role is blocked. Neither
   professional is asked to attest or approve; both can see and export the
   request, and a third professional in the office cannot.
9. **Failure, discard and expiry:** An unreadable file moves the import to
   failed and keeps the file until the submitter discards it. Discarding records
   actor and time, deletes the file content and keeps metadata and any result.
   An import left unconfirmed for three days expires with no resolving user: its
   file is deleted and its unconfirmed draft withdrawn. Files of an unaccepted
   type, over the configured size or page limit, encrypted, macro-enabled or
   flagged by the malware scan are rejected before parsing.
10. **Processing boundary:** In a production configuration, extraction cannot
    be routed to a service outside the organization's own cloud account. A
    development configuration using such a service accepts only synthetic files.
11. **Submitter view:** A submitter or represented professional lists their
    requests and opens one to see submitted lines, current status and line
    decisions with reasons. No original file is offered.
12. **Export:** Billing staff export any submitted request; a submitter or
    represented professional exports only their own. Exports create no audit
    events. Document and spreadsheet exports contain the same values from one
    identified submission attempt, its status and decisions, and the export
    time. After a revision, exporting the earlier attempt still shows its
    original values.

An implementation must document unenforced boundaries, unavailable formats and
non-atomic time-entry or expense creation as gaps before claiming parity.
