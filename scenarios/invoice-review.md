# Invoice review and sign-off

A payment request (`invoice`) is reviewed line by line, then signed off. Cases
may be managed in an external case management system. Use synthetic users with
configured reviewer, sign-off approver, staff and administrator roles. Amounts
and day counts are synthetic test values, not configuration defaults.

1. **Routing:** With no defaults configured, a submitted request is
   unassigned. With a default reviewer set, the next request goes to that
   reviewer. Setting a reviewer for a case sends that case's later requests to
   them instead. Any reviewer may reassign a request, and the earlier
   assignment remains in history. Every reviewer sees every request, with their
   own work shown first. Staff without a reviewing role can read the queue but
   cannot decide or reassign.
2. **Waiting:** A request submitted on a Friday has waited one working day on
   the following Monday. A request waiting longer than the configured number of
   working days is called out.
3. **Rate check:** The professional is pre-authorized on the case at 125 an
   hour. An imported time line states 2.0 hours at 175. It is requested at the
   stated rate and flagged against the pre-authorized rate. Re-pricing
   approves it in part at 125, with the rate reason. A line billed at 140 with
   a pre-authorized rate of 150 is not flagged, even when the configured rate
   is lower. With no pre-authorized rate, lines are checked against the
   configured rate. A line whose stated amount is not its hours times its
   stated rate is flagged. Neither flag blocks submission.
4. **Line decisions:**
   - Approving a line needs no reason.
   - Approving in part without a reason, or for more than the requested amount
     or nothing, is blocked.
   - Correcting the hours from 1.0 to 0.2 at a rate of 125 approves 25.00.
   - A line with no hours is approved in part by correcting its amount, and can
     be approved as it is.
   - Rejecting needs a reason. The "other" reason needs a note.
   - Approving in part and rejecting offer different reasons. Rejecting with a
     reason only on the approve-in-part list is blocked, and the reverse.
     An administrator adds a reason to the reject list and retires another;
     reviewers see the change at once, and decisions that used the retired
     reason keep it.
   - Only the assigned reviewer can decide lines.
5. **Undo and change:** Undoing or changing a decision before the round is
   finished leaves no history. Finishing with an undecided line is blocked.
   Finishing records one round of immutable decisions, and the request then
   awaits sign-off. Reopening before sign-off and finishing again records a
   second round; both rounds are kept, and the latest round's amounts are the
   approved amounts.
6. **Rejected lines:** A round with one rejected line still goes to sign-off.
   The approved total excludes that line.
7. **Sign-off:**
   - The reviewer may change the sign-off approvers before finishing.
   - Each approver signs off in order, and the request is approved after the
     last one.
   - An approver sends a request back with a comment. The request returns to
     its reviewer for another round in the same chain.
   - The comment is visible to staff, but not to the submitter or in exports.
   - Approvers do not decide individual lines.
8. **Visibility and export:**
   - The submitter sees each line's latest decision, reason and note.
   - An export of the approved request shows the case number, the court
     numbers and each line's latest decision, reason and note. Earlier recorded
     rounds are not exported.
   - Exports never include working decisions or internal-only comments.
   - The billing record has one row per submitted request. A request awaiting
     sign-off shows no approved amount; once signed off its row shows the
     approved amount, the cut, the reasons used and who signed off.
9. **Staff entry:** A staff user with no office affiliation enters a request
   that an assigned professional emailed in on a Monday, by typing its items
   or importing the file (`authorize_staff_invoice_entry`).
   - They can bill only professionals assigned to the case; a professional who
     is not assigned is refused.
   - Submitting without how it was received and the date received is blocked,
     as is a received date in the future.
   - The staff user is the submitter on every event. The request waits from the
     Monday it was received, not from the day it was entered.
   - The professional sees the request and its decisions read-only, and cannot
     recall it.
   - The staff user may review its lines but may not sign it off.
10. **Invoice intake:** A staff user saves an emailed request before its case is
    known, either typed in or imported from the file with no case chosen
    (`match_invoice_to_case`). An imported one is checked and confirmed as
    usual before it waits.
    - It waits in invoice intake, and any staff user may match it to an open
      case. Matching to a case its professional is not on is blocked unless
      they ask to add the professional, who is then assigned to the case. The
      match is recorded as an event. A submitted request cannot be rematched.
    - Starting a new case from an intake request matches the request to it.
    - A typed or imported request may also be saved with no professional; an
      imported one's lines still need who did the work before it is
      confirmed. It cannot be
      submitted; matching it requires choosing who it is from, and its time
      is then priced at that professional's rate.
    - Submitting it without a case is blocked unless the submitter chooses to
      review it without one. It is then reviewed and signed off as usual, with
      no time entries, assignment or pre-authorization checks; the review page,
      its exports and its billing record row warn that its case and
      professional are not tracked here.
11. **Adding a professional:** A staff user adds a professional who has never
    signed in, with a name, kind and email (`add_professional_without_login`).
    They can be chosen for an intake request at once. Adding someone whose
    email is already in use is refused. When that professional later signs in
    with the same email, they see the requests billed to them.

An implementation must document any step it cannot enforce, such as
concurrent decisions, as a gap.
