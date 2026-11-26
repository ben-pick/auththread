# Adding a provider

A provider adapter is a package, not a fork. The conformance suite defines done.

## 1. Copy the contract

Implement `ProviderAdapter<Settings>` from `@auththread/adapter-kit`:

```ts
export interface ProviderAdapter<Settings> {
  id: string;
  capabilities: readonly Capability[];
  authorizeParams(traceId: TraceId): Record<string, string>;
  feeds?: readonly Feed<Settings>[];
  correlate(event: ProviderEvent, settings: Settings): Correlation;
  classify(event: ProviderEvent): { outcome?: Outcome; errorCode?: string };
  fetchConfig?(settings: Settings): Promise<ConfigSnapshot>;
}
```

Capabilities are `browser`, `event-feed`, `hooks`, `hosted-page` and `config`. Declare only
what you can back with a fixture.

## 2. Carry the trace ID

`authorizeParams` returns the query parameters that survive the authorize request. If the
provider has no mechanism, return `{}` and rely on the browser SDK's state round trip.

## 3. Normalise the feed

`feed.parse(body, context)` receives untrusted JSON. Validate it, map vendor codes to neutral
types, and hash every identifier with `context.hashUser`. Never keep a raw email, user id or
token.

`feed.verify` must fail closed when its secret is missing.

## 4. Join and classify

`correlate` returns `{ kind: "exact", traceId }` only when the payload really carries the
trace ID. Otherwise return hints. `classify` maps vendor error codes to `auth.error.code`.

## 5. Prove it

Add recorded, redacted payloads and a test in your package:

```ts
const report = await runProviderConformance(adapter, fixtures);
expect(report.failures).toEqual([]);
```

Include the exact and hint cases, one invalid request, and the PII strings that must not
survive. Add an example with Docker compose where possible, then add a row to the README
matrix.

Adapters without a maintainer for 90 days move to experimental.
