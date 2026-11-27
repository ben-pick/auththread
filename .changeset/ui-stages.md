---
"@auththread/schema": minor
"@auththread/browser": minor
"@auththread/adapter-kit": minor
"@auththread/stitcher": minor
"@auththread/auth0": minor
---

Replace `auth.ui.step` with the provider-neutral `auth.ui.stage`, add
`stage`/`method`/`vendorScreen` to wide-event steps, and raise the wide-event `schemaVersion` to
2. The page snippet now captures load and transition timing, submit and retry counts,
abandonment, visibility, passkey and delegation facts. `AuthThreadBrowser.abandon()` now takes
an `AuthUiStage`.
