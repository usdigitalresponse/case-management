# API and sign-in design notes

How the server's routes, sign-in and billing behaviour are built and why. See
also [`frontend.md`](frontend.md), [`intake.md`](intake.md) and
[`../MAPPING.md`](../MAPPING.md) for schema mapping and known gaps.

- **Session**: `cookie-session` (signed cookie, no server-side session
  store — the small `AuthenticatedUser` object lives entirely in the
  cookie). Passport is used only for the OIDC handshake (`session:
  false`); the callback route writes the session itself
  (`src/auth/session.ts`), rather than using `passport.session()` /
  serialize-deserialize, avoiding known compatibility rough edges between
  newer Passport versions and non-`express-session` stores.
- **Multi-IdP SSO**: one generic OIDC strategy (`passport-openidconnect`),
  registered once per configured provider, rather than a
  provider-specific library per IdP (`src/auth/oidcProviders.ts`). Google
  and Microsoft Entra ID both authenticate through the same code path;
  each provider declares its own `allowedDomains` (checked against the
  authenticated email, not the OAuth `hd`/`tid` claim, which isn't always
  present) so a domain can't sign in through the wrong IdP — see "Known
  gaps" below for what this gate is (and isn't). `GET /auth/providers`
  returns `{ providers, demoLoginEnabled, externalDemoLoginEnabled }` —
  `providers` so the client doesn't hardcode one, the two flags so the
  login page only offers each demo sign-in where the server allows it
  (see "Demo sign-in" below);
  `GET /auth/:providerId` / `:providerId/callback` are generated per
  provider. `AuthenticatedUser.authType` is `'sso'` for any configured
  provider (which one is in `ssoProvider`, display/audit only) or
  `'email-code'` for an external user (`'magic-link'` before sign-in moved
  to emailed codes; such sessions sign in again). **Deploy note**: the session cookie
  carries this shape directly (`cookie-session`, no server-side store —
  see "Session" above), so a cookie issued before this change (`authType:
  'google'`, or the dev-login/magic-link literals before they were
  renamed to `'sso'`) won't satisfy `requireFullUser`'s `authType ===
  'sso'` check until the holder logs in again. Self-heals within
  `maxAge` (24h, `src/app.ts`) with no code needed — not yet a concern
  since no real environment has live sessions (see "Known gaps" in `../MAPPING.md`),
  but worth remembering before any future session-shape change ships to
  a deployment with real users.
