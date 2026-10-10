# Supporting invoice import and export plan

Payees often keep billing in their own practice-management tools and can
produce a supporting invoice faster than they can re-enter it. This plan adds
upload of those invoices as draft payment requests, a submitter view of what
they submitted, and export of submitted requests. The canonical contract is in
`model/` (see "Supporting invoice import and export" in `model/README.md`);
acceptance scenarios are in `scenarios/invoice-import-export.md`.

## Source formats

| Format | Characteristics | Handling |
| --- | --- | --- |
| LEDES 1998B | Pipe-delimited legal billing exchange standard, one row per line item with date, timekeeper, hours, rate, amount and optional UTBMS task/activity/expense codes | Parse directly |
| LEDES 1998BI / XML 2.x | Richer international and XML variants | Parse directly once needed |
| Delimited text or spreadsheet | Tool-specific columns | Parse against a published template; map other layouts deliberately |
| Digitally generated PDF | Tool- or user-specific layout with a text layer | Extraction |
| Scanned PDF or fixed government voucher form | No text layer; voucher forms have a fixed layout | OCR plus extraction |

Most practice-management tools can export LEDES 1998B, so structured upload
should be offered first. It is exact and needs no extraction service.

## Extraction approach

Training a custom model is not justified: it needs a large labelled corpus per
layout and ongoing maintenance. Layout rules over a text-layer library work only
for known layouts and fail on scans. Pretrained document extraction services and
large language models with a fixed output schema both handle unseen layouts
without training. Whichever is used, the result is a proposal checked
arithmetically and confirmed by the submitter against the original file.

Extraction sits behind one interface (document in, candidate request with
confidences and warnings out) so methods can be compared on the same synthetic
corpus. For building and evaluating, third-party services may be used with
synthetic files only. Production extraction must run within the system's own
processing boundary, which includes the organization's own cloud account.

## Decisions

- Billing staff may export any submitted request; submitters only their own.
- Third-party extraction is acceptable during development with synthetic data;
  live processing stays within the system boundary, which includes services in
  the organization's own cloud account. Adding any new cloud AI service needs a
  cost review first.
- Uploaded files are not retained. Confirming or discarding an import deletes
  the file content, keeping metadata, hash and the extraction result; the
  confirmed draft and its submission snapshot become the record. Reviewers and
  exports never see the original.
- Submitters may edit a draft until they submit it, recall a submission before
  any review decision, and start over by withdrawing the draft and uploading
  again.
- Imported time lines create time entries and expense lines create expenses on
  submission, attributed to the professional the submitter matched each
  timekeeper to. Unmatched timekeepers block confirmation; no people are created
  from labels.
- A configured delegate role lets office support staff upload, edit, recall and
  submit for professionals in their office who are assigned to the case. The
  represented professionals do not approve or attest, but can see and export
  those requests.
- Exports are not audited.
- Recall is allowed only before the first review decision.
- Unresolved imports expire three days after upload.
- Build in `implementations/postgres-aws/`; document the Dataverse mapping and
  gaps only.

## Phases

1. **Specification:** schema, rules, workflow, scenarios and fixture checks.
2. **Export and submitter view:** document and spreadsheet export of a
   submission attempt; portal detail view with lines, status and decisions;
   draft editing, recall before review and withdrawal; delegate accounts and
   role.
3. **Structured import:** LEDES 1998B and template spreadsheet upload, draft
   review, timekeeper matching and confirmation with file deletion, submit with
   time-entry creation and duplicate warnings.
4. **Design review:** review the invoice and billing screens end to end:
   submitter and delegate portal (case invoices, draft editing, import review,
   invoice detail, recall and export) and staff billing queue and review.
   Cover layout, wording, error and empty states, accessibility and the line
   editor's density, then fix what the review finds before adding more
   screens.
5. **Document import:** first generate the synthetic PDF corpus in
   `scenarios/fixtures/invoices/` (itemized, UTBMS-coded, summary-only, voucher
   style, multi-page and scanned-looking layouts, each with expected values),
   then build the extraction interface, a development extractor,
   reconciliation warnings and side-by-side review on the existing temporary
   file storage. Measure accuracy and cost on a synthetic
   corpus, and complete a cost review, before choosing an in-boundary method.

   Status: the corpus (five digital layouts), the extraction interface, an
   accuracy harness and an in-app text-layer extractor are in place in the
   Postgres/AWS prototype; it reads 99.4% of the corpus's fields at no
   cost, but the corpus was made for the purpose and has no scans.
   Published practice-management invoice templates (blank, tried locally
   and kept outside Git) showed separate time and expense tables, initials
   columns, right-aligned amounts and stacked cells; those patterns are now
   in the corpus and handled. Next: filled-in exports from product trial
   accounts, tried locally the same way.
6. **Side-by-side review:** show the original document beside the import
   review instead of only as a download. Status: done in the Postgres/AWS
   prototype (PDF pages drawn in the browser, text and spreadsheets shown
   as-is, items linked to their PDF page).

### Future work

- Scanned invoices: a scanned-looking sample and OCR. Open, not scheduled.
- A cloud AI extraction method in the organization's own account, compared
  on the same corpus after a cost review. Paused while heuristics and
  existing libraries are tried first.

## Upload defaults

Document storage is a short-lived conversion area, not a record store. These
are starting defaults for implementations to configure, not policy values:

- One file per import, at most 10 MB and 50 pages.
- Accepted: PDF, LEDES 1998B text, CSV and XLSX, verified from content.
  Encrypted, password-protected, macro-enabled and malformed files are rejected.
- Malware scan within the processing boundary before parsing; a detection or
  scan failure rejects the file.
- Parsing runs isolated with time and memory limits and never executes
  embedded content.
- Private storage, encrypted at rest, with no public or long-lived links,
  excluded from versioning and backups so that deletion is final.
- Content deleted on confirm or discard, or three days after upload at most.

## Test material

Do not commit vendor sample invoices, real invoices or files that identify a
product in use. Generate synthetic invoices from one source dataset into several
layouts (itemized, coded, summary-only, voucher style, multi-page, scanned) and
the matching structured formats, with expected extraction results for each.
Files exported from vendor trial accounts using synthetic data may be used for
local spot checks only and stay outside Git.

The structured samples exist in `scenarios/fixtures/invoices/` with their
expected results; synthetic PDF layouts are added there in phase 5.

## Open questions

- Which in-boundary extraction method meets accuracy and cost needs: whether
  the free text-layer reader is enough on real exports, or scans and unusual
  layouts justify a cloud AI method (and its cost review).
- Correction after external payment completion, as for any payment request.
