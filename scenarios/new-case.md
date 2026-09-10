# New case

These platform-neutral scenarios apply to `model/forms.yaml:new_case` (0.2).
Use synthetic people and configured reference values only. The current Dataverse
bootstrap implements the earlier 0.1 journey and has not passed these scenarios.

1. **Minimum case:** Select an existing person in the configured client role,
   an opening status and an explicit effective timestamp. Save. Case, participant
   and opening event receive stable IDs in one logical transaction; the opening
   event records the authenticated actor and recording timestamp. View the saved
   case again and confirm the same relationships and status.
2. **Required input:** Omit the person, role, status or effective timestamp in
   turn. Each attempt is blocked with an explanation and leaves no orphan case
   or event. An invalid status transition is blocked through every write path.
3. **Complete intake:** Supply county, category and compatible organization and
   office; add a typed identifier with issuer and primary indicator. Save and
   view again. Inputs persist; external reference matches the primary
   identifier, and reporting dates use the configured time zone.
4. **Person reuse:** Create two cases for one existing person, then link that
   person in a different role on another case. No new person or account is
   created. Add a second client participant to the first case; both links remain
   and the singular compatibility client field should become null once something
   maintains it (deferred; see "Deferred: fields that should become read models"
   in `model/README.md` — this is not yet enforced).
5. **History:** Change an identifier through the authorized domain operation.
   Reviewers can inspect old/new values, record, actor and timestamp. Ordinary
   users cannot edit or delete history.
6. **Duplicate review:** When person creation is introduced, possible matches
   trigger `flag_possible_duplicate_client`, whose retained key now applies to
   person identity. Neither people nor cases are silently merged.

Implementations must report scenarios exercised and gaps, including form-only
validation or missing multi-record transaction enforcement.
