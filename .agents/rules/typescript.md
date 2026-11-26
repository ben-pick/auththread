---
description: TypeScript rules for every package.
paths:
  - "packages/**/*.ts"
  - "scripts/**/*.ts"
---

# TypeScript

- Strict everywhere, including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- Brand semantic ids. `TraceId` and `SpanId` are not interchangeable strings. Effect Schema
  produces the same branded values at the wire boundary.
- Parse untrusted data once, at the boundary, with Effect Schema in `stitcher/src/wire.ts`,
  the provider feeds and the settings loader. Inside the system, trust the types.
- Relative imports carry the `.ts` extension so Node 24 can run the source directly.
- No `any`. No double casts. A cast is a claim the decoder should have made.
- Server contracts return `Effect`. Browser helpers are plain TypeScript. See ADR-0002 and
  ADR-0003.
