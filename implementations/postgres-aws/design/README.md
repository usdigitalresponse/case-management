# Design exports

The current Figma design for this prototype, one PNG per screen. Git keeps the
versions: replace a screen's file when its design changes, rather than adding a
new folder or a versioned file name, and name the design (for example
"design J") in the commit message.

Before committing an export, check that it shows only synthetic data and
generic names: no real organization, person, place, system or code, and
"external case management system" for the system this tool sits beside.
Uncleaned exports go in the gitignored `../figma/` folder instead.

Name files by screen in lowercase with hyphens, such as
`invoices-to-review.png`, and keep a screen's name when it changes so its
history stays in one file.
