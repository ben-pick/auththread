import { parseSpanId, type Span, type TraceId } from "@auththread/schema";
import type { JourneyBuffer, JourneyItem, Scheduler } from "../runtime.ts";
import type { ConformanceReport } from "./report.ts";
import { checker } from "./report.ts";

export interface RuntimeFixture {
  readonly traceId: TraceId;
  readonly otherTraceId: TraceId;
  readonly tenant: string;
  readonly spans: readonly Span[];
  readonly nowMs: number;
}

export interface RuntimeConformanceInput {
  readonly buffer: JourneyBuffer;
  readonly scheduler: Scheduler;
  readonly fixture: RuntimeFixture;
}

const item = (span: Span): JourneyItem => ({
  kind: "span",
  id: `span:${span.spanId}`,
  atMs: span.startMs,
  span,
});

export async function runRuntimeConformance(
  input: RuntimeConformanceInput,
): Promise<ConformanceReport> {
  const { buffer, scheduler, fixture } = input;
  const result = checker("runtime");

  const first = fixture.spans[0];
  if (first === undefined) {
    result.check(false, "fixture has no spans");
    return result.report();
  }
  const second = fixture.spans[1] ?? first;

  await buffer.append(fixture.traceId, item(first));
  result.check(
    (await buffer.read(fixture.traceId)).length === 1,
    "append then read lost an item",
  );

  await buffer.append(fixture.traceId, item(first));
  result.check(
    (await buffer.read(fixture.traceId)).length === 1,
    "a duplicate item was stored twice",
  );

  await buffer.append(fixture.traceId, item(second));
  const contents = await buffer.read(fixture.traceId);
  result.check(
    new Set(contents.map((entry) => entry.id)).size === contents.length,
    "read returned duplicate ids",
  );

  const many = Array.from({ length: 20 }, (_, index) =>
    item({
      ...first,
      spanId: parseSpanId((index + 1).toString(16).padStart(16, "0")),
    }),
  );
  await Promise.all(
    many.map((entry) => buffer.append(fixture.otherTraceId, entry)),
  );
  const concurrent = await buffer.read(fixture.otherTraceId);
  result.check(
    concurrent.length === 20,
    `concurrent appends stored ${concurrent.length} of 20 distinct items`,
  );
  result.check(
    new Set(concurrent.map((entry) => entry.id)).size === concurrent.length,
    "concurrent appends produced duplicates",
  );
  result.check(
    (await buffer.read(fixture.traceId)).length === 2,
    "concurrent appends leaked into another trace",
  );

  await buffer.indexHints(
    fixture.traceId,
    { tenant: fixture.tenant, userHash: "u_abc", clientId: "client_1" },
    fixture.nowMs,
  );
  const inside = await buffer.findCandidates(
    { tenant: fixture.tenant, userHash: "u_abc" },
    2000,
    fixture.nowMs + 1000,
  );
  result.check(
    inside.includes(fixture.traceId),
    "a hint inside the window found no candidate",
  );
  const outside = await buffer.findCandidates(
    { tenant: fixture.tenant, userHash: "u_abc" },
    2000,
    fixture.nowMs + 5000,
  );
  result.check(
    !outside.includes(fixture.traceId),
    "a hint outside the window still found a candidate",
  );
  result.check(
    (
      await buffer.findCandidates(
        { tenant: fixture.tenant, userHash: "u_none" },
        2000,
        fixture.nowMs,
      )
    ).length === 0,
    "an unknown hint found a candidate",
  );

  await buffer.indexHints(
    fixture.otherTraceId,
    { tenant: fixture.tenant },
    fixture.nowMs,
  );
  result.check(
    (
      await buffer.findCandidates(
        { tenant: fixture.tenant, userHash: "u_abc" },
        2000,
        fixture.nowMs + 1000,
      )
    ).includes(fixture.otherTraceId) === false,
    "a tenant-only index matched a user-hash query",
  );

  await buffer.indexHints(
    fixture.traceId,
    { tenant: fixture.tenant, transactionId: "tx_1" },
    fixture.nowMs,
  );
  result.check(
    (await buffer.findByTransaction(
      fixture.tenant,
      "tx_1",
      2000,
      fixture.nowMs + 1000,
    )) === fixture.traceId,
    "a transaction inside the window found no trace",
  );
  result.check(
    (await buffer.findByTransaction(
      fixture.tenant,
      "tx_1",
      2000,
      fixture.nowMs + 5000,
    )) === null,
    "a transaction outside the window still found a trace",
  );
  result.check(
    (await buffer.findByTransaction(
      fixture.tenant,
      "tx_missing",
      2000,
      fixture.nowMs,
    )) === null,
    "an unknown transaction found a trace",
  );
  result.check(
    (await buffer.findByTransaction(
      `${fixture.tenant}-other`,
      "tx_1",
      2000,
      fixture.nowMs,
    )) === null,
    "a transaction lookup crossed tenants",
  );

  const fired: TraceId[] = [];
  scheduler.onDue(async (traceId) => {
    fired.push(traceId);
  });
  await scheduler.schedule(fixture.traceId, fixture.nowMs + 100);
  await scheduler.schedule(fixture.otherTraceId, fixture.nowMs + 200);
  await scheduler.runDue(fixture.nowMs + 50);
  result.check(fired.length === 0, "a timer fired before it was due");
  await scheduler.runDue(fixture.nowMs + 100);
  result.check(fired.includes(fixture.traceId), "the first timer did not fire");
  result.check(
    !fired.includes(fixture.otherTraceId),
    "the second timer fired early",
  );
  await scheduler.cancel(fixture.otherTraceId);
  await scheduler.runDue(fixture.nowMs + 300);
  result.check(
    !fired.includes(fixture.otherTraceId),
    "a cancelled timer fired",
  );

  await buffer.delete(fixture.otherTraceId);
  result.check(
    (await buffer.read(fixture.otherTraceId)).length === 0,
    "delete did not remove the trace",
  );

  await buffer.append(
    fixture.otherTraceId,
    item({
      ...first,
      spanId: second.spanId,
      startMs: fixture.nowMs - 10_000,
    }),
  );
  const dropped = await buffer.prune(fixture.nowMs - 5_000);
  result.check(dropped === 1, `prune dropped ${dropped} journeys instead of 1`);

  return result.report();
}
