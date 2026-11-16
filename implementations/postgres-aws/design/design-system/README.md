# Design system

The colors, spacing, corner sizes, type styles and shadows of the invoice
review prototype, exported from its Figma design system so that anyone can
read them, change them, and load them into their own tools.

## What is here

`tokens.json` holds every value in the Design Tokens Community Group format,
which Figma plugins, Style Dictionary and most design-token tools can read.

| Group | Count | What it is |
|---|---|---|
| `color` | 38 | Every color, named by role, not by shade |
| `space` | 16 | Every margin, padding and gap, from 1px to 120px |
| `radius` | 4 | Corner sizes |
| `typography` | 12 | Type styles: headline, title, body and label, each in three sizes |
| `elevation` | 4 | Shadows |

Each token carries its Figma name and, where the code has one, its CSS name:

```json
"primary": {
  "$type": "color",
  "$value": "#005a9c",
  "$description": "Main actions, links and selected states.",
  "$extensions": { "figma": "color/primary", "css": "--color-primary" }
}
```

## How this relates to the code

The app reads its values from `../../client/src/styles/tokens.css`, not from
this file. Nothing copies one to the other yet, so a change has to be made in
both places. `../../docs/design-system.md` explains the CSS file and lists
which code file holds each component.

## Changing a value

1. Change it in `tokens.json`.
2. Find the CSS name in the token's `$extensions.css` and change the same
   value in `client/src/styles/tokens.css`.
3. From `client/`, run `npm run lint` and `npm run build`, then look at the
   pages listed under "Checking the result" in `docs/design-system.md`.
4. If you keep a Figma copy, change the variable with the token's
   `$extensions.figma` name there too.

Keep text on a `*-container` color paired with its `on-*-container` color, at
a contrast of 4.5:1 or more.

## Using a different design system

Keep the token names and replace the values with your own system's. The names
describe a role ("primary", "surface", "outline"), so pages and components do
not change.

## Where Figma and the code differ today

- **Corner sizes.** Figma has small 4px, medium 6px, large 8px and pill 999px.
  The code has small 4px, medium 8px and full 999px.
- **Three colors are in Figma only:** `secondary`, `on-secondary` and
  `on-success`. No screen in the code uses them.
- **Letter spacing** is set on five type styles in Figma and is not a token in
  the code.

## Components

The Figma design system has 23 components. `docs/design-system.md` maps each
one to its code.

Button (Primary, Secondary, Ghost, Danger), Tag (Info, Success, Warning,
Error, Neutral, Strong), Side navigation item, Link, Breadcrumb, Text input,
Drop-down select, Text area, Checkbox, Radio button, Alert (Info, Success,
Warning, Error), Portal header, Card, Table cell, Modal, Segmented control,
Decision segment, Decision bar, Tab, Step, Fact, File drop zone and
Type-to-find field.

## What is not here

The Figma file itself is not in this repository. It holds earlier designs
that have not been through the cleaning this folder requires. Until a cleaned
copy is shared, `tokens.json` and the screen images in `../screens/` are the
public record of the design.
