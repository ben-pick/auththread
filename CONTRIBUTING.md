# Contributing

DCO sign-off is required on every commit (`git commit -s`). By signing off you certify the
Developer Certificate of Origin 1.1.

1. Read `AGENTS.md` and the rule that matches the files you touch.
2. Add a provider, runtime or sink by copying the contract in `@auththread/adapter-kit` and
   shipping a conformance test next to it.
3. Run `mise exec -- pnpm check` before opening a pull request.
4. Add fixtures for any provider behaviour you claim. Redact them first.
5. Record a decision in `docs/decisions/` when you change an architecture rule.

Adapters without a maintainer for 90 days move to experimental. Code owners are listed in
`CODEOWNERS`.
