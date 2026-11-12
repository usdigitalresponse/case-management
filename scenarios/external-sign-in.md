# External users' sign-in

Use synthetic people, emails and offices. Rules: `manage_external_sign_in`,
`add_professional_without_login`, `authorize_delegated_submission`,
`merge_duplicate_people`.

1. **Not until turned on:** Staff add an investigator with an email. Asking
   for a sign-in code with that email sends nothing, and the response is the
   same as for an unknown email.
2. **Turned on:** An administrator turns on the investigator's sign-in. A
   code is now sent; signing in with it links their account to the existing
   profile. The change is recorded with the administrator and the prior value.
   No email is sent by turning it on.
3. **No email yet:** A provider has no email. Turning on their sign-in is
   refused until the administrator adds one; an email already used by an
   account or another person is refused. Adding it is recorded.
4. **New external users:** An administrator adds a new provider with a name,
   email and kind, and a new delegate with a name, email and office, each with
   sign-in on. Neither is assigned to a case. The delegate, once signed in,
   sends invoices for that office's providers and has no provider profile.
5. **Provider as delegate:** An administrator makes the investigator a
   billing delegate for an office from today. They can now send invoices for
   that office's providers as well as their own. Making them a delegate for
   the same office again is refused. Stopping it later ends the delegation
   with its date; the record stays, and they keep their own profile.
6. **Turned off:** While the investigator is signed in, an administrator turns
   their sign-in off. Their next request ends the session, and new codes are
   refused. Their invoices and history stay, and they appear in the list as
   off, so it can be turned on again.
7. **Staff and others:** A staff member's email never receives a code. Staff
   who are not administrators can see who can sign in but cannot change it.
8. **Merged:** A person whose sign-in is on is merged into a record whose
   sign-in is off. Their account moves with them, and the kept record's
   sign-in is turned on, recorded so the merge can be undone.
