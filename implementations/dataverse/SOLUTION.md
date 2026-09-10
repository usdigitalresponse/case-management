# Solution source workflow

`Solution/` is the privacy-reviewed, unpacked unmanaged Solution from the current
prototype. Its component IDs preserve the existing app, forms, views and
relationships. Canonical requirements remain under `model/`; Solution source
records the implemented Power Platform customization.

Before editing Solution source, export the existing development Solution to an
ignored location and unpack it to a temporary directory. Compare that export to
Git so maker edits are preserved. Raw exports must never be committed.

```sh
pac solution export --environment "$DATAVERSE_URL" --name CaseIntakePrototype --path /tmp/CaseIntakePrototype.zip --overwrite
pac solution unpack --zipfile /tmp/CaseIntakePrototype.zip --folder /tmp/CaseIntakePrototype-source
```

Review publisher/contact values, environment URLs, user information, connection
bindings, and other private metadata before copying changes into `Solution/`.
Keep platform dependency declarations and component identities intact. The source
contains metadata, not case records, reference values, user accounts or secrets.

```sh
pac solution pack --folder implementations/dataverse/Solution --zipfile /tmp/CaseIntakePrototype-reviewed.zip
pac solution import --environment "$DATAVERSE_URL" --path /tmp/CaseIntakePrototype-reviewed.zip --publish-changes
```

Export/unpack again after publishing so designer/platform normalization is
captured.

Run `verify-review` and visually check a fresh app session. Pack success alone
does not prove permissions or workflow correctness. Deployment to a second
clean environment remains unverified. The exported Solution declares Microsoft
platform dependencies; do not bypass dependency validation.
