# @auththread/sdk

Infrastructure-neutral server SDK: compose the stitcher or use the Node and Cloudflare runtimes.

## Install

```sh
pnpm add @auththread/sdk
```

## Usage

### Node

```ts
import { createNodeRuntime } from "@auththread/sdk/node";

const runtime = createNodeRuntime({
  config,
  providers: [auth0Adapter, oidcAdapter],
  sinks: [createWideEventSink()],
  storage: { type: "sqlite", path: "/var/lib/auththread/state.db" },
});

await runtime.listen(8787);
```

### Cloudflare

```ts
import { createCloudflareRuntime } from "@auththread/sdk/cloudflare";

const runtime = createCloudflareRuntime({
  providers: [auth0Adapter, oidcAdapter],
  sinks: () => [createWideEventSink()],
});

export default { fetch: runtime.fetch };
export const JourneyDurableObject = runtime.JourneyDurableObject;
```

### Any Fetch runtime

```ts
import { createStitcher } from "@auththread/sdk";

const stitcher = createStitcher({
  providers,
  buffer: myBuffer,
  scheduler: myScheduler,
  settings: mySettings,
  sinks,
});

export default { fetch: stitcher.fetch };
```

## Documentation

See the [auththread repository](https://github.com/ben-pick/auththread) for the
full documentation, deployment instructions and conformance rules.

## License

MIT
