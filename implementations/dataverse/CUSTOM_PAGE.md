# Custom Page: New case intake (comparison prototype)

> Superseded save approach: the [three-interface comparison plan](../../docs/case-intake-comparison-plan.md)
> requires one shared transactional backend for standard forms, Power Fx and
> React. Before building this page, replace the sequential-write approach below
> with the confirmed shared operation. The remaining layout/input notes are
> provisional; this page has not been built or tested.

This is a bounded, one-off comparison artifact, not a new default UI. It exists
to generate evidence for the "reconsider" trigger in
`docs/architecture-assessment.md`'s UI-choices table ("Observed intake problems
that a standard form cannot resolve well"), by building one Custom Page that
captures the same `model/forms.yaml:new_case` data as the existing model-driven
`cm_case` intake tab, then comparing the two against `scenarios/new-case.md`.
See `docs/case-intake-ui-comparison.md` for results and
`docs/DECISIONS.md` for the resulting recommendation.

## Status

Not yet built. This file will be updated once the Custom Page exists in the
target environment and its source has been captured into `Solution/`.

## How it is authored

Custom Pages are canvas apps authored interactively in Power Apps Studio; they
are not hand-written. Build it using `custom-page-recipe.md` in this directory,
which specifies the screen, controls, field bindings, validation formulas and
save logic mapped 1:1 to `forms.yaml:new_case`. A human should perform the
actual Studio authoring following that recipe; do not attempt full unattended
browser automation of the data-bound parts (data-source wiring, formulas, save
logic) — at most, narrow automation assistance for purely mechanical steps
(e.g., adding fixed labeled inputs) is reasonable, always followed by manual
review in Studio.

## Capturing the built page into source control

Once the Custom Page works in Studio, capture it the same way any other maker
edit is captured (see `SOLUTION.md`), with one additional unpack step for the
canvas app itself:

```sh
pac solution export --environment "$DATAVERSE_URL" --name CaseIntakePrototype --path /tmp/CaseIntakePrototype.zip --overwrite
pac solution unpack --zipfile /tmp/CaseIntakePrototype.zip --folder /tmp/CaseIntakePrototype-source
pac canvas unpack --msapp /tmp/CaseIntakePrototype-source/CanvasApps/<custom_page_name>.msapp --sources /tmp/CaseIntakePrototype-source/CanvasApps/<custom_page_name>_src
```

Diff the unpacked output against Git to isolate the new component, scrub
private metadata (publisher/contact, environment URLs, connection bindings) the
same way `SOLUTION.md` requires, then copy the reviewed Custom Page / canvas
app source into `Solution/` alongside the existing `Entities/` and
`AppModules/` components, preserving whatever component IDs `pac` assigns.

## Known gaps (in addition to the shared gaps already listed in `README.md`)

- No native multi-table transaction: the page's save action performs
  sequential `Patch` calls, not an atomic write. This is the same "atomic case
  creation" gap already documented for the model-driven form in `README.md`'s
  "Remaining workflow gaps" — not a new or different limitation introduced by
  this page.
- Actor-account mapping, opening reference configuration, time-zone handling,
  required case-field initialization and failure behavior must be implemented
  and verified in Studio before the recipe can be exercised. No formula in
  this documentation has been validated in a built Custom Page.
- Duplicate-person review is outside this existing-person intake. Scenario 6
  becomes relevant when a separate person-creation journey is introduced.
- Any Custom-Page-specific quirks discovered during actual Studio authoring
  (e.g., lookup control limitations, formula behavior differences from
  documented Power Fx) should be appended here as they're found, per
  `model/README.md`'s instruction to document every platform-specific
  compromise.

## Not built here

- Any form/page besides `new_case` intake.
- A reusable canvas-app/Custom-Page deployment pipeline — this capture step is
  scoped to this one page only.
- Server-side workflow enforcement; this comparison does not implement
  `model/rules.yaml` or the atomic intake operation.
