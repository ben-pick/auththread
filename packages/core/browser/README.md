# @auththread/browser

Provider-neutral browser SDK. Carries one trace ID across the login redirect.

## Install

```sh
pnpm add @auththread/browser
```

## Usage

```ts
import { init } from "@auththread/browser";
import { auth0 } from "@auththread/auth0/browser";

const thread = init({
  endpoint: "https://auth-telemetry.example.com",
  key: "at_pub_...",
  tenant: "acme",
  provider: auth0(),
});
```

## Documentation

See the [auththread repository](https://github.com/ben-pick/auththread) for the
full documentation, deployment instructions and conformance rules.

## License

MIT
