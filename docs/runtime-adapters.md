# Runtime adapters

The stitcher is platform-neutral. A runtime adapter supplies four things:

| Capability | Interface | Node | Cloudflare |
| --- | --- | --- | --- |
| HTTP | `fetch(Request)` | `node:http` adapter | Worker `fetch` |
| Durable buffer | `JourneyBuffer` | memory or SQLite | Durable Object storage |
| Delayed execution | `Scheduler` | timers | alarms |
| Config | `SettingsStore` | file or env | secret JSON |

## Three levels of API

1. **Turnkey:** `createNodeRuntime` or `createCloudflareRuntime`.
2. **Compose:** `createStitcher({ providers, buffer, scheduler, settings, sinks })`.
3. **Primitives:** implement `JourneyBuffer`, `Scheduler` and `SettingsStore`.

## Rules

- Core never imports a runtime, provider or sink.
- Runtime packages never import providers or sinks; composition happens in the
  runtime entrypoint or the application.
- A platform is supported when the composed runtime passes the runtime
  conformance suite: HTTP auth, span/event ingestion, join, finalise, sink
  output, restart recovery and tenant isolation.
- Do not do work at module scope in a Worker. Cloudflare's startup budget is
  one second; large schemas and eager initialization fail the deploy.
- Durable Object classes must be exported by the Worker entrypoint. A package
  can export the class, but the user's Worker must re-export it by name.
- Never use both `exports` and `migrations` in one `wrangler.jsonc`.
- A Worker template is a demo and a starting point, not an upgrade channel.
  The npm library is the upgrade channel.

## Minimum platform

A new runtime needs durable key/value or SQL storage, delayed execution,
configuration/secrets and outbound HTTP. AWS Lambda, for example, needs an
HTTP adapter plus a queue or cron for `Scheduler`; a plain request/response
function is not enough for quiet-period finalisation.
