import { createServer } from "node:http";
import {
  NodeHttpServer,
  NodeRuntime,
  NodeServices,
} from "@effect/platform-node";
import { Config, Effect, Layer, Option, Ref, Schema } from "effect";
import { HttpRouter } from "effect/http";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

const ActionProbeSchema = Schema.Struct({
  ext_trace_id: Schema.optionalKey(Schema.String),
  transaction_id: Schema.optionalKey(Schema.String),
  session_id: Schema.optionalKey(Schema.String),
  client_id: Schema.optionalKey(Schema.String),
});

type ActionProbe = typeof ActionProbeSchema.Type;

const Json = Schema.fromJsonString(Schema.Unknown);
const UnknownArray = Schema.Array(Schema.Unknown);
const UnknownRecord = Schema.Record(Schema.String, Schema.Unknown);
const NonEmptyString = Schema.String.check(Schema.isMinLength(1));

const decodeJson = (text: string): Option.Option<unknown> =>
  Schema.decodeUnknownOption(Json)(text);

const parseEvents = (body: string): readonly unknown[] => {
  const whole = decodeJson(body);
  if (Option.isSome(whole)) {
    const array = Schema.decodeUnknownOption(UnknownArray)(whole.value);
    return Option.isSome(array) ? array.value : [whole.value];
  }

  return body.split("\n").flatMap((line) => {
    if (line.trim().length === 0) return [];
    const decoded = decodeJson(line);
    return Option.isSome(decoded) ? [decoded.value] : [];
  });
};

const asRecord = (value: unknown): Record<string, unknown> =>
  Option.getOrElse(
    Schema.decodeUnknownOption(UnknownRecord)(value),
    () => ({}),
  );

const stringOf = (value: unknown): string | undefined =>
  Option.getOrUndefined(Schema.decodeUnknownOption(NonEmptyString)(value));

const authorized = (
  headers: HttpServerRequest.HttpServerRequest["headers"],
  secret: string | undefined,
): boolean => {
  if (secret === undefined) return true;
  const custom = headers["x-probe-secret"];
  const authorization = headers.authorization;
  return (
    custom === secret ||
    authorization === secret ||
    authorization === `Bearer ${secret}`
  );
};

const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const actions = yield* Ref.make<readonly ActionProbe[]>([]);
    const secret = yield* Config.String("PROBE_SECRET").pipe(
      Config.option,
      Effect.map(Option.getOrUndefined),
    );

    yield* router.add(
      "GET",
      "/healthz",
      Effect.succeed(HttpServerResponse.jsonUnsafe({ ok: true })),
    );

    yield* router.add(
      "POST",
      "/action",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (!authorized(request.headers, secret))
          return HttpServerResponse.setStatus(
            HttpServerResponse.text("bad probe secret"),
            401,
          );

        const body = yield* request.text;
        const payload = Schema.decodeUnknownOption(Json)(body);
        if (Option.isSome(payload)) {
          const decoded = Schema.decodeUnknownOption(ActionProbeSchema)(
            payload.value,
          );
          if (Option.isSome(decoded)) {
            yield* Ref.update(actions, (current) =>
              [...current, decoded.value].slice(-50),
            );
            yield* Effect.log(
              `ACTION transaction=${decoded.value.transaction_id ?? "-"} session=${decoded.value.session_id ?? "-"}` +
                ` ext_trace=${decoded.value.ext_trace_id ?? "-"} client=${decoded.value.client_id ?? "-"}`,
            );
            return HttpServerResponse.jsonUnsafe({
              ok: true,
              body: "action recorded",
            });
          }
        }

        yield* Effect.log(`ACTION_RAW ${body}`);
        return HttpServerResponse.jsonUnsafe({
          ok: true,
          body: "action recorded",
        });
      }),
    );

    yield* router.add(
      "POST",
      "/log-stream",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (!authorized(request.headers, secret))
          return HttpServerResponse.setStatus(
            HttpServerResponse.text("bad probe secret"),
            401,
          );

        const body = yield* request.text;
        for (const raw of parseEvents(body)) {
          const envelope = asRecord(raw);
          const event = asRecord(envelope.data ?? envelope);
          const details = asRecord(event.details);
          const references = asRecord(event.references);
          const executions = asRecord(details.actions).executions;
          const logId =
            stringOf(event.log_id) ?? stringOf(envelope.log_id) ?? "?";
          const transactionId = stringOf(details.transaction_id);
          const sessionId = stringOf(details.session_id);
          const traceId = stringOf(references.trace_id);
          const executionCount =
            Schema.decodeUnknownOption(UnknownArray)(executions);

          yield* Effect.log(
            `STREAM type=${stringOf(event.type) ?? "?"} log=${logId}` +
              ` transaction=${transactionId ?? "-"} session=${sessionId ?? "-"}` +
              ` refs_trace=${traceId ?? "-"} executions=${Option.isSome(executionCount) ? executionCount.value.length : "-"}`,
          );
          yield* Effect.log(`STREAM_RAW ${JSON.stringify(event)}`);

          const current = yield* Ref.get(actions);
          const action = current.find(
            (candidate) =>
              (transactionId !== undefined &&
                candidate.transaction_id === transactionId) ||
              (sessionId !== undefined && candidate.session_id === sessionId),
          );
          if (action === undefined) {
            yield* Effect.log(
              "MATCH none (no Action probe shares the transaction or session)",
            );
            continue;
          }

          const extTraceInStream =
            action.ext_trace_id !== undefined &&
            body.includes(action.ext_trace_id);
          yield* Effect.log(
            `MATCH transaction=${action.transaction_id === transactionId ? "yes" : "no"}` +
              ` session=${action.session_id === sessionId ? "yes" : "no"}` +
              ` ext_trace_in_stream=${extTraceInStream ? "yes" : "no"}` +
              ` refs_trace_equals_ext=${traceId !== undefined && traceId === action.ext_trace_id ? "yes" : "no"}`,
          );
        }

        return HttpServerResponse.jsonUnsafe({
          ok: true,
          body: "stream recorded",
        });
      }),
    );

    yield* router.add(
      "*",
      "/*",
      Effect.succeed(
        HttpServerResponse.setStatus(HttpServerResponse.text("POST only"), 405),
      ),
    );
  }),
);

const program = Effect.gen(function* () {
  const port = yield* Config.Port("PORT").pipe(Config.withDefault(8788));
  yield* Effect.log(`Auth0 probe listening on :${port}`);
  yield* Effect.log(`Log stream URL: http://localhost:${port}/log-stream`);
  yield* Effect.log(`Action URL:     http://localhost:${port}/action`);
  yield* Layer.launch(
    HttpRouter.serve(routes).pipe(
      Layer.provide(NodeHttpServer.layer(() => createServer(), { port })),
    ),
  );
}).pipe(Effect.provide(NodeServices.layer));

NodeRuntime.runMain(program);
