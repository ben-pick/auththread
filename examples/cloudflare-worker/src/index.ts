import { DurableObject } from "cloudflare:workers";
import {
  createStaticSettings,
  DEFAULT_SAMPLING,
  type SamplingPolicy,
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

interface TenantConfig {
  readonly tenants: readonly TenantEntry[];
}

interface TenantEntry {
  readonly tenant: string;
  readonly provider: string;
  readonly apiKey: string;
  readonly salt: string;
  readonly providerSettings: Auth0FeedSettings;
}

const record = (value: unknown, what: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${what} must be an object`);
  }
  return value as Record<string, unknown>;
};

const text = (value: unknown, what: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${what} must be a non-empty string`);
  }
  return value;
};

const optionalText = (value: unknown, what: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${what} must be a string`);
  return value;
};

const parseJson = (value: string, what: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${what} is not valid JSON`);
  }
};

const decodeFeedSettings = (
  value: unknown,
  what: string,
): Auth0FeedSettings => {
  const input = value === undefined ? {} : record(value, what);
  const settings: {
    feedSecret?: string;
    domain?: string;
    managementToken?: string;
  } = {};

  const feedSecret = optionalText(input.feedSecret, `${what}.feedSecret`);
  if (feedSecret !== undefined) settings.feedSecret = feedSecret;
  const domain = optionalText(input.domain, `${what}.domain`);
  if (domain !== undefined) settings.domain = domain;
  const managementToken = optionalText(
    input.managementToken,
    `${what}.managementToken`,
  );
  if (managementToken !== undefined) settings.managementToken = managementToken;

  return settings;
};

const decodeTenant = (value: unknown, index: number): TenantEntry => {
  const what = `AUTHTHREAD_TENANTS.tenants[${index}]`;
  const input = record(value, what);
  return {
    tenant: text(input.tenant, `${what}.tenant`),
    provider: text(input.provider, `${what}.provider`),
    apiKey: text(input.apiKey, `${what}.apiKey`),
    salt: text(input.salt, `${what}.salt`),
    providerSettings: decodeFeedSettings(
      input.providerSettings,
      `${what}.providerSettings`,
    ),
  };
};

const parseTenants = (value: string): TenantConfig => {
  const parsed = record(
    parseJson(value, "AUTHTHREAD_TENANTS"),
    "AUTHTHREAD_TENANTS",
  );
  if (!Array.isArray(parsed.tenants)) {
    throw new Error("AUTHTHREAD_TENANTS needs a tenants array");
  }
  return { tenants: parsed.tenants.map(decodeTenant) };
};

const parseHeaders = (value: string): Record<string, string> => {
  const parsed = record(parseJson(value, "OTLP_HEADERS"), "OTLP_HEADERS");
  const headers: Record<string, string> = {};
  for (const [key, header] of Object.entries(parsed)) {
    headers[key] = text(header, `OTLP_HEADERS.${key}`);
  }
  return headers;
};

const onError = (error: unknown): void => {
  console.error(
    JSON.stringify({
      message: "auththread runtime error",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
};

const sinksFor = (env: Env): Sink[] => {
  const raw = Number(env.AUTHTHREAD_SAMPLE_SUCCESS ?? "0.1");
  const sampling: SamplingPolicy = {
    ...DEFAULT_SAMPLING,
    successRate: Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 1) : 0.1,
  };

  return [
    createWideEventSink({ sampling }),
    ...(env.OTLP_ENDPOINT === undefined
      ? []
      : [
          createOtlpSink({
            sampling,
            exporter: createOtlpExporter({
              endpoint: env.OTLP_ENDPOINT,
              serviceName: "auththread",
              headers:
                env.OTLP_HEADERS === undefined
                  ? {}
                  : parseHeaders(env.OTLP_HEADERS),
            }),
          }),
        ]),
  ];
};

export class JourneyDurableObject extends DurableObject<Env> {
  readonly inner: InstanceType<ReturnType<typeof createJourneyDurableObject>>;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    const config = parseTenants(env.AUTHTHREAD_TENANTS);
    const tenants: TenantSettings<Auth0FeedSettings>[] = config.tenants.map(
      (tenant) => ({
        tenant: tenant.tenant,
        provider: tenant.provider,
        apiKeyHash: sha256Hex(tenant.apiKey),
        salt: tenant.salt,
        providerSettings: tenant.providerSettings,
      }),
    );

    const JourneyRuntime = createJourneyDurableObject({
      providers: [oidcAdapter, auth0Adapter],
      sinks: sinksFor(env),
      settings: createStaticSettings(tenants),
      captureBatches: false,
      quietMs: Number(env.AUTHTHREAD_QUIET_MS ?? "600000"),
      onError,
    });
    this.inner = new JourneyRuntime(state);
  }

  override fetch(request: Request): Promise<Response> {
    return this.inner.fetch(request);
  }

  override alarm(): Promise<void> {
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

let cached: { sourceHash: string; directory: KeyDirectory } | null = null;

const directoryFor = (source: string): KeyDirectory => {
  const sourceHash = sha256Hex(source);
  if (cached?.sourceHash === sourceHash) return cached.directory;
  const config = parseTenants(source);
  const directory = createKeyDirectory(
    config.tenants.map((tenant) => ({
      tenant: tenant.tenant,
      apiKey: tenant.apiKey,
    })),
  );
  cached = { sourceHash, directory };
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
