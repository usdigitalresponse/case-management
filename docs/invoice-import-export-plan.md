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
- Files that couldn't be read expire three days after upload; drafts read
  from a file don't expire (changed from expiring every unresolved import).
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

   Scans: a PDF with no text layer is now read by in-process text
   recognition (Tesseract via tesseract.js, with table rules erased first)
   and the same table reader. Real scanned invoices tried locally and kept
   outside Git showed borderless tables, a column with no heading, headings
   only on the first page with page subtotals, dates inside descriptions,
   attached receipts and maps, letter-style invoices with no table, and
   reviewers' handwritten marks. The recognition itself read 97–100% of
   printed amounts with every free engine tried (Tesseract, PaddleOCR,
   docTR); losses came from the table reader, which now handles those
   patterns except handwriting: letter-style items written as sentences
   are read, attachments after the amount due are left out of the total,
   and a recognized item whose quantity × rate doesn't make its amount is
   repaired when one explanation fits (a dropped decimal point, say), with
   a warning; page-number lines and margin notes read without confidence
   aren't taken for items. On those scans it found 99% of items (2 extra
   lines, both scribbled-over figures) with 97% of quantities, 97% of rates
   and every date, and six of the seven files added up to their stated
   totals (up from 86%, 80%, 85% and two). It flags
   low-confidence figures, page subtotals and totals that
   don't add up. "Searchable" scans, whose invisible text another program
   recognized, are detected from their drawing operators and recognized
   again: read from that hidden text, the same scans gave 76% of items and
   31% of quantities, and three were refused. Three synthetic scans are in
   the corpus, one of them searchable.
6. **Side-by-side review:** show the original document beside the import
   review instead of only as a download. Status: done in the Postgres/AWS
   prototype (PDF pages drawn in the browser, text and spreadsheets shown
   as-is, items linked to their PDF page).

### Future work

- Unusual layouts and handwriting: a self-hosted vision language model
  (Qwen2.5-VL 7B through the Ollama API, fixed output schema) was tried
  as a follow-up pass for files whose first reading didn't add up. On the
  same real scans the combined pipeline found 99% of items with 95% of
  quantities and 98% of rates, and six of the seven files added up, but at
  about 45 seconds a page on a laptop processor; it needs a GPU host or a
  much larger server than the 1 GB demo, so it was removed rather than
  kept unused. Other CPU engines that fit the demo server (RapidOCR,
  docTR, OCRmyPDF, Table Transformer) did no better than Tesseract with
  the table reader. Reconsider a model only with its hosting cost agreed,
  a licence review, and evidence of how often files need it.
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
- Content deleted on discard, or three days after upload if it couldn't be
  read; a draft read from a file doesn't expire, and a confirmed file is kept
  with its request until the request is withdrawn, deleted or recorded as
  paid (changed for the submission design, so the submitter and reviewers see
  the file beside the lines).

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
  the free text-layer and recognition reader is enough on real files, or
  unusual layouts justify an AI method (self-hosted, or cloud after a cost
  review).
- Whether staff upload copies already marked up by reviewers. Import uses the
  printed figures and flags low-confidence ones; it never reads handwritten
  corrections.
- Correction after external payment completion, as for any payment request.
