# Case relationships and history

Use configured roles, lifecycle states and synthetic records. These are required
acceptance scenarios, not assertions that the prototype implements them.

1. **Identity:** A contact with no user account can be client on one case and
   another participant role on a second. A professional/account referencing that
   person resolves to the same identity. A mismatched professional/account person
   is rejected. Case participation alone grants no system access.
2. **Affiliation and assignment:** End a primary assignment and begin another at
   the same instant with a different affiliation. Both survive; only the second
   is active at the boundary. A concurrent primary is blocked; a different staff
   role may overlap. Changing current office does not rewrite old assignments.
3. **Issues and context:** Add two case issues, two program associations and two
   funding associations. One primary issue is allowed; a second primary is
   rejected. A funding reference to another case's program is rejected.
4. **Repeated lifecycle:** Open, close with reason, reopen with reason and close
   again. Four events survive with actors and timestamps. The first-open date
   stays stable; closed date clears on reopen and reflects the second closing.
   An ordinary backdated transition is blocked; an authorized correction retains
   original evidence and must pass replay validation.
5. **Time and activities:** Record an activity with two workers' time entries,
   then an independent time entry. All are valid. A cross-case activity link,
   invalid activity subtype, nonpositive duration, or ineffective funding link
   is blocked. Changing case classification does not alter submitted evidence.
6. **Timeline:** Add a note, communication, date-only time entry, future calendar
   event and lifecycle event. The timeline preserves type, source ID and date
   precision and labels the calendar event as scheduled. Linked activity/time do
   not double-count hours. Restricted notes and documents are absent from both
   summaries and counts for unauthorized viewers.
7. **Reporting:** Calculate current-interval and total-open-time age after a
   close/reopen sequence. Reports identify convention, time zone and as-of date;
   changing a threshold recalculates a flag without updating source case fields.

8. **Closure ends all assignments:** With active primary and staff assignments,
   close the case. Both end at exactly the closure effective timestamp with the
   closing actor and a closure reason. Neither is current or contributes active
   workload after closure; assignment-derived access ends, while separately
   granted permissions follow their own policy. Previously ended assignments
   remain unchanged. Reject a concurrent new assignment that would stay active
   after closure. Failure to end any active assignment rolls back the closure.
9. **Reassignment after reopening:** Reopen the case. No old assignment becomes
   active. Assign a professional again using a new assignment ID, preserving the
   prior record and applying normal eligibility checks. Closing again ends the
   new assignment. Reject assignments starting within a closed interval.
