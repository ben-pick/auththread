---
id: "0014"
title: "Hosted-page screens use a provider-neutral stage vocabulary"
scope:
  - "packages/core/contracts/**"
  - "packages/core/schema/**"
  - "packages/core/adapter-kit/**"
  - "packages/core/stitcher/**"
  - "packages/providers/*/page/**"
  - "packages/providers/*/src/screens.ts"
enforced-by:
  - "packages/providers/auth0/src/screens.test.ts"
  - "packages/core/schema/src/wide-event-schema.test.ts"
  - "runUiScreenConformance"
  - "pnpm schema:check"
---

# 0014. Hosted-page screens use a provider-neutral stage vocabulary

## Outcome

- A hosted-page screen has three neutral dimensions plus the provider's own name:
  `auth.journey.kind` (why), `auth.ui.stage` (where), `auth.method` (how) and
  `auth.ui.vendor_screen` (exactly which page).
- `auth.ui.stage` is one of `identify`, `authenticate`, `verify`, `enroll`, `select`,
  `consent`, `recover`, `status` or `custom`. `auth.abandoned_at` carries the same value.
- The page snippet sends the vendor screen and path. The provider adapter maps them to
  `stage` and `method` in the stitcher. The snippet never sends a neutral stage.
- An unknown screen keeps its vendor name and gets no stage. It is never defaulted to
  `identifier` or any other bucket.
- `auth.ui.step` is legacy input only. It is mapped once at ingest and is not emitted.
- Wide events move to `schemaVersion: "2"` and UI steps carry `stage`, `method` and
  `vendorScreen`.
- Each adapter keeps an exhaustive screen map and a conformance fixture. Auth0's map covers
  all 92 screens in the Management API enum.
- The wide-event JSON Schema is generated from the private server-only Effect contract in
  `packages/core/contracts/src/index.ts`. The zero-dependency enum tuples are declared in
  `@auththread/schema` and imported by the contract; browser packages use those tuples
  directly and never import Effect or `contracts`. `pnpm schema:check` fails on JSON drift.

## Rules

- Enum values live only in the zero-dependency tuples in `@auththread/schema`. The private
  Effect contract imports them with `Schema.Literals(...)`; never restate the values in a
  contract, a decoder or the JSON Schema. The JSON Schema is generated from the contract.
- Neutral meaning is server-derived. For a span with a vendor screen, path or legacy step, the
  stitcher deletes any client-supplied `auth.ui.stage`, `auth.abandoned_at` and
  `auth.abandoned_screen` before applying the adapter's classification.
- A provider adapter must return an empty classification for unknown input. Prefix heuristics
  are opt-in and must be conservative; a wrong stage is worse than no stage.
- The screen map lives in the adapter, not in the page snippet. The snippet is SRI-pinned and
  manually upgraded; a new provider screen must not require republishing it.
- The snippet must never read or send field values, keystrokes, clipboard content, email,
  username or DOM text. It sends counters, durations, booleans and the vendor screen name.
- A provider's screen map is not supported until its conformance fixture and
  `runUiScreenConformance` are green.

## Why

The old six-value `auth.ui.step` mixed the journey intent (`signup`, `reset`), the phase
(`mfa_challenge`) and the method (`password`). It could not express MFA enrollment, factor or
organisation selection, recovery, or terminal status pages, and every new provider screen
needed a snippet change.

Separating intent, phase, method and vendor detail lets one dashboard aggregate across Auth0,
Keycloak and Cognito while still explaining the exact Auth0 screen. Keeping the map on the
server makes an Auth0 screen addition a normal deploy instead of an SRI-pinned snippet upgrade.
