# Security

Report vulnerabilities to security@auththread.dev. We acknowledge within three working days
and aim to ship a fix within 90 days of a confirmed report.

## Threat model for v0.1

- **Span injection.** A tenant key is write-only and cannot read another tenant. Requests
  carry the key in a header. Keys in browser bundles are public by design; rotate a key that
  is abused. Rate limiting is not in v0.1.
- **PII leakage.** Emitters redact, and the stitcher redacts again with a tenant salt. A
  missing salt drops identifiers instead of storing them raw. Raw request bodies are never
  read.
- **Page snippet supply chain.** Serve the snippet with Subresource Integrity and a pinned
  version. The build is a plain script with no dependencies.
- **Stitcher downtime.** Every emitter is fire and forget or timed out. A failed send never
  fails a login.
- **Unverified feeds.** A provider feed fails closed when its secret is not configured.
