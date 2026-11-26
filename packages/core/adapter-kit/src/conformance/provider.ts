import {
  type Outcome,
  type ProviderEvent,
  parseTraceId,
} from "@auththread/schema";
import { Effect } from "effect";
import type { FeedError } from "../errors.ts";
import type { FeedRequest, ProviderAdapter } from "../provider.ts";
import type { ConformanceReport } from "./report.ts";
import { checker, leaks } from "./report.ts";

export interface ProviderConformanceFixtures<Settings = unknown> {
  readonly settings: Settings;
  /** Recorded, redacted payloads plus the request that delivered them. */
  readonly valid: ReadonlyArray<{
    readonly request: FeedRequest;
    readonly body: unknown;
  }>;
  readonly invalid: readonly FeedRequest[];
  readonly classify: ReadonlyArray<{
    readonly event: ProviderEvent;
    readonly outcome?: Outcome;
    readonly errorCode?: string;
  }>;
  /** Raw identifiers that must not survive normalisation. */
  readonly pii: readonly string[];
  /** Events whose feed item carries the trace ID exactly. */
  readonly exact: readonly ProviderEvent[];
  readonly hints: readonly ProviderEvent[];
}

export const runProviderConformance = <Settings>(
  adapter: ProviderAdapter<Settings>,
  fixtures: ProviderConformanceFixtures<Settings>,
): Effect.Effect<ConformanceReport, FeedError> =>
  Effect.gen(function* () {
    const result = checker(`provider:${adapter.id}`);

    result.check(adapter.id.length > 0, "adapter id is empty");
    result.check(
      adapter.capabilities.length > 0,
      "adapter declares no capabilities",
    );
    result.check(
      new Set(adapter.capabilities).size === adapter.capabilities.length,
      "capabilities contain duplicates",
    );

    const feeds = adapter.feeds ?? [];
    const declaresFeed = adapter.capabilities.includes("event-feed");
    result.check(
      declaresFeed === feeds.length > 0,
      "capability event-feed and the presence of feeds disagree",
    );
    if (declaresFeed) {
      result.check(
        fixtures.valid.length > 0,
        "an event-feed adapter needs at least one valid fixture",
      );
      result.check(
        fixtures.pii.length > 0,
        "an event-feed adapter needs PII fixtures to prove redaction",
      );
    }
    result.check(
      new Set(feeds.map((feed) => feed.path)).size === feeds.length,
      "feed paths are not unique",
    );
    for (const feed of feeds) {
      result.check(
        feed.path.startsWith("/"),
        `feed path ${feed.path} is not absolute`,
      );
    }

    const params = adapter.authorizeParams(parseTraceId("a".repeat(32)));
    result.check(
      Object.values(params).every((value) => typeof value === "string"),
      "authorizeParams returned a non-string value",
    );

    const parsed: ProviderEvent[] = [];
    for (const [index, fixture] of fixtures.valid.entries()) {
      const feed = feeds[index % Math.max(feeds.length, 1)];
      if (feed === undefined) break;

      result.check(
        yield* feed.verify(fixture.request, fixtures.settings),
        `feed ${feed.path} rejected a valid request`,
      );

      const events = yield* feed.parse(fixture.body, {
        hashUser: (value) => `u_fixture_${value.length}`,
      });
      result.check(events.length > 0, `feed ${feed.path} parsed no events`);
      result.check(
        events.every((event) => event.provider === adapter.id),
        `feed ${feed.path} emitted an event for another provider`,
      );
      result.check(
        new Set(events.map((event) => event.id)).size === events.length,
        `feed ${feed.path} emitted duplicate event ids`,
      );
      parsed.push(...events);
    }

    for (const request of fixtures.invalid) {
      for (const feed of feeds) {
        result.check(
          !(yield* feed.verify(request, fixtures.settings)),
          `feed ${feed.path} accepted an unverified request`,
        );
      }
    }

    if (fixtures.pii.length > 0) {
      for (const event of parsed) {
        result.check(
          !leaks(JSON.stringify(event), fixtures.pii),
          `event ${event.id} still contains raw personal data`,
        );
      }
    }

    for (const event of fixtures.exact) {
      const correlation = adapter.correlate(event, fixtures.settings);
      result.check(
        correlation.kind === "exact",
        `event ${event.id} did not correlate exactly`,
      );
      result.check(
        correlation.kind === "exact" && correlation.traceId === event.traceId,
        `event ${event.id} correlated to the wrong trace`,
      );
    }

    for (const event of fixtures.hints) {
      const correlation = adapter.correlate(event, fixtures.settings);
      result.check(
        correlation.kind === "hints",
        `event ${event.id} invented an exact trace`,
      );
    }

    for (const expectation of fixtures.classify) {
      const classified = adapter.classify(expectation.event);
      result.check(
        classified.outcome === expectation.outcome,
        `classify(${expectation.event.type}) returned outcome ${classified.outcome}`,
      );
      if (expectation.errorCode !== undefined) {
        result.check(
          classified.errorCode === expectation.errorCode,
          `classify(${expectation.event.type}) returned code ${classified.errorCode}`,
        );
      }
    }

    if (adapter.capabilities.includes("config")) {
      result.check(
        adapter.fetchConfig !== undefined,
        "config capability without fetchConfig",
      );
    }

    return result.report();
  });
