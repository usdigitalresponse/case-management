# Invoice review and sign-off

A payment request (`invoice`) is reviewed line by line, then signed off. Cases
may be managed in an external case management system. Use synthetic staff and
administrator users. Amounts and day counts are synthetic test values, not
configuration defaults.

1. **Routing:** With no defaults configured, a submitted request is
   unassigned. With a default reviewer set, the next request goes to that
   reviewer. Setting a reviewer for a case sends that case's later requests to
   them instead. Any staff member may reassign a request, and the earlier
   assignment remains in history. Every staff member sees every request, with
   their own work shown first. A deactivated account can't decide or reassign.
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
   - Another staff member decides a line on a request assigned to someone
     else. The page tells them whose review it is; the request stays assigned
     to its reviewer, and the line shows who decided it.
5. **Undo and change:** Undoing or changing a decision before the round is
   finished leaves no history. Finishing with an undecided line is blocked.
   Finishing records one round of immutable decisions, each with whoever made
   it, and the request then awaits sign-off. A staff member who isn't the
   assigned reviewer may finish, and is recorded as finishing. Reopening before sign-off and finishing again records a
   second round; both rounds are kept, and the latest round's amounts are the
   approved amounts.
6. **Rejected lines:** A round with one rejected line still goes to sign-off.
   The approved total excludes that line.
7. **Sign-off:**
   - Any staff member may change the sign-off approvers before finishing.
   - A reviewer who decided every line alone and chose only themselves to sign
     off can't finish: at least two people take part. With a colleague who
     decided one line, they can.
   - With Settings set to named sign-off approvers only, choosing anyone else
     to sign off is refused, and someone taken off the list can no longer sign.
   - Each approver signs off in order, and the request is approved after the
     last one.
   - An approver rejects the whole request, with an optional comment. It is
     rejected and nothing on it is approved.
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
   - Staff can download only the signed-off requests for one county whose
     billing period overlaps chosen dates. A signed-off request for 20 Feb to
     5 Mar is included for March; one with no billing period is not.
   - Each row shows the client. The person downloading may leave out the
     client or other columns, but never the request's reference or amounts;
     a file with columns left out is marked as a redacted copy.
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
      sign-off approvers. A request typed in by hand, with its invoice
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
14. **Communication completed:** After the last approver signs off, a staff
    user tells the submitter the decision and marks the request's
    communication completed (`requester_communication`).
    - Marking a request completed is blocked until it is approved or
      rejected. Any active staff user may mark it, including staff without a
      reviewing role; an external submitter cannot.
    - The request stays approved; its record shows who marked it completed
      and when, and marking it again changes nothing.
    - Staff lists of decided requests show it as completed. The submitter
      does not see that it was marked completed.
    - Marking it completed is separate from external payment completion and
      does not affect exports.

15. **Checking a time log:** The request bills 2 hours on the 3rd, 3.5 on
    the 10th and 1 on the 12th of the billing period. The reviewer uploads the
    case's time log, with a title row above its headers and time spent in
    minutes (`check_lines_against_time_log`).
    - The header row and columns are found; the page says which columns were
      used. Entries from before the billing period are listed as outside it.
    - The log has 120 minutes on the 3rd under the person's first name and
      last initial. That name is suggested, not used: line 1 is flagged as
      only under another name until the reviewer confirms it, then matches.
    - The log has 180 minutes on the 10th: line 2 is flagged, log 3 hours.
      The reviewer links that entry; the line stays flagged because the hours
      differ. Line 3 is flagged as not in the log. An entry on the 20th is
      listed as not billed.
    - A log whose date, worker or time spent can't be found by header is not
      kept until the reviewer chooses those columns. Choosing other columns
      later compares again and keeps the reviewer's links.
    - With the deployment setting off, the reviewer approves line 2 as
      billed. Turning it on, approving line 3 as billed, at a changed rate or
      cut by rate alone is refused without a reason, and repricing every line
      leaves lines 2 and 3 undecided. Finishing is refused until line 2 is
      decided again; approving it in part at 3 hours needs no reason.
    - The reviewer approves line 3 as billed, saying it was logged under an
      office account. Once the round is finished, the approver sees that
      reason with the line; the submitter doesn't.
    - Another reviewer can't upload a log to a request someone else holds.
    - Finishing the round removes the log; reopening starts without one. The
      submitter never sees it, and exports and the billing record don't
      mention it. Recalling or deleting the request also removes it.

16. **Case rates:** The professional's kind is configured at 100 an hour. A
    request on their case bills 2 hours on the 2nd and 1 hour on the 10th at
    100 (`set_case_rate`).
    - The reviewer approves line 1 at 90 for the matching lines on this
      request. Both lines are approved at 90 with no reason; no case rate is
      recorded.
    - Instead, the reviewer sets the case's default for this person to 125
      from the 2nd. A reason from the case rate list is required; a reason
      from the cut list is refused, and a start after line 1's date is
      refused. The case rate records 125, the 100 it replaced, the date, the
      reason, the reviewer and the request. Both lines now show a default of
      125 from the case and are approved at 125, with the reason.
    - A second staff member, whose page still shows no case rate, sets 130.
      It is refused and the page shows the latest. Set again from 125, the
      new rate replaces the one from the same date.
    - Another request on the case, sent before the case rate was set, keeps
      its default of 100 and is flagged as changed since it was sent. A
      request sent afterwards is priced with a default of 125.
    - A case rate for the person's kind applies to everyone of that kind on
      the case, unless the person has a case rate of their own.
    - A case rate with no rate returns the case to the configured rate from
      its date.
    - With a pre-authorized rate of 110, lines are checked against it until
      a case rate is set; then they are checked against the case rate.
    - The approver sees the case rate set on the request, with the old and
      new rates, who set it and why, before signing off. The case page lists
      every case rate in date order and the ones in force now, read-only.

17. **Cases on review:** A request filed by person gives the case number
    26-CR-00211 and has no case (`match_invoice_to_case`).
    - While it is reviewed, the page lists the case with that number and one
      whose number differs only in dashes and leading zeros, marked as a
      close match. Matching it to the first sets the case on the request and
      its lines, adds its professional to the case, records who matched it,
      and keeps its prices. Matching it again to another case is refused.
    - With no case listed, staff add one from the request's number and go
      back to it matched. A case number already in the system, or a client
      with the same name not confirmed as someone else, is refused.
    - Matched, the page is led by the case: its client, its numbers, the
      number the request gave, and the pre-authorized amount with what is
      approved on the case so far.
    - Any staff member enters a pre-authorized amount of 150 for the
      professional. The request, for 200, is flagged as taking them over it,
      on the page and in the queue, and can still be approved or rejected.
      Changing the amount to 250 keeps the first decision and clears the
      flag. An amount below what is already approved is refused.

18. **A sender's cases:** The professional is on case 26-CR-00211, with a
    pre-authorized amount of 500 for them and 5,000 for the whole case.
    - Their case list shows the case with 500, never the 5,000.
    - A draft filed by person, typed 26cr211, is put under that case: its
      case number becomes 26-CR-00211 and its lines are priced with the
      case's rate. Sent, it goes straight to review on the case. Taken off
      the case again before sending, it keeps the number.
    - Putting a draft under a case they aren't on is refused.

An implementation must document any step it cannot enforce, such as
concurrent decisions, as a gap.
