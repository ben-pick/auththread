# Privacy

The default is that nothing personally identifying leaves the customer's process.

- Raw request bodies are never read.
- Keys matching password, secret, token, OTP, credential, cookie or authorization are
  dropped, unless the key is an allow-listed neutral attribute such as `auth.error.code`.
- User identifiers are replaced with `auth.user.hash`, a salted SHA-256 truncated to 16 hex
  characters. The key is `u_` plus the hash.
- Without a tenant salt, identifiers are dropped rather than stored.
- Free text is stripped of email addresses and JWT-shaped strings, then cut to 200 chars.
- Redaction runs twice: in the emitter and again in the stitcher.

What this does not guarantee: a salted hash is pseudonymous, not anonymous. Correlating it
with a provider's own logs can re-identify a user. Treat a journey store with the same care
as an access log.

Known gaps: passkey error names are not captured, and a provider's raw error message
can include text you did not intend. Both are tracked in `PLAN.md`.
