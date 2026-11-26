# @auththread/sdk

Effect-based server SDK facade.

- `@auththread/sdk` exports the stitcher service/layer and runtime contracts.
- `@auththread/sdk/node` exports the Node server, SQLite store and file settings layers.
- `@auththread/sdk/cloudflare` exports the Durable Object runtime and key directory.

```ts
import { stitcherLayer } from "@auththread/sdk";
import { nodeServerLayer, fileSettingsLayer } from "@auththread/sdk/node";
```

The browser SDK is separate at `@auththread/browser`.

## License

MIT
