# @auththread/otlp

Tiny OTLP/HTTP JSON encoder and exporter for auth spans.

## Install

```sh
pnpm add @auththread/otlp
```

## Usage

```ts
import { createOtlpExporter } from "@auththread/otlp";

const exporter = createOtlpExporter({
  endpoint: "https://otlp.example.com/v1/traces",
  serviceName: "auththread",
});
```

## Documentation

See the [auththread repository](https://github.com/ben-pick/auththread) for the
full documentation, deployment instructions and conformance rules.

## License

MIT
