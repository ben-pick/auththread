---
id: "0006"
title: "MIT licence with DCO, paid service in its own repo"
scope:
  - "**"
---

# 0006. MIT licence with DCO, paid service in its own repo

## Outcome

- This repo is MIT licensed.
- Every commit carries a DCO sign-off.
- The paid service (replay tests, coverage, AI root cause) lives in a separate repository and
  consumes only the neutral attributes and adapter interfaces published here.

## Rules

- No dependency may force a different licence on the published packages.
- Never relicense a released version.
- The paid service must not require a private fork of an open adapter.