- **Emailed-code sign-in for external users**: `POST /auth/code/request`
  (body: `{ email }`) emails a 6-digit code (`src/auth/signInCode.ts`) if
  an administrator turned on sign-in for the external user with that email
  in Settings → External users (`src/auth/externalSignIn.ts`) — it responds
  identically either way, so the endpoint can't be used to find out who may
  sign in.
  The code works once, for 10 minutes; a new request stops earlier codes
  working, and it allows 5 tries, each counted before the code is compared
  so tries sent at once can't exceed it. Both routes are rate-limited in
  the server process (`src/auth/rateLimit.ts`): codes per email and per
  address an hour, and tries per address; enough for the single server
  instance, but several would need a shared store. Only a keyed hash
  (HMAC with `SESSION_SECRET`) is stored, in `sign_in_code`. `POST
  /auth/code/verify` (body: `{ email, code }`) rechecks that sign-in is on,
  consumes the code, creates/reuses the `user_account` (linking it to their
  person, through which delegation is read), bootstraps a
  `professional` profile for it (`src/professionals/ensureProfessional.ts`),
  and sets the session, which lasts 24 hours. A code typed in, unlike a
  link, can't be consumed by an email link scanner. The client's code
  screens are `client/src/portal/CodeSignIn.tsx`, at `/submit` (the
  portal's own sign-in page) and in the shared login page's external
  panel. Open question: whether sending an invoice should ask for a fresh
  code; today the sign-in code is enough.
  `requireFullUser` (`src/auth/session.ts`) checks `authType === 'sso'`
  to gate actions only a full user may take.
  **Email delivery**: `src/email/sendEmail.ts` sends via AWS SES when
  `SES_SENDER_EMAIL` is set, falling back to logging the link to the
  console when it isn't (so local dev needs no AWS setup). Verifying a
  sender identity in SES is a manual AWS console/DNS step this code can't
  do for you — same category of manual prerequisite as filling in real
  Google OAuth credentials (see "Known gaps" in `../MAPPING.md`).
- **Case assignment, two workflows**: `professional` and `case_assignment`
  map the canonical entities, with two assignment endpoints built on a
  shared insert (`src/cases/assignProfessionalToCase.ts`, which rejects
  closed cases and recovers from a double-click/retry hitting
  `case_assignment_open_unique` rather than creating a second open
  assignment):
  - `POST /api/cases/:id/external-assignments` (`requireFullUser`,
    `src/cases/assignExternalSubmitterToCase.ts`) assigns an existing
    professional (found via `GET /api/professionals?q=<email>`, which only
    finds professionals with a `user_account_id` — i.e. someone who has
    signed in with an emailed code at least once) to a case, with a fixed
    "External Submitter" role (`src/professionals/externalSubmitterRole.ts`).
    A staff member's professional profile is rejected; staff go through
    the staff endpoint below.
  - `POST /api/cases/:id/staff-assignments` (`requireFullUser`,
    `src/cases/assignStaffToCase.ts`) assigns a staff (SSO) user, found
    via `GET /api/staff?q=<email>` (`src/routes/staff.ts`), with a fixed
    "Assigned Staff" role (`src/cases/staffAssignmentRole.ts`). Staff has
    no professional profile until their first assignment (unlike a
    vendor's, bootstrapped at emailed-code login), so one is lazily created
    here. "Staff" means a user_account whose `system_role_id` is a staff
    role (`src/auth/staffAccountRole.ts`), set by the SSO verify callback
    (`src/auth/oidcProviders.ts`) on any account that has no role yet —
    including one first created by an emailed-code sign-in — and never replaced once
    set. For now that first role is "Administrator", so testers can try
    every view; "Staff" is the intended default. Emailed-code login never sets it, which is how the
    two populations stay distinguishable in the same `user_account`
    table. Emails are lowercased (`normalizeEmail` in
    `src/auth/emailLists.ts`) before being stored or matched.

  Both roles above are provisioned the same way in every environment by
  `src/db/ensureReferenceData.ts`, run at `migrate` time (see "Reference
  data" below). `GET /api/my-cases` lists the current session's open
  assignments; `GET /api/cases/:id` includes an `assignments` array (both
  kinds, joined with professional/role display names) and a computed
  `stage` (`src/cases/caseStage.ts` — needs-assignment / represented /
  billing / closing / none-if-closed, derived from its invoices and
  whether a reviewer has each one, rather than stored). Deliberately not implemented:
  `require_qualification_for_assignment` and
  `review_workload_before_assignment` (both `model/rules.yaml`
  `outcome: configurable`) and the "at most one overlapping primary
  assignment per case" rule — every assignment of a given kind uses the
  one fixed role for that kind, with no further role choice. Possible
  duplicate people are found and merged separately (see "Possible duplicate
  people" below).
- **Invoice review** works in rounds, then sign-off (`model/rules.yaml`
  `decide_invoice_lines`, `assign_invoice_review`,
  `enforce_invoice_approval_sequence`; `src/billing/reviewInvoiceLine.ts`,
  `reviewRounds.ts`, `reviewAssignment.ts`, `reviewQueue.ts`,
  `src/routes/invoices.ts`, `client/src/pages/InvoiceReview.tsx`):
  - `GET /api/invoices?view=open|finished|lines_decided|all` is the queue,
    a batch at a time (see Long lists): case number, client, who submitted
    it, lines decided, who holds it (the reviewer, or the next approver while
    it waits for sign-off), working days waited (`workingDays.ts`, weekends
    skipped, no holiday calendar yet) and flags (rate differs from the
    configured rate, a stated amount that doesn't add up, billing rule
    findings). It never includes drafts. `show`, `sort`, `county`, `q`,
    `professionalId`, `caseId` and `day` filter and order it
    (`src/billing/reviewQueueBatches.ts`, with the derived columns in SQL in
    `queueSql.ts`); `counts` names the filters whose counts the first
    batch's summary carries. `GET /api/invoices/counts` is the sidebar's.
  - `PUT|DELETE /api/invoices/:id/lines/:lineId/decision` sets or undoes a
    working decision (`invoice_line_working_decision`): approve, approve
    in part (corrected hours or rate on a line with hours, otherwise the
    amount) or reject; partial and reject need an active
    `invoice_decision_reasons` code, and "other" a note. Working decisions
    are not audited. The first one moves the invoice to `under_review`,
    which ends recall. `POST .../reprice` approves in part, at the
    rate limit (a case rate, else the pre-authorized rate, else the
    configured rate), every undecided time line billed above it.
  - Case rates (`set_case_rate`; `src/billing/caseRates.ts`,
    `defaultRates.ts`, migration `0035`): `POST .../lines/:lineId/rate`
    approves the undecided matching lines (same person, same type of rate)
    at a changed rate, or adds a `case_rate` row for the person or their
    kind from a date and approves the lines on this invoice it governs.
    The Rate panel offers both once the rate changed
    (`client/src/components/lineReview/DecisionPanel.tsx`), and "Return to the configured
    rate instead" stores a row with no rate. Pricing (`priceLines.ts`) takes
    each line's default from `defaultRates.ts` and records
    `invoice_line.rate_source` and `case_rate_id`. A case rate changes only
    the invoice it was set on; others on the case list it under
    `caseRatesChangedSinceSent`. Concurrent changes are refused when the
    page's `basedOnCaseRateId` isn't the latest, under a row lock on the
    case. The invoice shows the case's rates and, for sign-off, those set
    on it; the case page lists them all (`client/src/components/CaseRates.tsx`).
    Case rate reasons are `invoice_decision_reasons` with `applies_to`
    `case_rate` ("other" is on every list); the model's
    `case_rate.reason_code_id` is `reason_id` here. Gaps: case rates can
    only be set on invoices with a case, which demo invoices filed by person
    don't have; and "the matching lines" are worked out on the page and
    again on the server, so the page's total can differ if lines changed.
  - `POST .../finish` (any staff member) needs a decision on every line and
    at least one sign-off approver; it records the round as
    `invoice_approval_decision` rows at the next sequence number, each line
    under whoever decided it (the `review_finished` event records who
    finished), and moves the invoice to `awaiting_sign_off`. It is refused
    when the deciders, the finisher and the sign-off approvers are one
    person; the last sign-off or a rejection checks the same again
    (`roundParticipants` in `src/billing/reviewRounds.ts`).
    `POST .../reopen` (any staff member, before any sign-off) copies the
    round back into working decisions. `POST .../sign-off` takes
    `approved`, `rejected` or `changes_requested` (which needs one) with a
    comment. Only a send-back's is `internal_only`; an approval's or
    rejection's is shown to the submitter on the portal invoice page, as
    line notes are (without who made it), and exported as "Decision
    comment". Comments recorded before this change stay internal; approvers sign in position order and
    the last one approves the invoice, while a rejection rejects it at once
    with nothing approved (`approvedTotal` is zero). A send-back reopens review for the
    same reviewer in the same chain. A rejected line counts as decided
    with nothing approved; it no longer rejects the invoice.
  - Questions (`ask_review_question`; `src/billing/reviewQuestions.ts`,
    `client/src/components/ReviewQuestions.tsx`): `POST .../questions` (the
    reviewer, taking an unassigned invoice) asks the submitter a question of
    up to 500 characters about one line ("Ask [the submitter, or whom it is
    from when staff entered it] about this line", under the line and its
    questions, not with the decision buttons), stored as
    `invoice_review_question`. While lines are being entered, each line's
    date, hours or miles, hourly rate, amount (expenses and other items),
    description and a trip's route are fields in its row, edited in place
    with no save button (`client/src/portal/CheckLinesTable.tsx`,
    `useLineEntry.ts`). Edits stay on the page, marked unsaved, until the
    next action saves them all first: deciding any line, opening Part, Rate
    or Reject, asking or answering, re-pricing or finishing; a line that
    can't be priced stops these with what it needs. Leaving the page or
    closing the tab saves them too, keeping the invoice unfinished, with any
    line that can't be priced keeping its last saved version (as on the
    check page). An edited line shows its decision buttons again, since
    saving undoes its decision, and editing it closes its open Part, Rate
    or Reject; typed back to its saved values it is no longer edited. A save refused as stale drops the unsaved
    edits and shows the lines as they are. Adding, removing and putting back
    a line still save at once. Its bar holds Remove (and "Put it back as
    read" for a line changed from the file) on the left and Approve, Approve
    part and Reject on the right. The invoice
    moves to `awaiting_answer`: lines can still be decided, but finishing
    is refused and recall isn't offered. The submitter, or the professional
    it bills for, answers on the portal invoice page
    (`POST /api/portal/invoices/:id/questions/:questionId/answer`); a
    reviewer may record an answer given by phone or email
    (`POST /api/invoices/:id/questions/:questionId/answer`), named as the
    one who answered. Each question is answered once and neither is ever
    edited. Answering the last open question returns the invoice to
    `under_review`. Asking and answering each append an `invoice_event`
    (`question_asked`, `question_answered`). Each question shows in a row
    under its line, highlighted until answered, where the submitter answers
    it; the portal shows no staff names. Until the round is finished, staff
    invoice lists (both queues, a person's and a case's invoices) show
    "Question unanswered" and "Question answered" chips from the queue's
    `openQuestionCount` and `answeredQuestionCount`, and the review page says
    when answers are in; the portal shows "Question for you". Exports and the
    billing record never include questions.
  - Entering in review (`enter_request_in_review`; `src/billing/enterInReview.ts`,
    `client/src/components/EntryLines.tsx`): on "+ Upload Invoices", a staff
    member with a reviewing role makes each upload, or an invoice typed in by
    hand, with `enterInReview` (`POST /api/portal/uploads/:id/draft` and
    `POST /api/portal/invoices`). In the same transaction `enterInReviewInTx`
    moves the new draft to `under_review` (`invoice.entered_in_review`,
    migration `0029`) with a chain and no snapshot yet, the uploader as line
    reviewer (`assignForEntry`) and the default approvers, and records
    `review_started`; so an upload is in review or not made at all. Both
    ways take the invoice number on the sender's invoice, kept as a
    `supporting_invoice` (with no document when typed in). They then open
    the review page instead of the check page ("Check and review the lines",
    then "Finish the review"); several files are entered one
    after another, as the check queue does. Staff without a reviewing role
    keep the draft and check page. While the
    chain has no snapshot, the review page shows its reviewer the check
    page's editor beside the file (`portal/useLineEntry.ts`, shared with the
    check page), each line with its decision buttons and questions, an
    editable case number (`PUT .../entered-case-number`) and how and when it
    was received (`PUT .../entered-receipt`), each saved as it changes, so
    "Finish later" only leaves the page (for the upload's next invoice, else
    To review); there is no separate draft, so it stays visible and assigned
    meanwhile. For a reviewer, To review's top panel is "Your unfinished
    invoices": what they are entering (decided so far, last saved), then any
    draft of theirs from before, whose "Continue" moves it into their review
    (`POST /api/invoices/:id/enter-in-review`) or, with no sender chosen,
    opens the check page; other staff keep "Your drafts, not sent yet". The
    queue's date column and the review page's date say "Submitted" for every
    invoice; for one entered in review that is when entry began. Finishing one of an upload's invoices keeps its message and Undo
    on the next, and Undo goes back to it. `PUT .../entered-lines` saves the whole set as a draft save
    does, but lines keep their `invoice_line_id` (any draft save now updates
    lines in place by id and inserts the rest, rather than deleting and
    reinserting, and clearing the rates pricing sets), fills unmatched
    workers and prices as submitting would, and removes the working
    decision of any line whose type, date, description, quantity, stated or
    billed rate, amount, billing codes, worker (or the unlisted one named),
    linked time, time category or trip route changed. Removing a line with a
    question is refused. Billing rule findings are live until the snapshot.
    `POST .../finish` on such an invoice first confirms a file import still
    unconfirmed (`confirmEnteredImport`, as its reviewer, whoever uploaded
    it), committed on its own: a decided line that confirming changed loses
    its decision and finishing is refused (`decisions_undone`) until it is
    decided again. It then measures the trips, and `closeEntry` runs the submission checks (case
    number, receipt, confirmed import, dated imported lines), creates time
    entries for a case, prices strictly, applies trip distances and billing
    rules and writes the snapshot (`freezeRequest`, shared with
    `finishSubmission`), refusing if any decided line's values changed, and
    then records the round. Reopening and send-backs never reopen entry.
    Its reviewer may delete it (the portal delete) while entry is open and
    no question has been asked; its events go with it, as a draft's do.
    Each entry save, and each decision, undo or re-pricing while entry is
    open (`requireCurrentEntryLines`), sends the `invoice.lines_version` its
    page holds (migration `0030`); a different version is refused (409
    `stale_lines`, naming who changed them, or "you … in another tab"), and
    the page reloads to the latest lines. A save reports only the decided
    lines whose decision it undid. Entry changes also need the reviewing
    role, not just the assignment. A new line is given its id by the page
    (`crypto.randomUUID`), which any line save keeps unless another line
    already has it, so the next save finds the line; a kept line that didn't
    change isn't rewritten. An entry filed under a case finishes like any
    other: linking its time lines to new time entries doesn't count as a
    change to a decided line, and it needs no typed case number. While
    entry is open the queue's billing rule flags are worked out live. Saves and confirming bump it and record
    `lines_changed_at` and `lines_changed_by_user_account_id`. While entry is
    open, the review page shows a "Being entered by …" badge with the last
    change (`EntryBadge`), to its reviewer and to anyone else, whose page
    reloads every 30 seconds; staff lists show "Being entered"
    (`beingEntered`, in `QuestionChips`). Case number corrections are
    refused until it is finished, and the reviewer menu warns before taking
    it over. Approvers see "Entered and decided by the same person" when the
    uploader finished the latest round (`decidedByEnterer`); others see who
    is still entering it. Its review page says who entered it (dates are
    still labeled "Submitted"), credits the file to the person it is from and differences from the file
    to whoever entered it, and asks questions of the person it is from. The
    case number typed while entering replaces the one read from the file,
    which the file viewer keeps; reviewers' later corrections go beside it as
    usual. Gaps: whether a different reviewer must finish is
    an open decision, so it is only flagged; the professional it is filed
    under can read its lines in the portal while they are being entered;
    other viewers' pages poll rather than update live, and the case number
    and receipt aren't versioned (last save wins).
  - Routing: submission assigns line review to the case's
    `case_invoice_reviewer`, else the `invoice_review_setting` default,
    else no one, and sign-off to the default approvers. `PUT .../reviewer`
    (any staff member) reassigns, optionally for the case's future
    invoices; `PUT .../sign-off-approvers` (any staff member) changes
    approvers before finishing. Deciding a line, asking a question or
    choosing approvers on an unassigned invoice takes it; on one someone
    else reviews, it stays theirs and the review page says whose it is. Recall ends the
    invoice's assignments; delete removes them with the invoice.
  - Roles (`src/auth/staffAccountRole.ts` `reviewPermissionsForRole`):
    Staff upload, decide lines, reassign, finish and sign off;
    Administrator also changes settings. One system role per account, set
    in Settings (`PUT /api/settings/staff-roles/:id`, audited as
    `system_role_changed`). Migration `0034` renamed "Intake Staff" to
    "Staff" and retired "Billing Reviewer" and "Sign-off Approver" without
    moving accounts, since `audit_event` needs an actor: accounts that
    still have one act and show as Staff until an administrator changes
    their role. Review settings `sign_off_by` (`anyone` or `approvers`) and
    `sign_off_approvers` (`src/billing/reviewSettings.ts` `canSignOff`)
    decide who may be chosen to sign off and who may sign.
  - Staff accounts: created on first SSO sign-in from an allowed domain
    (`*_ALLOWED_DOMAINS`), or added first by an administrator in Settings
    with a name, work email and role (`POST /api/settings/staff`, audited
    `staff_account_added`); the allowed domains still gate sign-in, and the
    person gets that account and role on first sign-in. Administrators
    deactivate and reactivate staff (`PUT /api/settings/staff/:id/active`,
    audited), never themselves. A deactivated account can't sign in, and
    `/auth/me` ends its session on the next page load; role, staff-entry and
    admin checks already require an active account. Gap: until that reload,
    an existing session can still read staff pages (sessions are signed
    cookies with no per-request account lookup).
  - External users (`src/people/externalUsers.ts`, model rule
    `manage_external_sign_in`): Settings → External users lists who may sign
    in with an emailed code (`GET /api/settings/external-users`, any staff
    member, a batch at a time; `q` searches name and email). Administrators
    search providers and office delegates (`GET .../candidates?q=`), list
    offices a new delegate may send for (`GET .../offices`), turn sign-in on
    for an existing person, adding an email if they have none, or add a new
    provider or delegate with it on (`POST /api/settings/external-users`
    with `{ personId, email? }`, `{ newProvider }` or `{ newDelegate }`), and
    turn it on or off (`PUT .../:personId`, `{ signInEnabled }`). They also
    make anyone listed, such as a provider, an office's billing delegate from
    now (`POST .../:personId/offices`, `{ officeId }`, linking a signed-in
    account to the person so delegation is read), or end it
    (`POST .../:personId/offices/:officeId/end`, setting `ended_at`, never
    deleting). Each change is audited on the person
    (`external_sign_in_enabled`/`_disabled`, `person_email_added`,
    `external_delegate_added`, `external_delegate_office_added`/`_ended`);
    nothing is emailed.
    `person.external_sign_in_enabled` is the only gate: migration `0045`
    turned it on for everyone with an external account, replacing the old
    `EXTERNAL_EMAIL_WHITELIST`. Unlike staff deactivation, turning it off
    ends an open session at once: every `/api` request and `/auth/me` from an
    email-code session checks it (`endTurnedOffExternalSessions`). Tests turn
    it on for the accounts they create; no server has an allowlist.
  - Visibility: the portal's invoice detail has no working decisions, no
    names on decisions and no internal comments (`loadInvoiceDetail`
    `audience`). The portal's invoice list names the assigned line
    reviewer while an invoice is in review, so a submitter and reviewer
    on the phone know who is who; exports show the case and court numbers, each line's
    latest decision only, and sign-offs without comments.
  - Rate check (`src/billing/preauthorizations.ts` `rateLimitFor`): a time
    line's limit is the latest approved `preauthorization_decision`
    `approved_hourly_rate` for its professional on the case (or a
    case-wide one), else its configured rate. The invoice detail carries
    each line's `rateLimit` and its source; the queue flag and Re-price use
    the same limit. Approving a pre-authorization request may set that rate.
  - Reasons (`src/billing/decisionReasons.ts`): `invoice_decision_reasons`
    has an `applies_to` column (`approved_in_part`, `rejected` or `both`);
    the review panel offers only the outcome's list and the server refuses
    others. Administrators add, move and retire reasons in Settings
    (`/api/settings/decision-reasons`); "Another reason" stays on both.
  - Billing record (`src/billing/billingRecord.ts`,
    `GET /api/invoices/billing-record?format=csv|xlsx`, on the Exports page):
    one row per submitted invoice (`model/rules.yaml`
    `report_billing_results`), with the case's client. `county`, `from`,
    `to` and `status=signed-off` narrow it, keeping invoices whose billing
    period overlaps the dates (none without a period). `omit` (one
    comma-separated value of column names) leaves columns out, never the
    invoice number or amounts (`OMITTABLE_BILLING_RECORD_COLUMNS`). The
    Exports page's one "Export billing record" button
    (`client/src/components/BillingRecordExportButton.tsx`) opens a dialog
    with county, billing period, signed off only (the default) or every sent
    invoice, format and "Redact some columns"; all but county and period are
    remembered per person in the browser (`client/src/exportChoices.ts`).
    A redacted spreadsheet starts with a "Redacted copy. Left out: …" row; a
    redacted CSV keeps one header row and is marked only by its
    `-redacted` file name. CSV text starting with `=`, `+`, `-` or `@` is
    prefixed with `'` so spreadsheets don't run it as a formula. Not yet
    held, so not in it: payment track,
    budget account code and month, and payment date and reference.
    Nothing is sent to an external system.
  - The approved total is the latest complete round's approved amounts,
    not stored. Migration `0008` carried invoices part-way through the old
    one-decision-at-a-time review into working decisions, keeping their
    recorded decisions as an incomplete round that no total uses.
  - Not implemented: pre-approval, deny or request changes back to the
    submitter, allocation draws, submitter replies to decisions (planned),
    a holiday calendar, defaults by kind of invoice. Concurrent decisions
    are serialized by the invoice row lock.
- **Drafts, submission, recall and withdrawal** (`src/billing/invoiceLifecycle/`:
  `drafts.ts`, `replaceLines.ts`, `submit.ts`, `withdraw.ts`; `invoiceEvents.ts`; `client/src/components/InvoiceLinesEditor.tsx`, `invoiceLines.ts`):
  - `POST /api/portal/invoices` with `submit: false` saves a draft (the
    default still submits). `PUT /api/portal/invoices/:id` replaces a
    draft's period and lines; `POST .../submit`, `.../recall` and
    `.../withdraw` move it (`model/workflows.yaml` `payment_request`).
  - Submitting creates the approval chain with a `submission_snapshot` of
    the invoice and line rows (`spec_version` 0.5.0). Recall is refused
    once any decision exists on the current chain; otherwise it supersedes
    the chain, keeping its snapshot, and returns the invoice to draft.
    Withdrawal applies to drafts only. `DELETE /api/portal/invoices/:id`
    (`src/billing/deleteInvoice.ts`) removes the submitter's draft or
    withdrawn invoice if no review decision was ever recorded, with its
    lines, events, recalled approval chains and snapshots, import record,
    document metadata, any kept file, and time entries its import created
    (unlinked instead if another invoice uses them); otherwise 409. One SQL
    rule (`deletableBy`) decides both the delete and the `deletable` flag on
    the portal invoice list and detail, which is all the client checks: Delete
    replaces Withdraw in the draft editor, and appears on invoice pages and
    case list rows. The case list hides withdrawn invoices behind a toggle
    and shows a recalled invoice's last submission (`lastSubmittedAt`), since
    recall clears `submittedAt`.
  - Only the submitter, while still able to act for the invoice's
    professional on the case (see delegation below), may do these; anyone
    else gets a 404. Every transition, and review's final
    approve/reject, appends an `invoice_event` with actor and time, under
    the same invoice row lock review takes.
  - Simplified: the snapshot holds invoice and line rows only, not the
    case, participant, payee or attestation evidence the model lists, and
    chains created by review before snapshots existed have none. Replacing
    a draft's lines deletes the old draft rows, which were never reviewed
    (earlier submitted values live in their snapshot).
- **Invoice import** (`src/imports/`;
  `client/src/portal/PortalImportReview.tsx`, `components/InvoiceImportForm.tsx`):
  - `POST /api/portal/invoice-imports?caseId=&professionalId=` takes the
    file as the raw body (10 MB limit, name in `X-File-Name`). The type is
    detected from content (`detectFormat.ts`): LEDES 1998B, the invoice
    template as CSV or XLSX (`GET .../template?format=csv|xlsx`), or a PDF.
    Legacy or encrypted Excel files, macro-enabled workbooks and anything
    else are refused before parsing (415).
  - PDFs (import format `document`) are read by the extraction method named
    in `INVOICE_EXTRACTOR` (`src/imports/extractors/`), recorded on the
    import as `extraction_method`. The only one is `pdf-text-layer`: PDF.js
    (`pdfjs-dist` core, which never runs document scripts) reads the text layer in-process
    and rows are rebuilt from text positions. Each run of column headings
    starts a table (merged headings are split; a section title can head the
    description column) and a total row ends it, so time and expense tables
    can follow each other and a table can run across pages. Values go to
    the heading they overlap most, which handles right-aligned columns;
    wrapped or stacked text joins the item above, and a date on its own
    line fills the item's date. No-charge rows are skipped, credits refused;
    up to 50 pages. Page subtotals don't end a table (each is checked
    against the items above it, warning `subtotal_mismatch`), and nothing
    after the amount or balance due is read, so attachments behind the
    invoice aren't (nor is a later page's total taken for the invoice's).
    Text under no heading goes to the description, not a
    neighbouring figure column (nor, in a table without a description
    heading, the date column); with no quantity heading, the first of two
    figures under the rate is the quantity; without a date in the date
    column, a date opening the description is the item's and is left out
    of it; a line described as mileage is an expense. A second "Miles |
    Rate | Amount" after the first amount is mileage beside each item,
    imported as its own expense line. A time sheet's "Total Time" is hours,
    and an attached time sheet's total isn't taken for an amount; its
    hours by date are compared with the invoice's time lines, and dates
    that differ are listed (warning `time_sheet_mismatch`) without
    changing any line. The invoice number is the first labeled value
    ("Invoice No.", "Invoice #", "Voucher No.") with a digit in it, beside
    its label or, when the label heads a column, under it; so "N/A", a
    misread scribble or the next heading ("Invoice # | Date") isn't one. Outside tables, items written as sentences, as in a letter
    ("Site visit, March 9: 2 hrs x $100.00 = $200.00"), are read too, with
    a numbered line ending in an amount once such sentences have appeared;
    a total after the last of them ends the invoice like an amount due.
    Items given as hours and a day ("2.0 hrs/March 2 Review of records")
    are priced by the one rate stated below them ("3.5 hrs @
    $100.00/hour = $350.00"), dated in the year of the latest full date
    above them (the year before when that would be later). A charge stated
    only in the summary below the items ("30 copies @ $0.10/copy $3.00")
    is imported, with warning `summary_charge`, when it isn't hours or a
    restated total and makes up exactly what the items fall short of the
    stated total. Stated hours ("3.5 hours @ $100.00") are checked against
    the items' hours at that rate, or all of them (`hours_mismatch`).
    Amounts with cents are preferred over stray digits, rates can have
    three places ($0.725), points as thousands separators ("2.500.00") are
    read, and a page-number line ("Page 2 of 5") is never an item.
    Figures right-aligned well past left-aligned headings, one per figure
    heading but doubled up under the later ones, are taken in order. One
    heading over hours with the rate stacked under them ("Hrs/Rate",
    "90.00/hr" on the item's next line) fills both, and an undated row
    whose amount is all of two or more items above it is their total,
    labeled or not.
    In a packet, pages titled as requests for pre-authorization or
    authorization summaries are skipped, as is a payment-request cover
    form whose own table (accounting lines) would otherwise be read before
    the invoice's; a file of nothing else is still refused or read for its
    total.
  - Scans: a PDF is recognized rather than read from its text layer when
    no page has visible text, which covers image-only scans and
    "searchable" scans whose invisible text (rendering mode 3 or 7, over
    page images) another program recognized, or when its text is mostly
    unmapped characters (fonts without a character map). Hidden-text pages
    in an otherwise digital file are skipped like other attachments,
    unless its visible text has no items and some page has no text at all:
    that is a scanned packet stamped or typed on in places (a date stamp,
    a cover form filled in on a computer), and all of it is recognized.
    Telling these apart reads each page's drawing operators, not its
    pixels, so digital PDFs stay fast. `ocr.ts` renders each page at
    300 DPI (PDF.js with its optional `@napi-rs/canvas`, and its JBIG2 and
    JPEG 2000 decoders, which office scanners use), whitens colored bands
    such as a table's heading row and darkens whatever text is on them,
    fades highlighter (removing pen ink by color was tried and dropped:
    it also removed colored print), erases table rules, and recognizes it
    in-process with tesseract.js and its bundled English data (nothing is downloaded at run time); the words feed the
    same table reader. The result warns `read_by_ocr`, flags items whose
    figures were recognized with low confidence (`low_confidence`, e.g.
    handwriting or strike-through) and skips an amount read as negative
    (`line_not_read`) instead of refusing the file. A faint decimal point
    recognized as a space in a dollar amount ("$420 00") is read as a
    point, as is a cell of only such a figure ("3480 00"); a one-character
    mark after a dollar amount (a tick read as "7") is kept apart from it;
    and "TOTALDUE" counts as an amount due. When a recognized
    item's quantity × rate doesn't make its amount, the one cheapest
    explanation is applied with warning `figures_repaired`: a dropped
    decimal point ("89250" for 892.50, in up to two figures), a number
    among stray marks, a dollar sign read as a digit ("3480.00" for
    480.00), or else one unreadable or low-confidence figure worked out
    from the other two; with no single fit the figures stay as read. Digital text is never
    repaired, so its own errors show as rate mismatches. Handwriting is
    never imported: the printed figures are, and reviewers apply any
    handwritten correction in review. Words recognized without confidence
    on average (handwriting, a correction or a poor scan of print, in the
    margin or as a minus under a figure column such as "-40") are attached
    to the item above as warning `unclear_text`, quoting recognition's best
    guess when it is mostly figures and saying it couldn't be read
    otherwise; a confident minus there is printed text ("pages 1-40") and
    continues the description. Every warning on a recognized item ends
    "Compare with the file." A line's
    height is taken from its typical word, so a tall handwritten mark
    doesn't merge it with the next. Recognition takes a few seconds a page.
  - PDFs are read in the background (`extractionJobs.ts`): the upload stores
    the file, creates the import as `received` and returns; one file is read
    at a time, and the import detail and list carry `progress` (waiting
    with how many files ahead, reading, or recognizing page n of m), which
    the review and bulk import pages
    poll every two seconds. LEDES and spreadsheet files are still read
    during the upload. A result is recorded only if the import is still
    `received`, so a file discarded while it was being read stays
    discarded. Every uploaded file, PDF or not, is parsed in a child process
    (`isolatedExtraction.ts`, `extractionWorker.ts`) with a JavaScript heap
    limit (`INVOICE_EXTRACTION_MEMORY_MB`, default 512) and a 60-minute
    limit, killed past either, so a hostile or pathological file fails its
    import instead of the server (`INVOICE_EXTRACTION_ISOLATION=inline`
    reads in-process; the tests do). Measured with the compiled code, a
    scan peaks at about 500 MB for one page and 650 MB for twelve, but the
    reader's heap stays under 20 MB: the rest is text recognition's
    WebAssembly memory and page images, which only a container limit
    bounds. `docker-compose.prod.yml` therefore limits the server container
    (`SERVER_MEMORY_LIMIT`, default 700m, plus swap to
    `SERVER_MEMORY_SWAP_LIMIT`, default 1700m, sized for the 1 GB demo
    instance) and keeps the server's own heap below it (`SERVER_HEAP_MB`,
    default 256); past the limit the kernel kills the reader, which marks
    itself first in line (`oom_score_adj` 1000), and the import fails.
    Postgres has `oom_score_adj: -500`, so in a host-wide shortage the
    kernel kills other processes before it. A reader whose server went away
    exits. Each page's rendering resources are freed once it is read.
    Discarding an import that is still being read cancels it: dropped from
    the queue, or its process killed. A waiting job holds only the stored
    file's reference. On startup, stored files no live document refers to
    are deleted. Renders stop at 25 megapixels whatever size a page claims,
    embedded images over 50 megapixels aren't decoded (the page reads as
    blank), and text recognition gives up on a page after 60 seconds. A recognized page that
    reads badly is tried upside down and sideways, keeping the angle with
    the most confidently read words, so misfed sheets are read. Jobs live in the server process: on startup, before taking
    requests, imports still `received` fail with warning `interrupted` for
    the uploader to upload again, which means this needs a single server
    instance.
  - Methods marked outside the processing boundary are refused in
    production. Layouts with neither a recognizable table nor item
    sentences are imported as `failed`, for the submitter to discard or
    enter by hand. No model reads documents: a self-hosted vision model was
    tried as a follow-up pass and removed, since it needs a GPU host or a
    much larger server than the demo's (see
    `docs/invoice-import-export-plan.md`).
    `npm run extraction-accuracy` scores methods against the synthetic PDFs
    in `scenarios/fixtures/invoices/`: the text-layer reader gets 98.0% of
    1,545 fields across seventeen files, six of them scans (all digital
    fields but the voucher's counsel name, which sits outside its table; the
    marked-up scan is misread on purpose and its figures are flagged).
    That corpus was made for this purpose, so real
    invoices will score lower. `npm run extract-invoice -- <files>` shows
    what any file yields; vendor templates, exports and real samples for
    trying it go in the gitignored `local-samples/`, never in Git, and
    `npm run extraction-accuracy -- --samples ../local-samples` scores their
    figures against a hand-written `local-samples/expected.json`.
  - The file goes to `DOCUMENT_STORE_DIR` (`documentStore.ts`), a private
    local directory outside the database: in both Compose files the
    `documents` volume, so files survive the container being recreated
    (unset, it falls back to the OS temp directory, which doesn't). A readable file becomes a draft
    (import `extracted`); an unreadable one is kept as `failed` until
    discarded. Parsed values with their file locations and reconciliation
    warnings (stated total, hours × rate, dates outside the period, same
    file or invoice number already imported for the professional) are the
    `extraction_result`.
  - Each line is suggested a timekeeper and a type (time, expense or other,
    stored as `invoice_line_types` `time`/`expense`/`service`). The
    timekeeper is this payee's earlier match for the same name, else the one
    billable professional whose name fits (`src/imports/matchTimekeeper.ts`:
    case, accents and punctuation ignored, "Last, First" or initials
    accepted); a line naming no timekeeper is suggested as the billed
    professional. Anything ambiguous stays unmatched, even on a delegate's
    draft, and the review page labels every suggestion until it's checked.
    The page can also set one professional on every unassigned item, or on
    all items (replacing suggestions); this is a client-side edit saved like
    any other, so confirmation still checks every line.
  - A line with no date in the file takes the date of the line before it
    on the same draft (for a file split by case, the case's previous line),
    with a `date_from_previous_line` warning flagging it to check until the
    date is changed (`src/imports/undatedLines.ts`). A line with no earlier
    date stays blank with a `date_missing` warning; the check page shows a
    date box in its place, and confirmation and submission refuse any line
    read from the file without a date (Send stays disabled until then).
    Lines are never split across days. Lines keep their
    order as `invoice_line.position`: the file's, then as entered, on every
    page. Drafts imported before migration 0026 keep any period-end date and
    its stored warning.
  - `GET .../invoice-imports/:id` shows the import, its warnings and time
    already recorded that matches a line, which the submitter may link
    instead. `.../file` downloads the original until it's deleted, and
    `.../preview` returns what review shows beside the items: text for
    LEDES/CSV, rows for XLSX (both capped), or `{kind: 'pdf'}`, in which case
    the client draws the file onto canvases with PDF.js
    (`client/src/components/OriginalDocument.tsx`, `PdfPages.tsx`, loaded
    only on that page), with the same JBIG2 and JPEG 2000 decoders as the
    server (served from `/pdfjs-wasm/` by `client/vite.config.ts`), or
    scanned pages draw blank. The file is never opened as a page in the app's
    origin. Each item's "page N, row M" links to its page.
    `.../confirm` requires every line matched (a file designated to one
    professional fills lines with no one named as theirs); `.../discard`
    deletes the file and withdraws the draft. Imports are visible only to
    their uploader. Once the import becomes a request, anyone who may read
    the request sees its file: staff through `GET /api/invoices/:id/file`
    (and `/file/preview`), portal readers, delegates included, through
    `GET /api/portal/invoices/:id/file`.
  - File retention (`src/imports/documentRetention.ts`; `model/rules.yaml`
    `validate_invoice_import`): a file is kept while any import of it is
    unresolved or its confirmed request is live, so the submitter and
    reviewers see it beside the lines. Discarding or expiring its imports,
    or withdrawing or deleting its request, marks the content deleted
    (`document.content_deleted_at`) and removes the file's bytes after
    commit; the hourly sweep retries any removal that failed. Gap: payment completion isn't recorded yet, so a live
    request's file stays until it is withdrawn or deleted.
  - Bulk import (`client/src/portal/PortalBulkImport.tsx`, its steps in
    `portal/bulk/`, `bulkImport.ts`;
    the portal's "Upload invoices" tab) takes several files, each
    assigned a case and whom it bills (one choice, grouped by person, so a
    delegate picks both), suggested from the file name when exactly one
    case's reference or client name fits. It uploads them one at a time
    through the single-file endpoint, so each is its own import. `GET
    /api/portal/invoice-imports` lists the uploader's imports still in
    progress (unresolved, or confirmed with an unsubmitted draft) with what
    each still needs (items to match, dates to add or check, other
    warnings, why a file couldn't be read). The page runs as three steps
    (add files, review each, submit) with the current one marked: uploads
    lead to "Review next"; review pages opened from it (`?from=bulk`) show
    "File N of M" and confirm or discard straight on to the next file, then
    to the submit step, which lists the confirmed drafts (all included
    unless unticked) and submits them with one button showing the count and
    total (one submit call each, failures listed by file). No batch record
    is kept on the server; the browser session remembers which imports it
    uploaded, and "Cancel import" discards those still in progress
    (unconfirmed imports are discarded, confirmed drafts deleted), leaving
    earlier imports and anything submitted alone.
  - A bulk file is designated either to one case (as above) or to one
    professional (`src/imports/splitByCase.ts`; `model/rules.yaml`
    `validate_invoice_import`). For a professional, the template's optional
    `case` column names each line's case.
    `POST .../invoice-imports/case-split/reads` stores the file and reads
    it like an upload (PDFs in the background queue with progress, quick
    formats straight away, both in the isolated process); `GET
    .../case-split/reads/:id` reports progress, then suggests a case per
    line (a single match on case reference, identifier or client name
    among that person's open cases the user may bill: from the line's case
    column if it has one, else the one case a PDF's own text names, else
    its description; see `src/imports/caseMatching.ts`), and `DELETE`
    stops and discards it. The page has the user assign every line, and
    `POST .../invoice-imports/case-split` (the read's ID and one case per
    line) makes one import and draft per case from that reading and stored
    file, all billed to that professional and sharing one document; the
    file is never read twice. Pending reads live in the server process: one
    left unused for an hour is dropped with its file, and a restart forgets
    them, whose files the startup sweep then removes. Every
    line is that professional's work: the extraction result records them as
    `designated_professional_id`, review shows "work done by" fixed rather
    than suggested (items added there are theirs too), and confirmation
    refuses any other. Each part is reviewed and submitted like any import;
    review shows the whole original. The file stays while any part is
    unresolved or live (see "File retention"), and parts of one file don't warn
    that each other are duplicates. Only the spreadsheet template has a
    case column; other files' lines name no case, so a PDF's own text or
    each line's description is used.
  - The case-based upload (`client/src/portal/PortalUpload.tsx`, now
    reached only from staff Intake; submitters use the upload filed by
    person, above) reads a file before its case is chosen, with the same
    read machinery: `POST /api/portal/uploads` stores and reads it, `GET
    .../uploads/:id` reports progress and then what was read (line count,
    invoice number, billing period, stated total), the cases it may go to
    and a suggested one, and `DELETE` discards it. Only open cases where the
    user, or a professional they act for, is the active assigned
    professional are offered, one option per case and professional. A case
    is suggested only when it is clear: the user has one case, the file's
    lines name one, a PDF's own text names one, the file name holds one
    case's number or client's name, or the text names a professional with
    only one case (a heuristic; several matches suggest none). When the
    text names professionals, a case none of them is on is not suggested,
    and a case colleagues share goes to the one named. Matching ignores punctuation, accents,
    case, name order and suffixes; only when nothing matches exactly does
    it allow a number without separators, a middle name or given initial,
    or one slip in a long name. Short or all-digit numbers under six
    digits are matched only as a whole label, not inside text. `POST
    .../uploads/:id/draft` (case, professional, checked billing period,
    optional invoice number) makes one unconfirmed import and draft with
    every line billed to that professional; the checked period replaces the
    one read on the draft only, and the invoice number is kept as a
    `supporting_invoice`. Several files are checked one at a time, then
    land in Your invoices as drafts marked "Lines not checked yet"; one file
    goes straight on to checking its lines. Cancel discards unread files and
    deletes drafts already made. With no file, "Enter an invoice by hand"
    asks the same case (`GET /api/portal/uploads/cases`) and billing period,
    creates an empty draft (a draft may have no lines; submitting still
    needs one) and opens it on adding its first line, then it is sent the
    same way. Staff land on their draft editor instead. A LEDES file's
    `CLIENT_MATTER_ID` (else `LAW_FIRM_MATTER_ID`) is each line's case;
    both IDs and `INVOICE_DESCRIPTION` are searched as its text.
  - Checking the lines (`client/src/portal/InvoiceSubmission.tsx`, the
    portal's `/portal/invoices/:id`): the file on the left as uploaded, the
    lines on the right in file order. Each line carries the place it was
    read from (`invoice_line.source_location`, carried back on every save)
    and the extraction result keeps each line as first drafted (`drafted`),
    so `src/imports/invoiceFile.ts` and `client/src/fileChanges.ts` work out
    what changed: a changed line shows what it was, a removed line (a file
    line with no current line) stays struck through with Put it back, and an
    added line says so. Each line is edited in place, in its row (date,
    hours or miles, rate for time, amount for expenses and other items,
    words, a trip's route; mileage at the configured rate per mile), with
    the amount worked out as typed and no save button: edits stay on the
    page, marked unsaved, until "Send for review" or "Save and finish later"
    saves them, where a line that can't be priced stops them with what it
    needs. Leaving the page or closing the tab saves them as a draft (a
    keepalive request), a line that can't be priced keeping its last saved
    version, since a line saved without its hours or amount would be
    removed; every save follows that rule. Remove, Put it back as
    read (in the line's bar), Put it back and Add a line we missed each save
    at once with Undo. Lines a reading
    warning names are marked "Check this"; same date, words and amount as an
    earlier line is flagged as a possible duplicate. The notice compares the
    file's total with the lines': a misread file says by how much and where
    to look; a difference the submitter made says which lines. Clicking a
    line scrolls the file to its page, or highlights its spreadsheet row.
    The file viewer shows "Page N of M" and zooms from 50% to 300% (the
    percentage resets to fit); PDF pages are redrawn by PDF.js at each
    zoom, not scaled, so they stay sharp, and the document is read once.
    Gaps: the design's column matching for spreadsheets not on the template
    (F8) isn't built; a PDF line scrolls to its page rather than
    highlighting the line.
  - Sending (F9–F11, G9–G10 when filed by person): Send for review confirms the import (strict pricing
    and billing rules; confirming one already confirmed changes nothing, so a
    send refused for a missing explanation can be retried) and submits with the true-and-correct tick, which
    the server requires of any submitter who isn't staff and records as an
    `invoice_attestation` bound to the attempt and in its snapshot (staff
    entering a request received elsewhere don't attest for its payee; the
    older manual-entry and bulk-import screens have the tick too). The
    submitter is emailed a receipt (`sendEmail`; logged without SES), its
    time in the zone their browser sends with `submit` (`timeZone`; else the
    reporting zone, `src/formatDate.ts`), and
    the page offers Download receipt (the invoice PDF export) and Withdraw
    (recall, behind a confirmation) until review starts. The lines lock
    once sent; Undo on the sent message withdraws it.
  - Reviewing beside the file (E9, `client/src/pages/InvoiceReview.tsx`):
    staff read the file through `GET /api/invoices/:id/file` and
    `.../file/preview`. The page has Show/Hide the file, open by default
    when the submitter changed anything; facts add "File said" and what the
    submitter changed; changed lines are marked with the values the file
    said and "was" under the hours and amount; removed lines are listed
    struck through, "Not on the invoice. Nothing to decide." (in a table
    under the lines rather than in place, as the design draws them).
  - A draft from an unconfirmed import can't be submitted or withdrawn
    directly. Confirming prices its time lines from configured rates (see
    "Rates and billing from time"); submitting creates a time entry for
    each time line with a date and hours, for its matched professional,
    linked both ways; a resubmission after recall reuses those entries.
  - An hourly in-process sweep (`src/app.ts`) discards files that couldn't
    be read three days after upload (no resolving user), and removes any
    file whose deletion was recorded but didn't finish. A draft read from a
    file never expires; it stays until its submitter sends, discards or
    deletes it, keeping its file.
  - Gaps: no malware scanning (no in-boundary scanner is configured yet;
    PDF.js's core runs no document scripts and nothing in a file is
    executed); background reads need a single server instance and a
    restart fails the ones in progress and forgets pending case-split reads
    (their uploader starts again); a scan on the 1 GB demo instance runs
    partly in swap, so it is slow; invoices with neither an item table
    nor items written as "hours × rate = amount" sentences or hours priced
    by one stated rate aren't read;
    handwritten figures are flagged, not read; no cloud AI method (one needs a cost review
    first); expense lines create no
    `expense` records (no table); credits and adjustment lines are refused
    rather than imported; a file's container-local
    copy is lost if the container is replaced (the import then shows it as
    unavailable); a cloud deployment needs a private, non-versioned bucket
    excluded from backups instead of the local directory.
- **Delegated submission** (`src/portal/portalActor.ts`,
  `src/professionals/delegateRole.ts`; `model/rules.yaml`
  `authorize_delegated_submission`):
  - A delegate is a user account whose person has an effective
    `person_affiliation` with the seeded "Billing Delegate" role
    (`role_context` `person_affiliation`) in an office. They may bill any
    active professional with an effective affiliation in that office who
    has an open assignment on the case. Office membership without the
    role grants nothing.
  - `POST /api/portal/invoices` takes `professionalId` (whom the invoice
    bills, stored as `invoice.professional_id`) and per-line
    `timekeeperProfessionalId`, which defaults to that professional on a
    delegated invoice. Each is checked on create, edit and again at
    submission. `submitted_by_user_account_id` and every event's actor
    are the delegate. `GET /api/portal/cases/:caseId/billable-professionals`
    lists whom the session may bill; `GET /api/my-cases`
    (`src/portal/listPortalCases.ts`) also returns the represented
    professionals' cases, tagged with who holds each, and the portal case
    list shows one section per person (yours first). Each card flags
    "Unsubmitted time" (that person's time on no submitted invoice) and
    "Unsubmitted invoice" (a readable draft or withdrawn invoice billing
    that person).
  - `GET /api/portal/time-entries?caseId=` also returns the time of
    represented professionals assigned to that case
    (`timeReadableProfessionalIds`); without `caseId` it returns only your
    own. `POST /api/portal/time-entries` takes an optional `professionalId`
    so a delegate can log time for them on such a case. Every entry stores
    `recorded_by_user_account_id` (migration `0003`), including entries an
    import creates on submission; entries from before 0.4.0 have none.
    The case page shows "Work done by" in the time table and log form.
- **Changing time** (`src/portal/changeTimeEntry.ts`; `model/rules.yaml`
  `validate_activity_and_time_context`): `PUT` and `DELETE
  /api/portal/time-entries/:id` let whoever may record time for the entry's
  professional on the case (themselves, or a delegate) change its date,
  hours and description, or delete it. Whose time it is can't change. An
  invoice that isn't withdrawn and bills the entry locks it with a 409
  `time_entry_invoiced` whose message says what to do; `GET` returns the
  billing invoice as `billing` and that text as `lockedReason`. On the case
  page, time on a draft links to the draft ("Edit on draft"), where editing
  its line edits the entry; time on a submitted invoice shows the reason
  when Edit or Delete is clicked. Each change or deletion, here or through
  a draft, writes an `audit_event` row (migration `0004`) with the actor
  and the entry's prior values; `audit_event` records nothing else yet.
- **Billing rules** (`src/billing/billingRules.ts`, `src/routes/settings.ts`;
  `client/src/pages/settings/BillingRulesSection.tsx`, `components/BillingRules.tsx`;
  `model/rules.yaml` `apply_billing_rules`; migration `0006`):
  - One agency per deployment, one set of rules. Administrators set each of
    billing codes, time increment, daily hour cap, long entry (warn only)
    and billing period to off, warn or require on Settings; each save is a
    new `billing_rule_setting` row and the latest per rule is in force.
    `rule_code` is one of the rules defined in code rather than a
    `billing_rule_types` reference table. Codes are an administrator-kept
    `billing_codes` list; retiring a code keeps it on invoices that used it.
  - Rules run on every saved draft (shown as findings on the draft and
    import review pages) and again at import confirmation and
    submission, where a "require" finding blocks with its message. The
    daily cap counts the person's time lines on other submitted invoices,
    not other drafts. The submission snapshot stores the settings in force and the
    findings, which staff review and the portal show for submitted
    invoices; a later rule change doesn't alter them.
  - Firms see the rules in force beside invoice entry
    (`GET /api/portal/billing-rules`), and a task code column when codes are
    required or warned on. Hours are flagged, never rounded.
  - Not built: rates by kind of work and other expense rules, such as
    receipts above an amount (see `docs/DECISIONS.md`).
- **Possible double billing** (`src/billing/billingOverlaps.ts`;
  `model/rules.yaml` `flag_overlapping_invoice_period`): `GET
  /api/invoices/:id` returns `billingOverlaps`, and `GET
  /api/portal/invoices/:id` does for a draft (otherwise `[]`), limited
  for a submitter to invoices `portalReadableInvoiceCondition` lets them
  read; staff on the check page see all. Each entry is another sent
  invoice (not withdrawn, rejected or a draft never sent; one sent back
  to its sender counts) with its case number, invoice number, status,
  total, sent time and dates (its period and line dates together; this
  invoice's are taken the same way):
  - `sameCase`: billed by the same professional on the same case (same
    `case_id`, or a close match of its case number, as typed, corrected
    or the case's own) with overlapping dates. Its lines in this
    invoice's dates by the same people are listed; it is listed even
    with none.
  - Another case: listed only when it bills time by a person this
    invoice bills time for on the same date, with those time lines.
  - Each listed line's `sameAsLineIds` names this invoice's lines with
    the same date, person (as the daily hour cap counts them), line type
    and quantity. Lines whose latest recorded decision rejected them are
    left out. Nothing is refused; the client shows it in
    `components/BillingOverlaps.tsx`.
  - Candidates are found through indexed columns first (the invoice's
    professional, `invoice_line_timekeeper_date_idx`, and time entries
    by professional joined on `invoice_line_source_time_entry_idx`,
    migration `0038`); only their lines get the full comparison.
- **Trips, travel and waiting time, and mileage** (`src/billing/mileageRates.ts`,
  `timeCategoryRates.ts`, `routeCheck.ts`, `priceLines.ts`,
  `invoiceLifecycle/replaceLines.ts`, `sameDayTravel.ts`; `client/src/invoiceLines.ts` (trip parts and
  price previews), `components/InvoiceLinesEditor.tsx`,
  `TripFields.tsx`, `TravelLog.tsx`, `pages/settings/MileageRates.tsx` and
  `TimeCategoryRates.tsx`; `model/rules.yaml`
  `apply_mileage_rates`, `apply_time_category_rates` and the mileage
  distance and travel time rules in `apply_billing_rules`; migrations
  `0007`, `0022`–`0025`):
  - The editor's "Travel" kind is one row for a trip: date, From, To,
    Round trip, travel hours, miles and any number of costs. It saves as
    separate lines sharing a `tripKey` (each carries the route), which the
    server turns into one `trip` row with the lines' `trip_id`; the
    trip's date, the first one given, becomes every line's. A trip takes
    at most one time line (its travel time) and one mileage line, plus
    expense lines; a mileage line sent alone is a trip of its own, as
    imports send them. Imports never group lines into a trip. Trips are
    replaced with their lines on every draft save, and frozen in the
    submission snapshot (`records.trip`, layout `0.6.0`). Check the lines
    (`InvoiceSubmission.tsx`) shows each line of a trip as its own row and
    keeps it on its trip; its "Add a line" offers Travel, which adds the
    trip's lines together. Both use `components/TripFields.tsx`. Switching
    a trip to another kind asks before dropping its other parts.
  - Grouping is optional. On Check the lines, a time or expense line on the
    same date as a mileage line offers "Add to that trip" (taking the trip's
    date and route) and a line on a trip offers "Take off the trip"; in the
    editor, a time or expense row on a trip row's date offers to become its
    travel time or one of its travel expenses.
  - A mileage item is an `expense` line with the `mileage` expense type
    (an `expense_types` table seeded with that one code). Its quantity is
    the miles; it's priced as miles × the administrator-set `mileage_rate`
    in force on its date (three decimal places, so
    `invoice_line.billed_rate` and `configured_rate` are `numeric(12,3)`),
    which is also kept as its `configured_rate`, its default. Firms see the
    rate beside entry (`GET /api/portal/billing-rules` carries
    `mileageRates` and `timeCategoryRates`). Imports suggest mileage for
    expense lines described as mileage, taking miles from the quantity or
    a "30 miles" in the description; the extraction result keeps the
    file's own type. Lines create no `expense` record (no table yet).
  - Travel time is a time line on a trip; waiting time ("Waiting time" in
    the editor and Check the lines) is a time line with
    `invoice_line.time_category` `waiting`. Each is priced like other time
    except that its configured rate is its category's `time_category_rate`
    in force (Settings → Rates → Travel time and Waiting time, insert-only;
    migration `0025` renamed `travel_time_rate` and added `category`): the
    hourly rate, a percent of it (rounded to cents) or one flat hourly rate;
    with none, the hourly rate. Their time entries get the `travel` or
    `waiting` activity type: `time_entry` has no `trip_id` here, since
    trips are replaced on draft save (model gap).
  - In review, a line's decision bar is Approve, Part, Rate and Reject
    (design I; Rate only on time, travel time, waiting time and mileage
    lines). Part corrects the hours or the rate, or an expense's amount;
    less than requested is approved in part with a reason. Rate keeps the
    hours and takes a new rate: a higher one is approved at that rate with
    no reason, and the amount may exceed the request; a lower one asks for
    a reason from a short list under the rate. Each line's description,
    kind and person share a "What was done" column, as in I15. A
    changed rate flags the queue row ("Reviewer changed the rate"), and the
    review page lists changed rates above the sign-off panel. The server
    still accepts a lower rate approved with no reason
    (`decide_invoice_lines`), but the page no longer offers it; a lower
    rate needs a reason, such as the rate reason. The review table, the
    decision panel and the decision flag a billed or changed rate that
    differs from the line's `configured_rate`.
  - The travel time and distance rule (off/warn/require, average speed and
    tolerance %) compares a trip's travel hours with its measured driving
    route, else its miles claimed, plus a quarter hour; it makes no lookups.
  - Review shows, per date the invoice claims travel, how many of the same
    professional's other submitted invoices on another case (by case, else
    case number) also claim travel that day, with a link opening their
    person page filtered to that date (`/people/:id?day=`, `GET
    /api/invoices?professionalId=&day=`) in a new tab.
  - The mileage distance rule (off/warn/require, tolerance %) compares
    the miles with the driving route, doubled for a round trip, plus half
    a mile. Distances come from Amazon Location (`Geocode` twice and
    `CalculateRoutes`, Car, no retries, 5-second timeout) when
    `ROUTE_CHECK_PROVIDER=aws`, looked up only on submission with the rule
    on, before the submit transaction. Every lookup is a `route_check` row
    keyed by both addresses normalized and sorted (case, punctuation,
    common abbreviations, ZIP+4 and country words ignored, either
    direction), so a trip is looked up once; errors are retried on the
    next submission and addresses that can't be placed (or only to a
    county, state or country) aren't. Each month's calls are counted: the
    server logs a warning past `ROUTE_CHECK_MONTHLY_CALL_WARNING` (default
    1000) and stops only at an optional `ROUTE_CHECK_MONTHLY_CALL_LIMIT`.
    Only trips with a mileage line are looked up. Saves copy cached
    distances onto those trips without lookups, so drafts show
    findings for trips already measured. An unmeasured trip gives no
    finding.
  - Staff review and submitted portal invoices show a travel log, one row
    per trip (route, travel time, miles claimed, driving route, other
    costs, total and a directions link that opens in the viewer's own
    browser); review lines say "Travel time" or "Travel expense"; exports add
    a travel log table, one row per trip.
  - Stops (`dismiss_mileage_warning`; `src/billing/mileageWarnings.ts`,
    migration `0036`): on review, a trip the mileage rule flagged offers
    "Stops on the way?" in the travel log. The reviewer says what the stops
    were and the warning is set aside (`PUT .../lines/:lineId/mileage-warning`,
    a `mileage_warning_dismissal` row), or put back; the latest row stands.
    Set-aside warnings drop out of the page's mileage warning and are
    listed with who set them aside and why. Refused while an invoice is
    still being entered. Submitters, exports and the queue's rule count
    don't change.
  - Travel time rate (design I): a person's own travel time rate
    (`professional_rate.travel_hourly_rate`, migration `0036`), set like
    their other rates on Add a person and their page, comes before the
    travel time setting and after a case rate (`defaultRates.ts`); the
    portal's price preview uses it too.
  - Gaps: no address autocomplete (it would cost calls per keystroke); one
    trip can't be split across cases; no other expense types are priced;
    a flat travel or waiting rate is general, though a person may have
    their own travel time rate; a kind has no travel time rate of its own.
- **Rates and billing from time** (`src/billing/professionalRates.ts`,
  `priceLines.ts`, `invoiceLifecycle/`; `src/routes/settings.ts`;
  `client/src/pages/settings/KindRates.tsx`, `components/UnbilledTimePicker.tsx`;
  `model/rules.yaml` `apply_professional_rates`, `validate_payment_request`):
  - Administrators (`user_account.system_role_id` = the seeded
    "Administrator" role, which also counts as staff) maintain
    `professional_kinds`, add effective-dated `professional_kind_rate` rows
    on Settings, and set each provider's kind on the Providers page
    (`PUT /api/professionals/:id/kind`; `/api/settings/professional-kinds`).
    Rates are never edited. Staff see kinds and rates; the portal's
    `billable-professionals` carries each billable person's kind rates, so
    everyone who may bill for someone sees their rate (migration `0005`).
  - Every save, import confirmation and submission prices each time line:
    the linked time entry's hours (else the line's) × its `billed_rate`,
    rounded to cents. `billed_rate` is the line's stated `unit_rate` when
    it has one (from an imported file), otherwise the rate for that
    professional's kind on the date, which is always kept as
    `configured_rate` for review's rate check and re-pricing (model 0.5.0).
    A draft may be saved with time that can't be priced yet (it keeps its
    stated amount, or zero); confirming an import and submitting refuse it,
    saying whether the date, hours, person's kind or that kind's rate for
    the date is missing. Submission prices again, so the snapshot freezes
    the rates applied.
  - Gap: the draft API accepts `unitRate` on any line, so a submitter
    editing a draft directly could state a rate; review flags any time line
    whose billed rate differs from the configured one.
  - Invoice entry shows the pricing before saving (client-side previews of
    the same rule): each time item as "hours × rate", a line naming the
    rates in play for the people on the invoice (with "from" dates when
    items span a change), a running total split into time and other items,
    rates beside unbilled time, and on imports the file's total beside the
    billed total (review, the split panel, and the bulk list).
  - Each time line ends up linked to a time entry: picked from the case's
    unbilled time (a new invoice starts with the billed professional's), or
    created on submission from a typed line. A typed time item matching
    unbilled recorded time (same person, date and hours) is flagged with a
    "Bill that instead" link, never merged. A time entry is on at most one
    invoice that isn't withdrawn. On a draft, a linked line edits its entry;
    removing the line leaves the entry unbilled. The case page's Time table
    shows each entry's billing state with a link to its invoice.
  - Gaps: a professional's kind is current, not dated, so a kind change
    reprices drafts but not submitted invoices; no screen grants the
    Administrator role (the demo seed sets it on the demo staff account;
    otherwise set `system_role_id` directly); kinds can't be renamed or
    retired yet; expense and other lines except mileage still take the
    amount entered.
  - Represented professionals see and export the invoice through the
    existing read rule (invoice professional or line timekeeper); they
    don't attest or approve, as decided.
  - Emailed-code sign-in doesn't create a professional profile for a
    delegate, so a delegate logs time only for others.
  - Gaps: no staff screen to grant the delegate role or record office
    membership (only the demo seed does). Delegate authority is read through
    `user_account.person_id`, which the emailed-code bootstrap leaves unset
    even when it creates a professional, so granting the role also means
    linking the account to its person. Assignment is checked as open
    now, not on each line's service date; only the delegate who created a
    draft may edit it.
- **Invoice viewing and export** (`src/billing/invoiceDetail.ts`,
  `invoiceAccess.ts`, `exportInvoice.ts`; `client/src/portal/PortalInvoiceDetail.tsx`):
  - Staff: `GET /api/invoices/:id/export?format=pdf|xlsx` exports any
    non-draft invoice, including reviewer names.
  - Portal: `GET /api/portal/invoices` lists, and `GET /api/portal/invoices/:id`
    and `.../export?format=pdf|xlsx` show and export, invoices the user
    submitted or whose professional or matched line timekeeper is the user's
    own professional (`model/rules.yaml` `authorize_payment_request_export`).
    Anything else is a 404. Reviewer names are left out.
  - Both formats are built from one row set, so they always agree.
    `pdfkit` renders the PDF and `write-excel-file` the spreadsheet.
  - Redaction: one Export Invoice button (`client/src/components/InvoiceExportButton.tsx`)
    opens a dialog with a format dropdown and, under "Redact some invoice
    details", a checkbox per summary field, line column and travel-log column
    (all ticked by default). The server leaves out each
    `group:name` field in `?omit=` (comma-separated; `OMITTABLE_EXPORT_FIELDS`), keeps the totals,
    prints "Redacted copy. Left out: …" and adds `-redacted` to the file
    name. Choices are kept per user account in the browser's local storage
    (`client/src/exportChoices.ts`), so they don't follow a person to
    another browser or device.
  - Exports show the current submission attempt (its chain ID is in the
    summary). Submitted invoices can't be edited, only recalled to an
    unexportable draft, so current values equal that attempt's snapshot.
    Drafts and withdrawn invoices aren't exported. Not supported: exporting
    an earlier, recalled attempt; bulk export. Exports are not audited, as
    decided.
- **Closing a case**: `POST /api/cases/:id/close` (`requireFullUser`,
  `src/cases/closeCase.ts`) is the counterpart to opening
  (`src/intake/createCase.ts`). The case's real status lives in the
  external system, so this is a cleanup: it is refused (409
  `invoices_unfinished`) while an invoice on the case is in review or
  decided and not marked completed; `GET /api/cases/:id` returns those
  counts as `unfinishedInvoices`. Matching a later invoice to the case
  reopens it (`reopenCase`, event `sample_reopened` with the reason
  "Reopened: an invoice was matched to it"), without bringing back its
  ended assignments. Otherwise it requires a reason, records the next
  lifecycle event, projects `case.status_id`/`closed_on`, and ends every
  open `case_assignment` at the closure's effective timestamp (always
  the server's current time — closes can't be backdated) —
  atomically, per `model/rules.yaml`'s `preserve_case_lifecycle`. The
  closing event type and resulting status are server-selected synthetic
  codes (`sample_closed`, mirroring `createCase.ts`'s
  `OPENING_EVENT_TYPE_CODE`) — `case_lifecycle_event_types`/`case_statuses`
  are organization-configurable reference data in the canonical model,
  so (like the opening code) this only exists in `src/db/fixtures.ts`
  (test/dev), not `src/db/ensureReferenceData.ts`; a real deployment
  needs its own configured codes before this (or case creation) will
  work. The rule's "new assignments must begin while the case is open"
  guard lives in `src/cases/assignProfessionalToCase.ts`, which
  share-locks the case row while `closeCase` update-locks it, so a
  concurrent assignment and close can't leave an open assignment on a
  closed case (rejected with 409 `already_closed`). Deliberately not
  implemented: corrections, and reopening by hand (only matching reopens).
- **Demo sign-in**: `POST /auth/demo-login` logs in as the seeded
  synthetic staff account (`staff@example.invalid`, with a faker name)
  with no credentials.
  `POST /auth/demo-login/external` likewise signs in as the demo seed's
  first vendor (`demo-vendor-1@example.invalid`) as an external
  (`email-code`) user, so it needs `npm run seed`, not just the baseline
  fixtures. Both take an optional `userAccountId` from
  `GET /auth/demo-accounts` (`src/auth/demoAccounts.ts`), which lists the
  active seeded accounts on `example.invalid`: staff with their role, and
  `demo-vendor-*` partners with their kind. The sign-in page offers them in
  a dropdown in each panel, so a demo can try each role's view; any other
  account is refused. The seed puts all four demo vendors in one office and makes
  that vendor its billing delegate, so the one demo account shows both
  billing for yourself and for several office colleagues. It also makes the
  demo staff account an Administrator and adds synthetic Attorney,
  Investigator and Expert kinds with rates, giving each demo vendor one.
  `src/app.ts` mounts each by default only when
  `NODE_ENV !== 'production'`; `DEMO_LOGIN_ENABLED` and
  `EXTERNAL_DEMO_LOGIN_ENABLED` (`true`/`false`) override that
  independently. The hosted synthetic-data demo
  (`docker-compose.prod.yml`, `deploy/ec2/`) opts in to both, so anyone
  who can reach it gets full staff access — never enable either where
  real data is stored.
- **Guided tour** (`src/routes/demoTour.ts`, `src/demoTour/`): mounted
  only where both demo sign-ins are on, since a tour plays staff and
  vendor roles. `POST /auth/demo-tour/start` (body: `{ mission }`, one of
  `staff-filing`, `preauth-send`, `review`, `answer-finish`, `sign-off`)
  makes that run's own synthetic material with the same domain functions
  as the seed (a case assigned to the demo investigator, and for some
  missions invoices already sent, reviewed or finished) in one
  transaction, so a failure leaves nothing behind, keeps the run in the
  session cookie, signs in as the mission's first role and returns
  `{ run, suggestions, user, role }`; `suggestions` are values the guide
  offers to fill in, never stored. Starts are limited to 30 an hour per
  address (429 past that). Missions that finish a review or sign off need
  a second demo staff member who may sign off, as the Director; without
  one they are refused (409) rather than started. `POST /auth/demo-tour/switch` (body:
  `{ role }`: `staff`, `director` or `vendor`) signs in as one of that
  run's accounts only. `GET /auth/demo-tour/sample-invoice.pdf` draws the
  run's sample invoice (`drawInvoice` in `src/db/demoUploads.ts`). The
  review mission caches its trip's driving distance in `route_check`, so
  the mileage check never makes a billed lookup, and the tour never
  changes rule settings; the demo seed sets the daily hour cap to warn.
  Each start records a run (`demo_tour_run`) and the cases and invoices it
  made (`demo_tour_record`), with each case's new client; while a visitor's
  session holds the run (until `POST /auth/demo-tour/end`, sent when they
  close the tour, or any sign-in but the tour's own switches),
  `POST /api/portal/invoices`, `POST /api/portal/uploads/:id/draft`,
  `POST /api/preauthorizations/requests`, `POST /api/professionals` and
  `POST /api/cases` (and its client, if made new) tag what they create to it (`tagTourRecord` in
  `src/demoTour/tourRuns.ts`). An hourly sweep in the server process, only
  where the tour is mounted, deletes runs over a day old: their records,
  everything referencing them by foreign key (found from the database's own
  constraints, children first, in one transaction per run), their client
  and person records, audit events about them, and files only they used
  (after commit). It checks first that the run reaches no case, invoice,
  request or person outside it, counting both people in a merge or
  duplicate review; if it does, or removing it fails, the run is kept with
  `kept_reason`, logged, and not tried again, so it never holds up the
  rest. This is the one deletion of history,
  for synthetic tour material on demo servers only (see "Known gaps" in
  `../MAPPING.md`).
- **Routes**: `src/routes/cases.ts` (`POST /`, `GET /`, `GET /:id`) and
  `src/routes/people.ts` (`GET /?q=`, existing-person search, leaving out
  merged-away people; no person is created there). All require a session (`requireAuth`). Async handlers are
  wrapped in `src/routes/asyncHandler.ts` since Express 4 doesn't forward a
  rejected promise to error middleware on its own.
- **Possible duplicate people** (`model/rules.yaml`
  `flag_possible_duplicate_client`, `merge_duplicate_people`;
  `src/people/possibleDuplicates.ts`, `src/people/personMerges.ts`,
  `src/routes/people.ts`), staff only:
  - `GET /api/people/possible-duplicates` lists groups: everyone linked by
    any pair (`src/duplicatePairs.ts`), with the pairs and why. A pair is two
    unmerged people with the same email (theirs or their sign-in's), the
    same name ignoring word order, case, punctuation and initials, or the
    same date of birth and family name, or a pair staff flagged; pairs whose
    latest `person_duplicate_review` is `not_duplicate` are left out. Each
    person comes with their provider profile, sign-in email and case and
    invoice counts.
  - `POST /api/people/possible-duplicates` (`{ personIds, outcome:
    'possible_duplicate' | 'not_duplicate', note? }`), any staff member,
    adds a review row; the pair's latest one stands.
  - `GET /api/people/merge-preview?keep=&retire=a,b`, any staff member, runs
    the merges in a transaction and rolls it back, so it reports exactly
    what merging would do: for each record in turn, what moves (counts by
    kind of record), which of the kept record's empty details it fills in,
    what it leaves behind, and what blocks it. `case.client_id` moves with
    the client's role but isn't listed, as it copies that role.
    `GET /api/people/merges` lists the latest 20.
  - `POST /api/people/merges` (`{ keptPersonId, retiredPersonIds, note? }`)
    and `POST /api/people/merges/undo` (`{ personMergeIds }`, undone last
    first), administrators only, each all or none. A merge locks the people
    and their profiles and merges each record in turn as its own
    `person_merge`, refusing with `merge_blocked` if any is blocked. It
    moves each reference to the retired person to the kept one; if only the
    retired person has a provider profile, that profile moves whole, and if
    both do, everything naming the retired profile moves to the kept one,
    its sign-in too when the kept profile has none, and the retired profile
    is made inactive. Own rates, fee schedule and invoice reviewer move only
    when the kept profile has none. Every changed value goes in
    `person_merge_change` in order; an undo writes each back, last first,
    only where it is still as the merge left it, and reports how many were
    left as they are. Merged-away people are left out of the people and
    provider lists, person search, email-in-use checks and sign-in matching
    (`ensureProfessional.ts`).
- **Possible duplicate cases** (`model/rules.yaml`
  `flag_possible_duplicate_case`; `src/cases/possibleDuplicateCases.ts`,
  `src/routes/cases.ts`), staff only and never merged:
  `GET /api/cases/possible-duplicates` groups open cases whose numbers or
  identifiers share `closeKey` (`src/billing/caseNumbers.ts`), plus flagged
  pairs, leaving out pairs found different (`case_duplicate_review`) and any
  pair whose counties are both set and differ (a matching county is reported
  as `same_county`); `POST /api/cases/possible-duplicates` (`{ caseIds,
  outcome, note? }`) records a review of two open cases, refusing to flag
  two in different counties. Closing a case takes it off the list.
- **Indexes**: FK columns used as query filters/joins
  (`case.county_id`/`status_id`/`case_category_id`,
  `case_participant.case_id`, `case_identifier.case_id`) have plain B-tree
  indexes in `src/db/schema.ts` — Postgres doesn't create these
  automatically, and the existing unique indexes on those tables are
  partial (`WHERE ended_at IS NULL`, `WHERE is_primary`) so they don't
  serve a plain lookup. `GET /api/people`'s `ilike` search on
  `person.display_name`/`email` has no supporting index (a `pg_trgm` GIN
  index would be needed, since leading-wildcard `ilike` can't use a plain
  B-tree) — deferred since the person table is a handful of seeded rows in
  this scope; revisit if that search becomes real-data-sized.

- **Long lists** come a batch at a time (`src/lists/batches.ts`): the queue
  and its pages, cases (`GET /api/cases`, with `/counts` and `/overview`),
  people (`GET /api/professionals/people`), providers (`GET
  /api/professionals`), person search (`GET /api/people`), pre-authorization
  requests and a sender's invoices (`GET /api/portal/invoices`). Each takes
  `limit` (50 by default, at most 200) and `after`, and returns `{ items,
  next }`, `next` being `after` for the following batch or null after the
  last; the first batch adds a `summary` with what the page shows of the
  whole list (counts, county counts, totals). Order is fixed per list and
  ends in the row's id, and `after` holds the last row's sort keys as exact
  text, so rows added meanwhile never repeat or shift. Filters, counts and
  sorting are the server's; a filter only code can apply (the queue's "Has a
  flag") reads on until the batch is full and has no count. An id parameter
  that isn't one is refused, never read as no filter. Lists bounded by the
  work itself stay whole: Intake, possible duplicates, a sender's cases and
  bulk imports. Connections run with `jit=off` (`src/db/client.ts`): JIT
  compiling these queries took hundreds of milliseconds against tens to run.
