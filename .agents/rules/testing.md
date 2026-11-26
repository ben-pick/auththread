---
description: Tests, conformance and fixtures.
paths:
  - "**/*.test.ts"
  - "packages/core/adapter-kit/src/conformance/**"
---

# Testing

- Vitest, colocated next to the code as `*.test.ts`.
- Test what a consumer observes: a journey outcome, an exported batch, an HTTP status.
- Every adapter ships conformance coverage in its own package. A green suite is what
  "supported" means (ADR-0004).
- The end-to-end suite must keep a deliberately broken fake that fails, so the suite cannot
  pass by doing nothing.
- Redaction gets property style coverage: no raw identifier survives any path.
- Never assert on internal call order when the observable output is the contract.
