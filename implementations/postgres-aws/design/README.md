# Design exports

The current Figma design for this prototype: one image per screen, plus any
design documents that go with it. Git keeps the versions: replace a file when
its design changes, rather than adding a new folder or a versioned file name,
and name the design (for example "design J") in the commit message.

Name files by screen or topic in lowercase with hyphens, such as
`invoices-to-review.png`, and keep a file's name when it changes so its
history stays in one file.

## Cleaning before anything goes in

Everything here is public in the repository, so check every image and every
page of a document before committing it. Replace real details with synthetic
ones that look plausible but match no real record:

- **Organizations and people:** no agency, office, employee, client, attorney,
  provider, vendor or stakeholder names, and no names, emails, phone numbers
  or addresses that belong to anyone.
- **Places:** no real state, county, court, office or jurisdiction names.
- **Systems:** no names of the systems in use today; call the one this tool
  sits beside "external case management system".
- **Codes and figures:** no real case, account, funding, payment or vendor
  codes, and no real rates, thresholds or other configuration values.
- **Policy and wording:** no organization-specific legal citations, policy
  names or internal terms, and no quotes from interviews, research notes or
  user stories.
- **Logos and branding:** no seals, logos or branded colors that identify an
  organization.
- **Hidden content:** check file names, document titles and metadata, layer or
  page names, comments and text outside the visible frame, since exports can
  carry them.
