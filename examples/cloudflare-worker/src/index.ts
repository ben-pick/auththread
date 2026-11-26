import {
  createStaticSettings,
  type Sink,
  type TenantSettings,
} from "@auththread/adapter-kit";
import { type Auth0FeedSettings, auth0Adapter } from "@auththread/auth0";
import { oidcAdapter } from "@auththread/oidc";
import { createOtlpExporter } from "@auththread/otlp";
import {
  createJourneyDurableObject,
  createKeyDirectory,
  type KeyDirectory,
} from "@auththread/runtime-cloudflare";
import { sha256Hex } from "@auththread/schema";
import { createOtlpSink } from "@auththread/sink-otlp";
import { createWideEventSink } from "@auththread/sink-wide-event";

export interface Env {
  readonly JOURNEY: DurableObjectNamespace;
  readonly AUTHTHREAD_TENANTS: string;
  readonly AUTHTHREAD_QUIET_MS?: string;
  readonly OTLP_ENDPOINT?: string;
  readonly OTLP_HEADERS?: string;
}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): { fetch(request: Request): Promise<Response> };
}

interface DurableObjectId {
  readonly name?: string;
}

interface TenantConfig {
  readonly tenants: Array<{
    readonly tenant: string;
    readonly provider: string;
    readonly apiKey: string;
    readonly salt: string;
    readonly providerSettings?: Auth0FeedSettings;
  }>;
}

const parseTenants = (value: string): TenantConfig => {
  const parsed = JSON.parse(value) as TenantConfig;
  if (!Array.isArray(parsed.tenants))
    throw new Error("AUTHTHREAD_TENANTS needs a tenants array");
  return parsed;
};

const sinksFor = (env: Env): Sink[] => [
  createWideEventSink(),
  ...(env.OTLP_ENDPOINT === undefined
    ? []
    : [
        createOtlpSink({
          exporter: createOtlpExporter({
            endpoint: env.OTLP_ENDPOINT,
            serviceName: "auththread",
            headers:
              env.OTLP_HEADERS === undefined
                ? {}
                : (JSON.parse(env.OTLP_HEADERS) as Record<string, string>),
          }),
        }),
      ]),
];

export class JourneyDurableObject {
  readonly inner: InstanceType<ReturnType<typeof createJourneyDurableObject>>;

  constructor(state: unknown, env: Env) {
    const config = parseTenants(env.AUTHTHREAD_TENANTS);
    const tenants: TenantSettings<Auth0FeedSettings>[] = config.tenants.map(
      (tenant) => ({
        tenant: tenant.tenant,
        provider: tenant.provider,
        apiKeyHash: sha256Hex(tenant.apiKey),
        salt: tenant.salt,
        providerSettings: tenant.providerSettings ?? {},
      }),
    );

    const DurableObject = createJourneyDurableObject({
      providers: [oidcAdapter, auth0Adapter],
      sinks: sinksFor(env),
      settings: createStaticSettings(tenants),
      captureBatches: false,
      quietMs: Number(env.AUTHTHREAD_QUIET_MS ?? "600000"),
    });
    this.inner = new DurableObject(state as never);
  }

  fetch(request: Request): Promise<Response> {
    return this.inner.fetch(request);
  }

  alarm(): Promise<void> {
    return this.inner.alarm();
  }
}

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers":
    "authorization, content-type, x-auththread-key",
  "access-control-max-age": "86400",
};

let cached: { source: string; directory: KeyDirectory } | null = null;

const directoryFor = (source: string): KeyDirectory => {
  if (cached?.source === source) return cached.directory;
  const config = parseTenants(source);
  const directory = createKeyDirectory(
    config.tenants.map((tenant) => ({
      tenant: tenant.tenant,
      apiKey: tenant.apiKey,
    })),
  );
  cached = { source, directory };
  return directory;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (new URL(request.url).pathname === "/healthz") {
      return Response.json({ ok: true });
    }

    const tenant = await directoryFor(env.AUTHTHREAD_TENANTS).resolve(request);
    if (tenant === null) {
      return Response.json(
        { error: "unauthorized" },
        { status: 401, headers: CORS },
      );
    }

    const id = env.JOURNEY.idFromName(tenant);
    return env.JOURNEY.get(id).fetch(request);
  },
};
