# Using a different design system

For someone deploying this app who wants it to look like their own
organization's design system. Pages and their stylesheets hold layout only,
so a new design system changes tokens, fonts and a short list of components,
not pages.

## Without changing code

- **Organization name**: set `ORGANIZATION_NAME` (in `.env.prod` for
  `docker-compose.prod.yml`, or the shell for `docker-compose.yml`). The
  header then reads "*Your organization* | Invoice Review"; without it, the
  header reads "Invoice Review" alone. The server sends it to the client on
  `GET /auth/providers`, so changing it needs a restart, not a rebuild.
- **Case management system's name**: links and wording say "your case
  management system". To name yours, change `EXTERNAL_SYSTEM_NAME` in
  `client/src/externalSystem.ts` (a rebuild).

## 1. Tokens

`client/src/styles/tokens.css` holds every color, type size and style,
spacing step, radius, shadow and the focus ring. Every other stylesheet uses
only these (`npm run lint` rejects a literal color, font size, margin,
padding, gap or radius anywhere else). Map each of your system's tokens onto
ours by role; keep our names, so nothing else changes.

| Tokens | Role |
|---|---|
| `--color-primary`, `--color-on-primary`, `--color-primary-hover` | Primary buttons, links, the selected sidebar bar |
| `--color-primary-container`, `--color-on-primary-container`, `--color-primary-container-low`, `--color-primary-fixed-dim` | Info tags and alerts, selected rows and items, the drafts box and its border |
| `--color-secondary-container`, `--color-on-secondary-container` | Neutral tags |
| `--color-tertiary`, `--color-tertiary-container`, `--color-on-tertiary`, `--color-on-tertiary-container` | Warnings, and the rule under the header |
| `--color-error…`, `--color-success…` | Errors and danger buttons; success, approved amounts |
| `--color-surface…`, `--color-on-surface…` | Page (`surface-container`), cards and sidebar (`surface`), table headers (`surface-container-low`), text and its quieter shades |
| `--color-outline…` | Field borders (`outline`), card and sidebar borders (`outline-variant`), dividers (`outline-subtle`) |
| `--color-inverse-surface`, `--color-on-inverse-surface`, `--color-inverse-primary` | The header, Strong tags |
| `--color-focus`, `--focus-ring` | Keyboard focus |
| `--color-scrim`, `--elevation-1…4` | Behind dialogs; shadows |
| `--font-sans`, `--font-serif` | Body text; headlines |
| `--text-11…32` | Every font size |
| `--headline-*`, `--title-*`, `--body-*`, `--label-*` | Type styles (weight, size, line height where set, family) |
| `--space-1…16` | Every margin, padding and gap |
| `--radius-*` | Corners |
| `--field-gap`, `--mark-size` | Form fields: label gap, checkbox and radio size |

Text on a `*-container` fill uses its `on-*-container` color; keep that
pairing at a contrast of 4.5:1 or more.

## 2. Fonts

Change the Fontsource imports at the top of `client/src/main.tsx` and the
`--font-sans` and `--font-serif` tokens. Add packages with npm in `client/`.

## 3. Components

Each design-system component has one place in code. Restyle it there; pages
pick it up.

| Component | Code | Styles |
|---|---|---|
| Header (brand, search, user) | `App.tsx`, `portal/PortalTopBar.tsx`, `components/AppBrand.tsx` | `styles/layout.css` |
| Side navigation | `App.tsx` (staff sidebar) | `styles/layout.css` |
| Button: Primary, Secondary, Danger | `components/ui/Button.tsx` (`buttonClass` for links) | `styles/buttons.css` |
| Button: Ghost | the `link-button` class | `styles/base.css` |
| Tag: Neutral, Info, Success, Warning, Danger, Strong | `components/ui/Tag.tsx` (`StatusPill` picks a tone by status) | `styles/feedback.css` |
| Alert, with its icon | `components/ui/Notice.tsx` | `styles/feedback.css` |
| Card | the `card` class | `styles/card.css` |
| Modal | `components/ui/Dialog.tsx` | `styles/overlays.css` |
| Segmented control | `components/ui/SegmentedChoice.tsx` | `styles/forms.css` |
| Text input, select, text area, checkbox, radio | `@trussworks/react-uswds` markup, or plain elements with its class names | `styles/controls.css` |
| Table | `components/RecordTable.tsx` | `styles/tables.css` |
| Page title, breadcrumb | `components/PageHeader.tsx`, `components/PageHeading.tsx` | `styles/layout.css`, `styles/page.css` |
| Decision bar | `components/lineReview/DecisionCell.tsx` | `styles/review.css` |
| Tab, with its count | `components/ui/Tabs.tsx` (Pre-authorizations; other lists still filter with Tags) | `styles/feedback.css` |
| Step | `components/ui/Steps.tsx` (the upload and import pages) | `styles/feedback.css` |
| Fact (summary strip) | `components/FactsStrip.tsx` | `styles/page.css` |
| File drop zone | `DropZone` in `components/upload/UploadFiles.tsx` | `styles/upload.css` |
| Type-to-find field | `components/TypeAheadPicker.tsx` (`CountyPicker`, `PickOrAdd` with `search`) | `styles/pickers.css` |

Form controls keep USWDS's class names (`usa-input`, `usa-select`…) because
`@trussworks/react-uswds` renders them; restyle them in `controls.css`, or
replace those components to drop the names. USWDS's own stylesheet is not
loaded.

## Checking the result

From `client/`, `npm run lint` (tokens only, no inline styles),
`npm run typecheck`, `npm test` and `npm run build`. Then look at these pages
as staff and as a sender, at full width and phone width: Invoices to review,
an invoice's review page with a decision panel open, Finished, All cases,
Settings; and Your invoices, Upload, Import, and checking and sending a
draft. The end-to-end suite (`e2e/README.md`) walks one invoice through both.

Check accessibility by hand: text contrast (4.5:1, or 3:1 for large text),
a visible focus ring when moving with the keyboard (it shows for keyboard
focus only), and that tags, warnings and selected items still make sense in
grayscale.

## Known gaps

- Line heights, letter spacing and widths are still literal values, not
  tokens.
- Table headers and second lines are 11px; the current design drew 9px, and
  its own accessibility check suggests 12px at least.
- Checkboxes, radios and filter tags are below the 24-pixel target size of
  WCAG 2.2.
- The gold used for focus rings and flagged markers is under 3:1 against
  white.
