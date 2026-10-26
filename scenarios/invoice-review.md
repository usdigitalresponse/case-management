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
3. **Rate check:** An imported time line states 2.0 hours at a rate above the
   configured rate. It is requested at the stated rate and flagged. Re-pricing
   approves it in part at the configured rate, with the rate reason. A line
   whose stated amount is not its hours times its stated rate is flagged.
   Neither flag blocks submission.
4. **Line decisions:**
   - Approving a line needs no reason.
   - Approving in part without a reason, or for more than the requested amount
     or nothing, is blocked.
   - Correcting the hours from 1.0 to 0.2 at a rate of 125 approves 25.00.
   - A line with no hours is approved in part by correcting its amount, and can
     be approved as it is.
   - Rejecting needs a reason. The "other" reason needs a note.
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
   - An export of the approved request shows each line's latest decision, with
     earlier recorded rounds as history.
   - Exports never include working decisions or internal-only comments.

An implementation must document any step it cannot enforce, such as
concurrent decisions, as a gap.
