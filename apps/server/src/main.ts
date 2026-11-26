import { auth0Adapter } from "@auththread/auth0";
import { oidcAdapter } from "@auththread/oidc";
import {
  memoryBufferLayer,
  memorySchedulerLayer,
  stitcherLayer,
} from "@auththread/sdk";
import {
  fileSettingsLayer,
  nodeServerLayer,
  sqliteStoreLayer,
} from "@auththread/sdk/node";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { loadServerConfig } from "./config.ts";
import { createSinks } from "./sinks.ts";

const program = Effect.gen(function* () {
  const config = yield* loadServerConfig;

  const stores =
    config.storage.type === "sqlite"
      ? sqliteStoreLayer({
          path: config.storage.path,
          ...(config.quietMs === undefined ? {} : { quietMs: config.quietMs }),
        })
      : Layer.mergeAll(memoryBufferLayer, memorySchedulerLayer);

  const http = nodeServerLayer({ port: config.port }).pipe(
    Layer.provide(
      stitcherLayer({
        providers: [oidcAdapter, auth0Adapter],
        sinks: createSinks(config),
        ...(config.quietMs === undefined ? {} : { quietMs: config.quietMs }),
        ...(config.correlationWindowMs === undefined
          ? {}
          : { correlationWindowMs: config.correlationWindowMs }),
        ...(config.ttlMs === undefined ? {} : { ttlMs: config.ttlMs }),
        onError: (error) => Effect.logError("auththread", error),
      }).pipe(
        Layer.provide(stores),
        Layer.provide(fileSettingsLayer(config.configPath)),
      ),
    ),
  );

  return yield* Layer.launch(http);
}).pipe(Effect.provide(NodeServices.layer));

NodeRuntime.runMain(program);
