# @auththread/stitcher

Joins browser, hosted page, hook and provider events into one auth journey.

## Install

```sh
pnpm add @auththread/stitcher
```

## Usage

```ts
import { createStitcher } from "@auththread/stitcher";

const stitcher = createStitcher({
  providers,
  buffer,
  scheduler,
  settings,
  sinks,
});
```

## Documentation

See the [auththread repository](https://github.com/ben-pick/auththread) for the
full documentation, deployment instructions and conformance rules.

## License

MIT
