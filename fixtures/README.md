# Fixtures

Recorded provider payloads live here, redacted before commit. The conformance suites use
them to prove that parsing, verification and classification still work.

- `auth0/log-stream.json` holds two Auth0 Log Stream events: a wrong-password failure and a
  success that carries `ext_trace_id` in `details`.

Redact before adding a fixture: replace user ids and emails, strip tokens, and keep the
shape and the error codes. A fixture with real personal data is a bug.
