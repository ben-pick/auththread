# @auththread/browser

## 0.2.0

### Minor Changes

- a38a5be: Replace `auth.ui.step` with the provider-neutral `auth.ui.stage`, add
  `stage`/`method`/`vendorScreen` to wide-event steps, and raise the wide-event `schemaVersion` to
  2. The page snippet now captures load and transition timing, submit and retry counts,
  abandonment, visibility, passkey and delegation facts. `AuthThreadBrowser.abandon()` now takes
  an `AuthUiStage`.

### Patch Changes

- Updated dependencies [a38a5be]
  - @auththread/schema@0.2.0
