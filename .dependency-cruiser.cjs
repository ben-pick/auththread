/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular dependencies make modules hard to reason about.",
      from: {},
      to: { circular: true },
    },
    {
      name: "core-no-adapters",
      severity: "error",
      comment:
        "Core never imports a provider, runtime or sink: adapters depend on core, not the reverse.",
      from: { path: "^packages/core/" },
      to: { path: "^packages/(providers|runtimes|sinks)/" },
    },
    {
      name: "providers-no-runtimes-or-sinks",
      severity: "error",
      comment:
        "A provider adapter is portable: it may not import a runtime or a sink.",
      from: { path: "^packages/providers/" },
      to: { path: "^packages/(runtimes|sinks)/" },
    },
    {
      name: "runtimes-no-providers-or-sinks",
      severity: "error",
      comment:
        "A runtime receives providers and sinks as dependencies. It never imports a concrete one.",
      from: { path: "^packages/runtimes/" },
      to: { path: "^packages/(providers|sinks)/" },
    },
    {
      name: "sinks-no-providers-or-runtimes",
      severity: "error",
      comment:
        "A sink is output only: it may not import a provider or a runtime.",
      from: { path: "^packages/sinks/" },
      to: { path: "^packages/(providers|runtimes)/" },
    },
    {
      name: "no-examples-imports",
      severity: "error",
      comment:
        "Examples consume published packages and are never imported by them.",
      from: { pathNot: "^(examples/|packages/tooling/)" },
      to: { path: "^examples/" },
    },
    {
      name: "no-node-core-outside-node-runtime",
      severity: "error",
      comment:
        "Core, providers and sinks also run in browsers and Workers. Only the Node runtime, tooling and examples may import Node built-ins.",
      from: {
        pathNot:
          "^(packages/runtimes/node/|packages/tooling/|examples/|scripts/)",
      },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "cloudflare-only-in-cloudflare-runtime",
      severity: "error",
      comment:
        "@cloudflare/* and cloudflare:* may only appear in the Cloudflare runtime.",
      from: {
        pathNot: "^(packages/runtimes/cloudflare/|packages/tooling/|examples/)",
      },
      to: { path: "(^cloudflare:|^@cloudflare/|node_modules/.*@cloudflare/)" },
    },
    {
      name: "edge-zone-has-no-runtime-dependencies",
      severity: "error",
      comment:
        "schema, otlp, adapter-kit and browser ship to browsers and login pages. They carry no third-party runtime code.",
      from: {
        path: "^packages/core/(schema|otlp|adapter-kit|browser)/src/",
        pathNot: "\\.test\\.ts$",
      },
      to: { dependencyTypes: ["npm", "npm-optional"] },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: {
      path: "^(packages|examples)/.*(dist|coverage|\\.turbo|\\.wrangler)/",
    },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
};
