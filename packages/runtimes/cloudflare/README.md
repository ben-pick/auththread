# @auththread/runtime-cloudflare

Cloudflare Durable Object buffer, alarm scheduler and key directory.

```ts
import { createJourneyDurableObject } from "@auththread/runtime-cloudflare";

const JourneyRuntime = createJourneyDurableObject({
  providers,
  sinks,
  settings: staticSettingsLayer(tenants),
});
```

The Worker must export the returned class as `JourneyDurableObject` and bind it
in `wrangler.jsonc`.

## License

MIT
