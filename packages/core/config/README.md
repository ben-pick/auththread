# @auththread/config

Shared tenant configuration parsing and validation for every auththread runtime.

## Install

```sh
pnpm add @auththread/config
```

## Usage

```ts
import { parseTenantConfig, toTenantSettings } from "@auththread/config";

const config = parseTenantConfig(JSON.parse(raw));
const settings = toTenantSettings(config);
```

## Documentation

See the [auththread repository](https://github.com/ben-pick/auththread) for the
full documentation, deployment instructions and conformance rules.

## License

MIT
