# @auththread/runtime-node

Node runtime layers: memory or SQLite buffer, poll scheduler, JSON settings and
an Effect HTTP server.

```ts
import { nodeServerLayer, fileSettingsLayer, sqliteStoreLayer } from "@auththread/runtime-node";

const http = nodeServerLayer({ port: 8787 }).pipe(
  Layer.provide(
    stitcherLayer({ providers, sinks }).pipe(
      Layer.provide(sqliteStoreLayer({ path: "/var/lib/auththread/state.db" })),
      Layer.provide(fileSettingsLayer("/etc/auththread/config.json")),
    ),
  ),
);
```

See the [auththread repository](https://github.com/ben-pick/auththread) for the
full composition and the install contract.

## License

MIT
