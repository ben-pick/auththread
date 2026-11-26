# @auththread/runtime-cloudflare

Cloudflare runtime: Durable Object buffer, alarm scheduler, one object per tenant.

## Install

```sh
pnpm add @auththread/runtime-cloudflare
```

## Usage

```ts
import { createCloudflareRuntime } from "@auththread/runtime-cloudflare";

const runtime = createCloudflareRuntime({ providers, sinks });
export default { fetch: runtime.fetch };
export const JourneyDurableObject = runtime.JourneyDurableObject;
```

## Documentation

See the [auththread repository](https://github.com/ben-pick/auththread) for the
full documentation, deployment instructions and conformance rules.

## License

MIT
