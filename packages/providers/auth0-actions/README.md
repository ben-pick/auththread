# @auththread/auth0-actions

CommonJS wrapper for Auth0 Actions. It bundles `withTrace` and the small schema
helpers it needs, so the published package has no runtime dependencies.

Auth0 Actions run JavaScript in CommonJS form. In the Auth0 Dashboard, open
**Actions → Library → your Action → Modules**, add `@auththread/auth0-actions`
at the release version, then use `require`:

```js
const { withTrace } = require("@auththread/auth0-actions");

exports.onExecutePostLogin = withTrace(
  {
    name: "auththread",
    version: "1",
    transport: "http",
    endpoint: "https://auth-telemetry.example.com",
    token: event.secrets.AUTHTHREAD_KEY,
  },
  async (event, api) => {
    // your existing Action body
  },
);
```

The wrapper never throws from the tracing path and leaves the handler's result
and errors unchanged. The HTTP transport has a hard 250 ms default timeout.

Through the Management API, the dependency is:

```json
{
  "name": "@auththread/auth0-actions",
  "version": "0.0.0"
}
```

Use an Actions secret such as `AUTHTHREAD_KEY` for the tenant key and keep the
endpoint in code or a secret. The Action must be JavaScript, and the package is
pure JavaScript with no native modules. The bundled file is about 9 kB, well
under the 100 kB Action code limit.

Auth0 limitations that matter here:

- Actions source must be JavaScript, not TypeScript.
- Modules are loaded with `require` from the public npm registry.
- Native modules and private registries are not supported.
- Each Action’s code is limited to 100 kB, excluding npm dependencies.

See the repository `docs/publishing.md` and
`packages/providers/auth0/page/README.md` for the rest of the integration.
