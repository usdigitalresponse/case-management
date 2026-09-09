# New case

These platform-neutral scenarios apply to `model/forms.yaml:new_case`.
Use synthetic clients and configurable reference records only.

1. **Minimum case:** Given an existing client and a configured status, enter
   those two references and save. A case receives a generated identifier and
   can be reopened with both references intact. Optional fields remain empty.
2. **Required fields:** Attempt to save without a client, then without a status.
   Each attempt is blocked with a field-specific explanation.
3. **Complete intake:** Select a client, status, county, and category; enter an
   external reference and an opened date. Save and reopen. All entered values
   and relationships persist, and the date does not shift with time zone.
4. **Client reuse:** Create two cases for the same existing client. Both cases
   reference the same client; no additional client record is created.
5. **History:** Create a case and change its external reference. Authorized
   reviewers can identify the affected record, action, actor, and timestamp.
   Ordinary users cannot edit or delete the history.

Implementations must report which scenarios were actually exercised and any
gaps, including validation that only runs in a particular form. New client
creation remains subject to `flag_possible_duplicate_client` when introduced.
