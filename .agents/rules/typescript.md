---
description: TypeScript rules for every package.
paths:
  - "packages/**/*.ts"
  - "scripts/**/*.ts"
---

# TypeScript

- Strict everywhere, including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- Brand semantic ids. `TraceId` and `SpanId` are not interchangeable strings.
- Parse untrusted data once, at the boundary, in `stitcher/src/decode.ts` and each provider
  feed. Inside the system, trust the types.
- Relative imports carry the `.ts` extension so Node 24 can run the source directly.
- No `any`. No double casts. A cast is a claim the decoder should have made.
- Public contracts are plain TypeScript and Promise based. See ADR-0002.
