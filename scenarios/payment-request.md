# Payment request and authorization review

`invoice` is the stable entity key for a payment request. Use synthetic payees,
one configured currency, and authorized users. Amounts below are synthetic test
values, not configuration defaults.

1. **Request capture:** Create one request for a case and provider with supporting
   invoice number/period, two lines totaling 120, and requested allocations of
   70 and 50 to two preauthorizations for that case. Attach versioned documents.
   Cross-case lines/authorizations, mismatched restricted payee, inverted periods,
   wrong currency and a submitted total other than 120 are blocked.
2. **Submission evidence:** Submit with the required attestation. The chain
   snapshot freezes requested values, allocation sources, case evidence, payee
   details and document versions. Changing the current payee email or case issue
   does not change the reviewed evidence. Replacing a signature file cannot
   alter the original signed submission.
3. **Review sequence:** Attempt line review before required pre-approval, as a
   different reviewer, or against a line in another request. Each is blocked.
   Authorized reviewers approve all lines in order. Approving final line amounts
   totaling 100 leaves requested total 120 intact; the approved total is 100.
   Allocate approved draws of 60 and 40 to the two authorization sources. Reject
   a line draw greater than that line's approved amount or an allocation draw
   greater than its requested allocation.
4. **Concurrent ceiling:** Give one authorization a ceiling of 100. Approve a
   draw of 60, then attempt two concurrent draws of 30 each from other requests.
   At most one succeeds. Remaining balance is 10 after one succeeds; confirming external payment of the
   earlier 60 does not restore available authorization. Reject ceiling reduction
   below committed draws and exclude earlier review-step approvals from draws.
5. **Denial and revision:** Deny with reason and retain requested amount,
   reviewer/date and evidence. Request changes or revise an unpaid approval only
   by superseding its attempt. Current commitments release atomically, old
   decisions remain, and a new submission needs new approval and attestation.
   Superseding an externally completed approval is blocked pending reconciliation policy.
6. **External completion:** An approved request initially shows completion
   unconfirmed. An authorized user records external completion with its source,
   timestamp and approved attempt. Approval stays approved and completion becomes
   confirmed. No transfer, payment instruction or scheduling action occurs.
   Unknown paid date or amount remains empty; a reported amount different from
   approval is retained and flagged for reconciliation. Duplicate confirmations
   and confirmation against another request's chain are blocked. Unconfigured
   partial-settlement and correction paths are unavailable.
7. **History and balances:** Query prior submissions and approvals as of a cutoff,
   excluding the current request. Resubmission history is visible but not counted
   twice as current authorized consumption. Denied and superseded attempts do not
   become current approved balances.
8. **Trip with travel time:** Configure an hourly rate of 100 for the provider
   and a travel time rate of 50% of the hourly rate, and a mileage rate of 0.5.
   Claim one round trip on one date with 2 hours of travel time, 30 miles and
   a parking cost of 10. The request has three lines on one trip, priced at
   100 (2 hours at 50), 15 and 10, all dated the trip's date. A second time
   line or mileage line on the same trip, or a trip line dated differently, is
   blocked. Reviewers approve the mileage and parking and approve the travel
   time in part at 1 hour; the travel log shows the trip with its hours, miles
   and costs. Changing the travel time rate afterwards does not change the
   submitted snapshot. With no travel time rate in force, the travel time is
   priced at 200 like other time.
9. **Mileage without a trip:** An imported or entered mileage line with its
   own route and no trip is given a trip of its own; it is never grouped with
   other lines without the submitter or staff doing so. While checking an
   import, a parking line on the same date can be added to that trip and taken
   off again; submitting without grouping is allowed.
10. **Waiting time:** Configure a flat waiting time rate of 60. One and a half
    hours of waiting time is priced at 90 and its time entry recorded as
    waiting.
11. **Changed rate:** A reviewer approves a 2-hour line billed at 125 at a
    rate of 150, with no reason. The approved amount is 300, above the 250
    requested. Sign-off approvers see the line flagged with the billed and
    changed rates before signing off.
12. **Travel hours and distance:** With the travel time and distance rule
    warning at 30 mph and 25% tolerance, a trip of 30 miles with 2 hours of
    travel time is flagged; 1 hour is not.
13. **Same-day travel on another case:** The same professional submits travel
    for one date on two cases. Reviewing either request shows one other request
    with travel that day and opens that professional's requests for the date
    in another tab; drafts and the same case are not counted.

An implementation must document unavailable transactions, immutable evidence,
review authorization or all-write-path validation as gaps before claiming parity.
