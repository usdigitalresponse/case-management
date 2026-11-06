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
12. **Questions to the submitter:** The reviewer asks about line 2, "Which
    hearing was this for?" (`ask_review_question`).
    - The request is awaiting an answer, and lists of requests show that it
      has an unanswered question. The reviewer can still decide lines, but
      finishing the round is blocked, and the submitter cannot recall it.
    - The submitter sees the question on the request without the reviewer's
      name, and answers it. The request returns to under review, and the
      question and answer stay on its record with who answered and when.
    - With two questions open, answering one leaves the request awaiting an
      answer; answering the second returns it to under review.
    - Until the reviewer finishes the round, reviewers' lists show the request
      has answered questions, and its review page says the answers are in.
      After the round is finished, lists no longer call them out.
    - A question that names no line is refused.
    - The reviewer records an answer the submitter gave by phone; the record
      names the reviewer as having recorded it.
    - An answered question cannot be answered again or changed. A question or
      answer longer than 500 characters is refused. Someone who neither sent
      the request nor is the professional it bills for cannot answer.
    - Exports and the billing record of the signed-off request include no
      questions or answers; both remain on the request in the system.
13. **Entering a request in review:** A reviewer uploads a request a
    professional emailed in, with two lines read from the file
    (`enter_request_in_review`).
    - It is under review at once, assigned to the reviewer, with the default
      sign-off approvers. Staff without a reviewing role upload as a draft and
      submit it as before. A request typed in by hand, with its invoice
      number, goes into review the same way.
    - The reviewer approves both lines, then corrects the second line's
      amount. The first keeps its decision; the second is undecided again. A
      line they add has no decision until they decide it.
    - Removing a line the reviewer asked a question about is refused.
    - Finishing without how it was received, or without a case number, is
      blocked. Finishing with both freezes the lines as entered and records
      the round; the approvers are told the same person entered and decided
      it.
    - After reopening, or after an approver sends it back, its lines cannot
      be changed, only decided again.
    - Reassigned to another reviewer before finishing, only the new reviewer
      can change its lines, and approvers are not told it was entered and
      decided by one person. The new reviewer can finish it, and finishing
      confirms the file's values; a decided line that confirming changes is
      undecided again, and finishing waits until it is decided.
    - Before finishing, and with no question asked, the reviewer may discard
      it. Nobody else can.
    - With the request open in two windows, a change saved in one is refused
      in the other, which then shows the latest lines. After it is reassigned,
      the earlier reviewer's open page can't save over the new reviewer's.
    - While it is being entered, the queue and the request's page show it as
      being entered, by whom and when its lines last changed. Another
      reviewer can't correct its case number until it is finished, and is
      warned before taking it over.

An implementation must document any step it cannot enforce, such as
concurrent decisions, as a gap.
