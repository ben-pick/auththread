import { auth0Adapter } from "@auththread/auth0";
import { oidcAdapter } from "@auththread/oidc";
import { createNodeRuntime } from "@auththread/runtime-node";
import { ConfigError, loadServerConfig } from "./config.ts";
import { createSinks } from "./sinks.ts";

let config: ReturnType<typeof loadServerConfig>;
try {
  config = loadServerConfig(process.env);
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

const runtime = createNodeRuntime({
  config: config.tenants,
  providers: [oidcAdapter, auth0Adapter],
  sinks: createSinks(config),
  storage: config.storage,
  ...(config.quietMs === undefined ? {} : { quietMs: config.quietMs }),
  ...(config.correlationWindowMs === undefined
    ? {}
    : { correlationWindowMs: config.correlationWindowMs }),
  ...(config.ttlMs === undefined ? {} : { ttlMs: config.ttlMs }),
  onError: (error) => console.error("auththread:", error),
});

const { port: bound } = await runtime.listen(config.port);
console.log(`auththread listening on :${bound}`);

let closing = false;
const stop = (): void => {
  if (closing) return;
  closing = true;
  void runtime.close().then(() => process.exit(0));
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
