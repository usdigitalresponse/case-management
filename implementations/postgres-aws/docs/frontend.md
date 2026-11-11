# Frontend design notes

How the React client is built and why. Schema mapping and gaps are in
[`../MAPPING.md`](../MAPPING.md); the API and sign-in are in [`api.md`](api.md).

- **Invoice review beside an external case management system**
  (`docs/DECISIONS.md`; design tokens and layout from the invoice review
  design): the staff app opens on the review queue, not the overview.
  - `/` is the queue filed by person (design G,
    `client/src/pages/InvoicesToReview.tsx`): everyone's invoices by
    default (`?show=mine`, `unassigned`, `flagged` for the rest), each led
    by who sent it, with its case number as typed and how many other sent
    invoices share it exactly or closely. The header search filters it by
    name or case number, however the number was typed. The earlier queue,
    led by case and client and showing the signed-in person's invoices by
    default (`client/src/pages/ReviewQueue.tsx`), is at `/home-alternate`
    ("Queue by case" in the sidebar). `/finished` lists approved and
    rejected invoices; `/exports` lists signed-off invoices to export.
  - Filed by person (design G, G4–G10): the staff sidebar's "+ Upload
    Invoices" (`/upload`) and the portal's Upload invoices
    (`/portal/upload`) both open `client/src/pages/UploadInvoices.tsx`,
    which asks first, above both the drop zone and "Enter an invoice by
    hand": of staff, how it arrived and the date received, and who billed
    it ("Billed by": the attorney or provider whose work it is, whose rates
    price the lines; asked of staff, and of a submitter who acts for
    others, a submitter acting for no one else billing it themselves). The
    choices list people as "Last, First: Role", sorted by last name (the
    name's parts where kept, else its last word as the last name). A
    file's suggested sender fills "Billed by" while it is empty; with
    several files each may be billed by someone else ("Same as above"
    otherwise), and a file suggesting someone else starts on them, shown
    there even when it is the only file. Continue
    goes on, and "Enter an invoice by hand" goes straight on; either marks
    a missing field where it is instead. Each file then becomes a draft
    with no case and what was read: its case number (read from the file
    when labeled, by `server/src/billing/caseNumbers.ts`
    `readCaseNumber`), county, billing period and invoice number. Those are
    edited above the lines (`client/src/components/InvoiceDetailsFields.tsx`;
    `PUT /api/portal/invoices/:id/details`, or
    `/api/invoices/:id/entered-details` while entering in review;
    `server/src/billing/uploadDetails.ts`). An invoice started with no
    sender, or not saying how it came in, is asked there instead (`/sender`
    or `/entered-sender`, which prices the lines at their rates and moves
    lines given to an earlier choice to them). Each draft is checked next (`portal/InvoiceSubmission.tsx`:
    staff at `/invoices/:id/check`, submitters at `/portal/invoices/:id`,
    where any invoice not filed under a case is shown this way), except that
    a reviewer's upload goes straight into their own review instead (see
    "Entering in review" below). The case
    number sits in a box above the file and lines (`PUT
    /api/portal/invoices/:id/case-number`). When the file labels one ("Case
    No. …"), the PDF reader records that row's position
    (`extraction_result.invoice.case_number`, `textLayer.ts`
    `caseNumberIn`), and while the box holds that number the file opens
    highlighted there, as when a line is clicked (G8). Sending without one is refused
    (`filedByPerson` on submit). An invoice with a typed case number goes to
    review without a case, for submitters too (`needsMatching` in
    `server/src/billing/proposedDetails.ts`). Who billed it is required to
    send or finish (staff choose or add someone, with their role; a
    submitter acting for others chooses among them). Who did the work is still matched from
    the file's timekeeper names; a line matching no one falls back to the
    person most of the invoice's other lines matched, else the sender, when
    the draft is made and again on sending (`billing/timekeeperFallback.ts`).
    So every invoice filed by person goes to review, and none waits on
    Intake. A submitter's true-and-correct statement names the
    case number (`attestationStatement`), and the receipt email shows it.
    Several files are checked one after another, by staff and submitters
    alike. With no file, or when none could be read, "Enter an invoice by
    hand" makes an empty draft filed the same way. Changing the sender re-runs
    the file's duplicate checks for the new sender
    (`server/src/imports/duplicateWarnings.ts`), shown in the panel; editing
    the invoice number does not, as they compare numbers read from files.
    A reviewer may give a sender who has no role theirs from the panel
    (`professionalKindId` on the sender save), which prices the lines; only
    administrators change a role once set. "+ Add new person" (and "+ Add
    new case", in every picker) opens one line under the fields: first and
    last name (kept as the person's parts and joined for the whole name),
    an optional email and a role. On the upload page they are added only
    when it goes on, before the invoice, and reused if that then fails. In
    the check and review panel, for an invoice still without who billed
    it, they are added once a name and role are given; the row stays open,
    and while nothing lasting names them, it corrects that same record,
    their role included (`PUT /api/professionals/:id/details`,
    `server/src/professionals/correctNewProfessional.ts`), the lines priced
    again. An
    administrator removes someone added by mistake from their page under
    People (`DELETE /api/professionals/:id`,
    `server/src/professionals/removeProfessional.ts`), refused once
    anything lasting names them; unsent drafts and open entries naming them
    are left with no one chosen. The typed number is `invoice.case_number_as_typed`
    (migration `0020`), never checked against cases; close matches ignore
    case, spaces, dashes and leading zeros. Intake's own drop zone and
    manual entry still open the case-based upload
    (`client/src/portal/PortalUpload.tsx`).
  - The rest of design G (G13, G15–G24):
    - **Sidebar**, as G: To review, Assigned to you, Finished; People, Exports; the external
      system link. It keeps "+ Upload Invoices" and, for administrators, Settings. Design I
      adds a Cases group (Case overview, All cases with the open count) and Providers, Clients
      and Organizations; Intake and the case-led queue are off it but work by address. A staff
      member's unsent drafts lead To review (from `GET /api/invoices/intake`), with a notice
      linking to Intake if anything is ever held there.
    - **People** (`/people`, `client/src/pages/People.tsx`) replaces Cases and Providers in the
      sidebar. It lists everyone who can send invoices, with their role, who they are paid
      through, today's approved rate, what is waiting and their last invoice
      (`GET /api/professionals/people`, `server/src/professionals/peopleDirectory.ts`).
    - **Add a person** (`components/PersonDialog.tsx`) takes a name, role, email, phone, paid
      through, an approved hourly rate and a mileage rate. They can sign in with that email
      straight away.
    - **A person's page** (`/people/:id`, `pages/PersonPage.tsx`) has their details, this year's
      totals, every invoice they sent and an export to CSV. Administrators edit details there;
      a changed rate starts today.
    - **Per-person rates** (`professional_rate`, migration `0021`) replace the role's hourly rate
      and the general mileage rate from their effective date. Earlier work keeps the earlier
      rates (`professionalRates.ts` `ownFirst`). Rate checks and the decision reason say
      "approved rate" (G16).
    - **Default reviewer per person** (`professional_invoice_reviewer`): "Send new invoices from
      [person] to [reviewer] too" in the reviewer menu (G18). On submit, the case's reviewer
      comes first, then the person's, then the general default.
    - **Review page** (G15): an invoice with no case is led by the person who sent it. A
      reviewer can correct its case number; the sender's stays as typed
      (`invoice.case_number_corrected`, audited as `case_number_corrected`;
      `billing/correctCaseNumber.ts`). Matching, the attorney's view and exports use the
      correction. Beside it are an inert "Search your [external system]" link, the match
      counts and "See all invoices with this case number". The facts show the person's
      approved rate.
    - **Cases on review** (design I; `match_invoice_to_case`): below the case number box,
      "Match it to a case" lists cases whose number, or any other number they have, matches
      the invoice's exactly or closely (`GET /api/invoices/:id/case-matches`,
      `server/src/cases/casesByNumber.ts`; `client/src/components/CaseCard.tsx`). Matching
      uses the intake match (`POST /api/invoices/intake/:id/case`), which now also takes an
      invoice filed by person while its lines are reviewed: it sets the case, adds the
      sender to it and records `matched_to_case`, but doesn't price lines again. "Add a case
      for [number]" opens the new case page with that number, then matches the invoice and
      returns to it. Every review page is titled with the sender, as in I15; a matched
      invoice then has a case card: "Client · case number", the number the invoice gave,
      one line with the pre-authorized amount and what's approved so far, and "Open the
      case". A mileage line over the driving route is highlighted in the line table with
      the route and the miles over, as in the travel log (I20). Case rates that would now apply are flagged as
      changed since it was sent (`caseRatesChangedSince`).
    - **Pre-authorized amounts**: any staff member sets one on the case page, for a person
      or the whole case (`POST /api/cases/:id/preauthorizations`,
      `setPreauthorizedAmount` in `billing/preauthorizations.ts`): the first is an approved
      `preauthorization` with its first decision, a change a `revised` decision keeping its
      hourly rate. An amount below what is signed off so far is refused. An invoice whose
      total, with what is approved and waiting, goes over the limit is flagged on its page
      and in the queue (`overPreauthorization`), with ", not explained" when no overrun
      explanation was given. Gap: "approved so far" sums signed-off invoices, as before,
      not authorization draws.
    - **Pre-authorization requests** (`model/rules.yaml` `request_preauthorization`,
      `apply_preauthorization_limit`, `explain_preauthorization_overrun`,
      `request_provider_documents`, `report_preauthorization_usage`; migration `0037`):
      - Thresholds (`billing/preauthorizationThresholds.ts`, Settings "Pre-authorization
        thresholds"): administrators add a default and per-county amounts from a date, and
        tick the professional kinds they apply to (`professional_kinds.threshold_applies`).
        A bound provider with no pre-authorization on a case has the case county's
        threshold, in force today, as their limit (`PreauthorizationSummary.source
        'threshold'`; the case list's pre-authorized total leaves these out).
      - Requests (`billing/preauthorizationRequests.ts`, `routes/preauthorizations.ts`):
        submitters ask from the portal's Pre-authorizations tab for a case they or someone
        they bill for is on, naming a provider on their cases or typing one (proposed
        details, as for invoices); staff record emailed ones from the staff
        Pre-authorizations page with how and when they arrived. Each gets `YY-NNN` on
        receipt. The form previews the limit and says when the total is within the
        threshold. Staff ask questions (recorded once), match a proposed case or provider,
        and decide once: approved (a `recordCeilingInTx` decision on the provider's single
        pre-authorization; ceilings replace), denied, not needed, duplicate or moot, each
        but approval with a reason the requester sees. Requesters answer and withdraw.
      - Overruns (`billing/overrunExplanation.ts`): sending an invoice with a case that
        takes its provider's approved, waiting and new total past their limit needs an
        explanation from a submitter (`SendDialog` shows the field; staff may record one);
        it is stored with the attempt, shown on the review page's case card and never
        exported. Invoices filed by person without a case are not checked when sent; once
        matched they are flagged with no explanation, and reviewers ask with a line question.
      - Provider documents: CVs, fee schedules and quotes are `document` rows linked to the
        professional by `document_link` (PDF, .docx, PNG or JPEG), kept while the provider
        is on record, unlike invoice working copies; the fees they list are
        `provider_service_rate` rows. Shown on a person's page and on each request.
      - Usage by county (`billing/preauthorizationUsage.ts`, the page's "By county" tab):
        requests received in the period by status and amount, then each provider's limit,
        billed and over on cases with a request or invoice in the period, by the case's
        county, with a CSV download. Each count opens the filtered request list.
    - **Search** (`/search`, `pages/SearchResults.tsx`, G24): the header search covers every
      sent invoice by name or case number, with exact and close matches listed and totalled
      apart, and an export to CSV. The queue no longer filters in place.
    - **County** (`model/rules.yaml` `record_case_county`; `server/src/cases/counties.ts`,
      `client/src/components/CountyPicker.tsx`): filed by person, an invoice carries its
      case's county (`invoice.county_id`, migration `0031`) beside its case number; one
      under a case shows the case's unless it has its own. Every county picker (upload
      and manual entry, the check page, entering in review, the reviewer's case number
      box, and new case intake) matches as the person types and lists `is_county` false
      settings first; Post-conviction and Prison are added in every environment by
      `ensureReferenceData`. Typing a county not listed offers "+ Add … as a new county",
      added when the choice is saved; a name matching one already there (ignoring case,
      spacing, punctuation and the word "county") reuses it, a retired one is refused
      rather than reactivated, and each addition is an `audit_event` (`county_added`).
      `ensureReferenceData` also makes a county typed as "Prison" or "Post-conviction"
      before then a setting. Uploads suggest one from the file (`readCounty`): a
      labeled "County:" (up to four words, stopping at a wider gap) first, then a
      setting the file names that no item mentions (so a prison visit on one line
      doesn't count), then a listed county, then a new one only where a court is named
      with it ("Court of X County", "X County … Court") or "County of X", so a client's
      name before "County" isn't taken. The sender sets it on a draft (`PUT
      /api/portal/invoices/:id/county`), the reviewer while entering (`PUT
      .../entered-county`), and after sending a line reviewer changes it (`PUT
      /api/invoices/:id/county`); each change names a county or sends `countyId: null`,
      and an empty one is refused. Each returns the county the invoice now shows, so
      clearing an invoice's own county under a case shows the case's again. A change
      after sending that alters the county shown is audited as `county_changed` with the
      one shown before and the invoice's own. Exports' summary and the billing record have a County. Every staff list
      of invoices (To review, Finished, Search, a person's page, Exports, the case-led
      queue) shows the county under the case number, and the Cases list has a County
      column. Each has one County control (`components/CountyListControl.tsx`): All,
      All grouped by county (settings, then counties, then none, each keeping the
      list's order), one setting or county, or No county, with counts. It works on what
      the page's other filters show; on Search the totals and export follow it. Gaps: counties
      a submitter adds are offered to everyone straight away (staff review is an
      open decision); there is no screen to rename, hide or merge counties; the
      county isn't highlighted on the file as the case number is.
    - **Finished** (`/finished`, `pages/FinishedInvoices.tsx`, G20) leads with the person, with
      chips for This month, Waiting for sign-off, Decided and Completed. The case-led version is at
      `/home-alternate/finished`.
    - **Completed** (`model/workflows.yaml` `requester_communication`): once staff have told
      the sender about the decision, any staff member marks a decided (approved or
      rejected) invoice completed with "Mark completed", on the invoice page or in any staff
      table's Status column (`components/Completion.tsx`; `POST /api/invoices/:id/complete`,
      `markCompleted` in `billing/reviewRounds.ts`). It records a `communication_completed`
      invoice event and leaves the status unchanged; `completedAt` is that event's time while
      the invoice is approved or rejected. Submitters' views and exports never carry it, and
      the billing record's "Status changed" ignores it. Gaps: there is no undo; who marked it
      is recorded but not shown; nothing yet decides an invoice again, so a marking is never
      reset to pending as the model requires.
    - **Email sender** (`components/EmailSender.tsx`) opens a draft in the staff member's own
      mail app from the invoice page's actions, the waiting-for-an-answer notice and the
      completion notice. It goes to the sender's account email, or for a staff upload to
      whoever billed it (`loadSenderEmail` in `billing/invoiceDetail.ts`), else to no one.
      Its subject carries the sender's invoice number, the case number shown on the page and
      the period (else the date it was sent or received); its body repeats the case number.
      From the waiting-for-an-answer notice the body adds each unanswered question under its
      line's date, kind, description, quantity and amount; a mail icon beside "Ask … about
      this line" drafts the same for that line, without a question. These are drafts the
      staff member chooses to send, not exports. Nothing is sent or recorded by this system.
      A person's page links their email the same way.
    - **Time log check** (`model/rules.yaml` `check_lines_against_time_log`): "Check a time
      log" on the invoice page takes one case's CSV or XLSX export from the external case
      management system (`PUT /api/invoices/:id/time-log`, raw body as for uploads;
      `billing/reviewTimeLog.ts`). `imports/readTimeLog.ts` finds the header row in the top 10
      rows and the columns by header, scoring likely names; time spent may be hours or
      minutes. The summary says which columns were used, and "Change columns" re-reads the
      kept cells. `billing/timeLogCheck.ts` compares in memory on each page load, so edits
      while entering are compared at once. Each line gets a "Time log" column; "Link entries"
      saves the reviewer's choice by row; "Show the log" puts the entries beside the lines in
      place of the file, also while entering, and a "The file | Time log" switch above the
      panel flips between them. Settings' "Time log checks" (`invoice_review_setting`
      `time_log_blocks_approval`, off by default) makes Approve on a flagged line, and
      approving in part without cutting its hours, ask why; the reason is saved as
      `time_log_override` on the working decision, recorded with the round, shown to staff
      only and never exported. It is enforced in `reviewInvoiceLine` and `finishReview`, and
      repricing every line leaves flagged lines undecided. `review_time_log` keeps the
      cells, not the file, and is deleted on finishing, recall, deletion or "Remove it".
      Gaps:
      dates typed as text with slashes are read month first (`04/03/2026` is April 3), so in a
      log written day first, days 1–12 are read with day and month swapped and later days
      are unreadable; real date cells, ISO dates and written-out months are unaffected, and
      neither detecting the order nor letting the reviewer choose it is built yet; the
      column chooser can't pick a different header row; apart from override reasons, nothing
      about the check is kept for approvers once the round is finished. Seeded test logs: `npm run demo-time-logs`.
    - **The attorney's decided invoice** (G13) shows asked for, approved and cut, the line
      counts, and "Download the decisions".
    - Gaps: reviewer names stay hidden from external users, against G13, until that rule
      changes. "Paid" waits on payment records. The old person search moved to
      `/person-records`.
  - Hidden, not removed: the case page's lifecycle history is off the page
    but its code remains (design I put Case overview, People, Clients and
    Organizations back in the sidebar). Closing is at the foot of the case
    page ("Closing the case here"), only once its invoices are finished. Cases come in
    with their invoices (design I): a case is added only while matching an
    invoice ("Add a case for [number]", or on Intake), which adds its
    sender too, so the case pages have no Add case or Add person
    (`AddPersonToCase.tsx` stays, unused).
  - Links to the external case management system ("Open the case in…",
    the sidebar link) are disabled placeholders; nothing is integrated.
  - Staff "Intake" (`/intake`, off the sidebar since design G;
    `client/src/pages/InvoiceIntake.tsx`) is one page for invoices a
    professional sent by email or from another tool (`model/rules.yaml`
    `authorize_staff_invoice_entry`). It starts the same way as external submitters: dropping or
    choosing files opens the upload (`client/src/portal/PortalUpload.tsx` at
    `/portal/upload`) with them, and "Enter an invoice by hand" opens its
    manual entry. There the case list offers every open case with an
    assigned provider, a new case, or none yet with an optional "From"
    provider; one held with no case waits under "Waiting for a case".
    One file goes on to the import review page to check its lines; several
    return to Intake with a banner. The older bulk import page
    (`/portal/imports`) is no longer linked but still works. "Waiting for a
    case" and "Drafts to finish" follow below. The old staff
    `/new-invoice` redirects here. It reuses the portal's pages at the same
    paths (`/portal/upload`, `/portal/imports/:id`, `/portal/invoices/:id`);
    `portal/useShell.ts` switches the few links that differ, such as the
    case page and where "back" goes, using `isStaff` from `/auth/me` (the
    server's `isStaffAccount` role check, not the sign-in method). Staff-only
    receipt fields come from `portal/ReceivedFields.tsx` `useReceipt`, and
    every billing entry point checks `portalActor.ts` `authorizeBilling`. Any active
    staff role may bill any professional assigned to the case:
    `server/src/portal/portalActor.ts` treats a staff account as
    representing every assigned professional, so time, invoice, import and
    case-list checks all apply unchanged. Submitting requires how and when it
    was received (`invoice.received_via_id`, `received_on`;
    `server/src/billing/invoiceReceipt.ts`), and queue waiting time counts
    from `received_on`. Staff finish their drafts on Intake; a submitted
    one links to its review page.
  - Intake's "Waiting for a case" (`server/src/billing/invoiceIntake.ts`)
    lists staff drafts with no case (migration `0012` makes
    `invoice.case_id` and `invoice_line.case_id` nullable) and caseless
    imports still being read (`model/rules.yaml` `match_invoice_to_case`).
    "Billing for" may be left blank (migration `0013` makes
    `invoice.professional_id` nullable); Match then asks "From" and
    reprices the time. With no case, any active professional can be chosen
    and there is no unbilled-time picker. "Match to a case" (`POST
    /api/invoices/intake/:id/case`) sets the case on the invoice, its lines
    and its import, and who did the work on lines naming someone not listed
    (`timekeepers`, by line), records `matched_to_case`, and with
    `addMissing` assigns missing providers as external submitters. Its
    case, "From" and per-line pickers can add a case or provider on the
    spot (below); "Add the case with all its details instead" opens New
    case with `?intake=`, which matches after creating it.
    A held file's draft keeps the case and professional its reading
    suggested (`invoice_import.suggested_case_id` and
    `suggested_professional_id`, migration `0017`, by the upload rules
    below), and Match starts with them selected, marked "Named in the file:
    check it", while the case is open and the provider active.
    The invoice page's "Review without a case" submits with `withoutCase`;
    then no time entries are created, the default reviewer applies (no
    per-case reviewer), pre-authorization and case-rate limits are skipped,
    and the queue (`no_case` flag), review page, exports and billing record
    warn. Adding a provider (`POST /api/professionals`,
    `server/src/professionals/addProfessional.ts`) creates a person and
    professional with no account (`add_professional_without_login`);
    `ensureProfessional.ts` links it on first sign-in by email.
  - Adding what isn't listed (`model/rules.yaml` `match_invoice_to_case`):
    every case and person picker is `client/src/components/PickOrAdd.tsx`,
    whose first option adds one, showing its fields
    (`components/NewEntryFields.tsx`; the type-ahead searches on New case
    offer it first too). Nothing has to be
    chosen to continue: what isn't known waits on Intake. A submitter's
    entry is only details on the invoice (`invoice.proposed_case`,
    `proposed_provider`, `invoice_line.proposed_timekeeper_name`, migration
    `0018`, and `proposed_timekeeper_email`, `0019`; `server/src/billing/proposedDetails.ts`), kept after matching
    and flagged "entered by the submitter" on Intake, their own page, the
    review page and line tables. Staff create the record instead: a
    provider through `AddProvider` inline (on an invoice with a case, also
    assigned to it: `useAddedProviders`, used by "Billing for", the line
    pickers and "Set work done by for several items"), a case through `POST /api/cases`
    with `newClient` and `caseNumber` (kept as `external_reference`),
    refusing an email or name already in the system unless confirmed as
    someone else, and an existing case number. On the upload and manual
    entry, a staff member's new case is created on continuing once whom it
    bills is known, and the invoice matched to it; otherwise its details go
    with the invoice to Intake. Naming someone not listed on one line
    offers to use them for every other item. Sending an invoice whose
    case, provider or any line's worker is still unknown
    (`invoiceLifecycle.ts` `submitInTx`) attests as usual but sets status
    `awaiting_match` ("Waiting for its case") with a `sent_for_matching`
    event, pricing strictly first when its provider is known; import
    confirmation no longer needs every line matched, keeping a named but
    unchosen timekeeper as `proposed_timekeeper_name`, and prices strictly
    only once nothing is left to match. Intake lists these as "Sent by the
    submitter"; matching the last of them releases it to review
    (`releaseToReviewInTx`, `released_to_review` event): time entries,
    strict pricing, rules, snapshot and routing run as on submission, and
    the attestation is recorded with the sending time. The submitter may
    recall it to draft until then; exports skip it. Staff may instead send
    any of these back (`POST /api/invoices/intake/:id/return`, a reason
    required; `returnToSubmitter`): it returns to draft with a
    `returned_to_submitter` event holding the reason, and the latest such
    event's reason (`invoiceEvents.ts` `returnedReason`) is shown on the
    invoice, as a red "Needs changes" status, and under "Needs your
    changes" at the top of Your invoices, until it's sent again. Intake's
    held drafts are only those staff entered, so a returned or unsent
    submitter's draft stays theirs. With no case, a
    submitter may bill themselves or those they act for
    (`billableProfessionalIds`), and anyone who may bill on a case may leave
    its provider unknown.
    Gaps: only the staff member who entered a draft can submit it; a
    request whose lines fail strict pricing at release (e.g. a time line
    with no hours for someone new) is matched but stays waiting, with the
    reason shown, until staff send it back; the inline new case takes only the
    client's name and email, the case number, role and status (the rest is
    added on the case page; an existing client is chosen on New case); a
    one-person file split across cases
    needs a case for every line; added assignments start on matching,
    which passes because assignment is checked as of now, not on each
    line's service date (as for delegates, below).
  - The external portal follows the invoice submission design: one top
    bar (the brand, design I's tabs Your invoices, Your cases and Import
    invoices, which opens the several-files import at `/portal/imports`,
    the signed-in email and Sign out; `PortalTopBar.tsx`), no
    sidebar, opening on "Your invoices" (`/portal/invoices`, which `/`
    redirects to; `PortalInvoiceList.tsx`). Drafts and sent invoices share
    one list, in the review side's words: "Draft, not sent" (with "Lines
    not checked yet." while its import is unconfirmed), "Waiting for
    review", "Being reviewed" with the assigned reviewer's name, and
    "Decided" with the approved amount and lines cut. As in design G (G3,
    G6) the list has no search, filter or sort: drafts come first, then
    the most recently sent (`portal/invoiceListView.ts`). Each row leads
    with its case number (as typed, else its case's or one entered for a
    new case), with no client column; a draft with none says "Not added
    yet" and "No case number yet." in amber. Withdraw (the recall
    transition, behind a confirmation dialog) shows only to the sender
    while the invoice waits for review. "Upload invoices" opens the portal
    upload (`/portal/upload`, see "Invoice import" in `api.md`). Pages
    outside the design are out of navigation but still reachable:
    "New invoice" (`/new-invoice`, `PortalNewInvoice.tsx`: the bulk import
    page or the case page's new-invoice form, `portal/NewInvoiceForm.tsx`).
    The import page (`PortalBulkImport.tsx`, I44) uses the upload's drop
    zone and design I's words (Add files, Check each file, Send). The upload
    asks a sender who bills for a few people "Whose work is it?" as choices
    (I43), a dropdown past six, and points to the Upload invoices tab for
    several files.
  - "Your cases" (`/portal/cases`, design I) lists the open cases of the
    people the sender bills for, grouped by person for a delegate ("Name,
    kind", under a note naming whom they send for), with
    each one's own pre-authorized amount and approved so far (never a
    whole-case amount, whose approved total includes other providers') and
    any draft. Its cases are those staff matched their invoices to, which
    adds them to the case, or assigned them to; nothing is entered for
    the list alone. A case's page lists its invoices. Senders don't log
    time here: it is kept in the external system, so the time section and
    the case page's new-invoice form are hidden (`SENDERS_LOG_TIME` in
    `PortalCaseDetail.tsx`), not deleted.
  - On the check page, "Which case is it?" offers the cases of the person
    whose work it is, or "Not listed" to type the number as before
    (`CaseChoice` in `InvoiceSubmission.tsx`). Choosing one
    (`PUT /api/portal/invoices/:id/case`, `setDraftCase` in
    `billing/invoiceLifecycle.ts`) sets the draft's case and its number to
    the case's and prices its lines again, so case rates apply; it is still
    sent as filed by person and goes straight to review with its case.
    An invoice opens on its own page (see "Checking the lines" and
    "Sending" under "Invoice import" in `api.md`); a draft's row says what
    the submitter changed from the file so far. Gap: the design's "Paid"
    status waits on external completion records, which aren't built. Staff
    open portal invoice pages from Intake in their own shell, where the
    older draft editor (`PortalInvoiceDetail.tsx`) still applies.
- **Design system**: color roles, type roles, spacing, radius and elevation
  follow the team's Figma design system, itself built on a Keystone-style
  role scheme, and keep its names (`--color-primary`,
  `--color-on-*-container`, `--title-small`, `--space-6`…) in
  `client/src/styles/tokens.css`. IBM Plex Sans and Serif are self-hosted
  through Fontsource, so no font request leaves the app. Body text is 13px,
  tables included. Page titles are Headline/Medium (26px) on list, queue
  and upload pages (`PageHeader`/`PageHeading` `list`) and Headline/Large
  (32px) on single-record and settings pages. Dates read day, short month, year ("3 Aug 2026",
  `src/formatDateTime.ts`). USWDS's stylesheet is not loaded: the few of its
  rules the pages rely on are in `styles/reset.css` and `styles/controls.css`,
  and `@trussworks/react-uswds` still renders form markup. How the Figma
  components map to code, and what to change for a new design system, is
  under "Changing the design system" below. Every font size, margin, padding, gap,
  radius and color in `styles/` is a token; line heights, letter spacing and
  widths are still literal. Gaps: alert icons are not built, and the gold
  used for focus rings and for missing or flagged markers is under 3:1
  against white, short of the non-text contrast minimum; it stays as
  specified until the design changes it.
- **Case overview** (`/overview`, in the sidebar's Cases group since design
  I): four stage cards (Needs assignment, Represented, Billing, Closing),
  each with its count and up to three cases, then "Recently changed". Cases
  are bucketed by their derived stage (`server/src/cases/caseStage.ts`;
  see the case pages in `intake.md`). A case is never started here: cases
  come in with their invoices. Each card's "View all" goes to
  `/cases?stage=<id>`, which `client/src/pages/CaseList.tsx` filters to that
  stage. The sidebar
  condenses on small screens and columns wrap into a vertical layout. The
  header's `Messages`/`Timer` placeholders and "Search everything" box
  were removed outright (disabled controls with no planned near-term
  feature).
- **Lookup directories**: the sidebar's People (`/people`), Clients
  (`/clients`), Providers (`/vendors`; attorneys, experts and vendors), and
  Organizations (`/organizations`). People and Providers share
  `client/src/components/SearchDirectory.tsx` (search box + results table):
  - People and Providers hit a server search endpoint (`GET /api/people`,
    `/api/professionals`, both `requireFullUser`); Clients and
    Organizations are built from `GET /api/cases` and reference data (see
    Look-up pages below). People requires a query first (the person table
    could be large); Providers loads everything up front (a small table).
  - `GET /api/professionals` (`src/routes/professionals.ts`) used to
    return `[]` without a query and was otherwise unused by the client;
    it now also backs the Providers list, listing everyone when no query is
    given; its Add button uses the same form the pickers add providers with
    (`client/src/components/AddProvider.tsx`, `POST /api/professionals`).
    Administrators also get "Edit", in the row itself (`PATCH /api/professionals/:id`,
    `src/professionals/editProfessional.ts`): the name, and the email of
    someone who hasn't signed in (refused if in use,
    `src/people/emails.ts`), so one added without an email can get it later
    and be linked on first sign-in. The replaced values are kept as a
    `professional_changed` `audit_event`. It excludes professionals created for internal staff
    (`src/cases/assignStaffToCase.ts` lazily creates one on first staff
    assignment) via the same staff-account system role
    `src/routes/staff.ts` filters on — otherwise a staff member assigned
    to a case would show up as a "vendor."
  - Organizations has no new endpoint: `GET /api/reference-data` already
    returns the full organization list (small, unpaginated), so
    `OrganizationsDirectory.tsx` just filters that client-side, the same
    way `CaseList.tsx` filters its own full case list.
  - Reports has no backend at all and stays disabled.
- **Reference-data endpoint**: `GET /api/reference-data` returns every
  lookup list the intake form needs (statuses, categories, roles,
  jurisdictions, languages, identifier types, counties, organizations,
  offices) in one response, rather than one endpoint per table — none of
  this data is large or paginated, and the form needs all of it together.
- **Display names joined server-side**: `GET /api/cases` and
  `GET /api/cases/:id` left-join `person` to include `clientDisplayName`/
  `personDisplayName` alongside the raw `person_id` — added specifically so
  the client shows a readable name instead of a UUID (the Faker-generated
  synthetic names are otherwise invisible in the UI).
- **Type-ahead pickers**: the person picker (`NewCaseIntake`) and the
  staff picker (`AssignStaffForm`) share
  `client/src/components/TypeAheadPicker.tsx`, built on Downshift's
  `useCombobox` (keyboard handling and ARIA wiring) with its own minimal
  styling. It searches the server (`GET /api/people?q=` /
  `GET /api/staff?q=`) once typing pauses for 300ms, shows "Searching…"
  meanwhile, and ignores out-of-order responses. The field's text is the
  selection: editing it after picking an option deselects, and the ✕
  button (shown whenever there's text) clears both. USWDS's `ComboBox`
  was tried first and dropped: it only filters a pre-loaded list
  instantly, can't wait for a pause in typing, only shows its clear button
  after a selection, and when fed server results it shows matches for the
  previous keystroke. The sidebar's directory pages (People/Clients/Vendors)
  keep their own search-then-list-as-table UI, since they show every
  match at once rather than picking one.
- **10 demo cases** are seeded by `src/db/seed.ts` (not the test-shared
  `src/db/fixtures.ts`) via the real `createCase` handler, each with a
  distinct Faker-generated client and a rotating LSC case category, so the
  UI has something realistic to show without any test depending on that
  data existing. 6 of the 10 also get an external-submitter
  `case_assignment` to one of 3 Faker-generated demo vendor
  professionals (bootstrapped through the same `ensureUserAccountForEmail`/
  `ensureProfessionalForUserAccount` path a real emailed-code login takes,
  not a seed-only shortcut), with 1-3 `time_entry` rows logged against
  each and an invoice submitted for all but the last two (one left as a
  `draft`-status invoice, one left with no invoice at all) — so both the
  external portal and the staff case page's Invoices section have
  realistic, status-varied data on a fresh seed instead of an empty state.

## Client (React) design notes

- **`AppRouter`** (`src/App.tsx`) is the single loading/signed-out/
  portal/staff gate, so individual pages don't check auth themselves. It
  builds one React Router data router for whoever is signed in (staff,
  portal or signed out) and rebuilds it when a different kind of user
  signs in; `AuthProvider` sits outside it, sends sign-in and sign-out
  home and clears cached data.
- **Route loaders** (`src/routeLoaders.ts`): pages that load data on
  opening, staff and portal, have a loader that fetches it before the
  page switches, so the previous page stays on screen (with a thin
  progress bar after 200 ms, and at most 2 s before the page shows its
  own loading state) instead of blanking to "Loading…". A loader runs
  again only for a new address, not for a page's own query-string
  filters. Loaders and pages share named resources (`src/resources.ts`)
  so they use one cache key. Each route's page code loads when the route
  is first opened (`src/lazyPage.tsx`, React Router's `lazy`), so the
  first download stays small and portal users never fetch staff pages.
  If a page's code is gone after a redeploy, the app reloads once for
  the new files.
- **Filters in the address** (`src/hooks/useSearchParamState.ts`): list
  filters, sorts, text searches and the county choice are kept in the
  query string, replacing the entry rather than adding one, so Back
  returns to a list as it was filtered. Text boxes (`useSearchParamText`)
  are typed into locally and reach the address after a short pause. Providers and person records
  keep their submitted search there too, which their loaders preload.
- **`useResource`** (`src/hooks/useResource.ts`, TanStack Query) is how
  every page and component loads data, from a named resource (or `null`
  to load nothing yet, as for a picker not open).
  - **Lists** show what they had when opened again, while they refresh.
  - **`fresh` resources**, which their page edits (the review page,
    Settings, case and person pages, intake and upload, the portal), show
    only what was loaded for this visit and are never refreshed under the
    user. A save bumps the page's `resetKey`, which clears and reloads one,
    so forms seeded from it start again, as before.
  - **`reference` data** (counties, decision reasons, reference lists)
    and `discard` (the original file, dropped when not shown) round it out.
  - Any change (`DATA_CHANGED_EVENT`, fired by every successful write and
    upload) refreshes lists on screen and marks everything else to reload
    when next opened; a loader waits for a list marked so. A new router's
    first page shows at once and loads there.
- **Leaving and scrolling**: on the review and check pages, following a
  link with lines changed in place saves them first
  (`src/hooks/useSaveBeforeLeaving.ts`, React Router's `useBlocker`), so
  the next page loads after the save; if it fails the page stays with
  the reason, and leaving again goes anyway until the next edit. Leaving
  after deleting the invoice passes `DISCARD_EDITS`. Both shells use
  `<ScrollRestoration />`: a new page opens at the top and Back returns
  to where you were; a page's own filter changes pass
  `preventScrollReset`.
- **The review page** (`src/pages/InvoiceReview.tsx`) only lays out its
  sections from `src/pages/review/`: `useReviewPage` holds its data, what
  is open and the action runner (`act`); `reviewFacts` works out what it
  shows and allows (unit tested); `lineCells` builds each line's decision,
  questions and open form; the rest are its sections, top to bottom.
  Checking lines against a case time log is in `pages/review/timeLog/`.
- **The check page** (`src/portal/InvoiceSubmission.tsx`, the portal's
  invoice page and staff's check-the-lines page) lays out its sections from
  `src/portal/submission/`: `useSubmission` holds the lines as edited, the
  case number and sending, withdrawing and answering; `submissionFacts`
  works out what it shows and allows (unit tested). `CheckQueue` and
  `checkLinesPath` live in `src/portal/checkQueue.ts`, so pages linking to
  it don't load its code.
- **Styles** (`src/styles/`) are plain global CSS with BEM-style names,
  as USWDS is, in one file per area, imported in a fixed order by
  `index.css` so later files can override earlier ones. A rule used by one
  area goes in that area's file; one shared across areas goes in the shared
  files. Values come from `tokens.css`, and values known only at run time
  reach CSS as custom properties (`components/ui/cssVars.ts`), never inline
  styles. `npm run lint` enforces both: stylelint
  (`client/.stylelintrc.json`) rejects a literal color, font size or family,
  margin, padding, gap or radius outside `tokens.css` and `reset.css`, and
  ESLint rejects a `style` prop not built with `cssVars`.
- **Tests**: hooks that need React or a router run in jsdom with React
  Testing Library (`// @vitest-environment jsdom` at the top of the
  file; a router test also imports `src/testing/routerInJsdom.ts`).
  Everything else stays in Node.
- **`ReferenceSelect`** and **`RecordTable`** (`src/components/`) are the
  shared "label + select + reference-data options" and "empty vs.
  bordered table" shapes used by `NewCaseIntake`/`CaseDetail`.
- **Client/server type duplication**: `client/src/api/`'s
  `CaseRecord`/`CaseParticipant`/etc. mirror shapes from
  `server/src/db/schema.ts` by hand, with no shared types package across
  the client/server boundary. Accepted as the ordinary cost of a
  boundary between two separately-deployed apps, not a reuse bug —
  revisit only if a shared-types package becomes a concrete need.

## Changing the design system

A new design system changes three places; pages and area stylesheets hold
only layout and should not need to change.

1. **Tokens** (`client/src/styles/tokens.css`): every color, type size
   (`--text-13`…) and role (`--body-medium`…), spacing step, radius,
   elevation, and the form-field sizes and focus ring. Map each of the new system's tokens
   onto one of ours by role (its "primary" to `--color-primary`, its body
   text to `--body-medium`), or rename ours to match and replace the names
   throughout `src/styles/`.
2. **Fonts**: the Fontsource imports in `client/src/main.tsx` and the
   `--font-sans` and `--font-serif` tokens.
3. **Components**: each design-system component has one place in code.

| Figma component | Code | Styles |
|---|---|---|
| Button (Primary, Secondary, Danger) | `components/ui/Button.tsx` (`buttonClass` for links) | `styles/buttons.css` |
| Button (Ghost) | `.link-button` | `styles/base.css` |
| Tag | `components/ui/Tag.tsx` (`StatusPill` picks a tone by status) | `styles/feedback.css` |
| Alert | `components/ui/Notice.tsx` | `styles/feedback.css` |
| Card | the `card` class | `styles/card.css` |
| Modal | `components/ui/Dialog.tsx` | `styles/overlays.css` |
| Segmented control | `components/ui/SegmentedChoice.tsx` | `styles/forms.css` |
| Text input, select, text area, checkbox, radio | `@trussworks/react-uswds` markup, or plain elements with its class names | `styles/controls.css` (also plain checkboxes and radios, and a compact size for editing in table rows, which Figma doesn't specify) |
| Table cell | `components/RecordTable.tsx` | `styles/tables.css` |
| Link, breadcrumb | `components/PageHeader.tsx` | `styles/base.css`, `styles/page.css` |
| Header, side navigation item | `App.tsx`, `portal/ExternalPortalApp.tsx` | `styles/layout.css` |
| Decision bar | `components/LineReview.tsx` | `styles/review.css` |

Form controls keep USWDS's class names (`usa-input`, `usa-select`…)
because `@trussworks/react-uswds` renders them; restyle them in
`controls.css`, or replace those components to drop the names.

