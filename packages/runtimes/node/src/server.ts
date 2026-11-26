import { createServer } from "node:http";
import { httpRoutes, Stitcher } from "@auththread/stitcher";
import { NodeHttpServer } from "@effect/platform-node";
import { Clock, Duration, Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";

export interface NodeServerOptions {
  readonly port: number;
  readonly host?: string;
  /** How often due journeys are finalised. Default 250 ms. */
  readonly pollIntervalMs?: number;
}

const poll = (intervalMs: number) =>
  Effect.gen(function* () {
    const stitcher = yield* Stitcher;
    yield* Effect.forever(
      Effect.andThen(
        Effect.sleep(Duration.millis(intervalMs)),
        Clock.currentTimeMillis,
      ).pipe(Effect.flatMap((nowMs) => stitcher.runDue(nowMs))),
    );
  });

/** A scoped Layer that serves the stitcher over Node's HTTP server. */
export const nodeServerLayer = (
  options: NodeServerOptions,
): Layer.Layer<
  never,
  import("effect/http/HttpServerError").ServeError,
  Stitcher
> =>
  Layer.merge(
    HttpRouter.serve(httpRoutes).pipe(
      Layer.provide(
        NodeHttpServer.layer(() => createServer(), {
          port: options.port,
          ...(options.host === undefined ? {} : { host: options.host }),
        }),
      ),
    ),
    Layer.effectDiscard(poll(options.pollIntervalMs ?? 250)),
  );
