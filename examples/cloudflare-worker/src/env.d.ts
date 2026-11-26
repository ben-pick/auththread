// Optional runtime configuration that Wrangler cannot infer from bindings.
// Declared bindings and required secrets come from the generated
// `worker-configuration.d.ts`; this file only adds what is absent there.
interface Env {
  readonly AUTHTHREAD_QUIET_MS?: string;
  readonly AUTHTHREAD_SAMPLE_SUCCESS?: string;
  readonly OTLP_ENDPOINT?: string;
  readonly OTLP_HEADERS?: string;
}
