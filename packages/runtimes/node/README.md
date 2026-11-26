# @auththread/runtime-node

Node server runtime: in-memory or SQLite buffer, timer scheduler, JSON settings.

## Install

```sh
pnpm add @auththread/runtime-node
```

## Usage

```ts
import { createNodeRuntime } from "@auththread/runtime-node";

const runtime = createNodeRuntime({
  config,
  providers,
  sinks,
  storage: { type: "sqlite", path: "/var/lib/auththread/state.db" },
});

await runtime.listen(8787);
```

## Documentation

See the [auththread repository](https://github.com/ben-pick/auththread) for the
full documentation, deployment instructions and conformance rules.

## License

MIT
