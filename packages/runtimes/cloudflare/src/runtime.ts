import {
  createStaticSettings,
  type ProviderAdapter,
  type Sink,
  type TenantSettings,
} from "@auththread/adapter-kit";
import {
  type AuththreadConfig,
  parseTenantConfig,
  toTenantSettings,
} from "@auththread/config";
import { createKeyDirectory, type KeyDirectory } from "./directory.ts";
import {
  createJourneyDurableObject,
  type JourneyDurableObjectInstance,
  type JourneyDurableObjectOptions,
} from "./durable-object.ts";
import type { DurableObjectStateLike } from "./storage.ts";

export interface DurableObjectIdLike {
  readonly name?: string;
}

export interface DurableObjectStubLike {
  fetch(request: Request): Promise<Response>;
}

export interface DurableObjectNamespaceLike<Id = DurableObjectIdLike> {
  idFromName(name: string): Id;
  get(id: Id): DurableObjectStubLike;
}

export interface CloudflareEnv {
  readonly JOURNEY: DurableObjectNamespaceLike;
  readonly AUTHTHREAD_TENANTS: string;
  readonly AUTHTHREAD_QUIET_MS?: string;
  readonly OTLP_ENDPOINT?: string;
  readonly OTLP_HEADERS?: string;
}

export interface CloudflareRuntimeOptions {
  readonly providers: readonly ProviderAdapter<unknown>[];
  readonly sinks: (env: CloudflareEnv) => readonly Sink[];
  /** Defaults to parseTenantConfig(JSON.parse(env.AUTHTHREAD_TENANTS)). */
  readonly config?: (env: CloudflareEnv) => AuththreadConfig;
  readonly quietMs?: (env: CloudflareEnv) => number;
  readonly onError?: (error: unknown) => void;
}

export interface CloudflareRuntime {
  fetch(request: Request, env: CloudflareEnv): Promise<Response>;
  readonly JourneyDurableObject: new (
    state: DurableObjectStateLike,
    env: CloudflareEnv,
  ) => JourneyDurableObjectInstance;
}

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers":
    "authorization, content-type, x-auththread-key",
  "access-control-max-age": "86400",
};

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: CORS });

const configOf = (
  options: CloudflareRuntimeOptions,
  env: CloudflareEnv,
): AuththreadConfig =>
  options.config?.(env) ??
  parseTenantConfig(JSON.parse(env.AUTHTHREAD_TENANTS));

const settingsOf = (config: AuththreadConfig): TenantSettings<unknown>[] =>
  toTenantSettings(config);

const directoryKey = (env: CloudflareEnv): string => env.AUTHTHREAD_TENANTS;

/**
 * Compose the Cloudflare Worker and its Durable Object from the shared config.
 * The Worker only authenticates and routes; the object owns the stitcher state.
 */
export function createCloudflareRuntime(
  options: CloudflareRuntimeOptions,
): CloudflareRuntime {
  let cache: { source: string; directory: KeyDirectory } | null = null;

  const directoryFor = (env: CloudflareEnv): KeyDirectory => {
    const source = directoryKey(env);
    if (cache?.source === source) return cache.directory;
    const config = configOf(options, env);
    const directory = createKeyDirectory(
      config.tenants.map((tenant) => ({
        tenant: tenant.tenant,
        ...(tenant.apiKey === undefined ? {} : { apiKey: tenant.apiKey }),
        ...(tenant.apiKeyHash === undefined
          ? {}
          : { apiKeyHash: tenant.apiKeyHash }),
      })),
    );
    cache = { source, directory };
    return directory;
  };

  const durableObjectOptions = (
    env: CloudflareEnv,
  ): JourneyDurableObjectOptions => {
    const config = configOf(options, env);
    const quietMs =
      options.quietMs?.(env) ??
      (env.AUTHTHREAD_QUIET_MS === undefined
        ? undefined
        : Number(env.AUTHTHREAD_QUIET_MS));
    return {
      providers: options.providers,
      sinks: options.sinks(env),
      settings: createStaticSettings(settingsOf(config)),
      ...(quietMs === undefined ? {} : { quietMs }),
      ...(options.onError === undefined ? {} : { onError: options.onError }),
    };
  };

  class JourneyDurableObject implements JourneyDurableObjectInstance {
    readonly inner: JourneyDurableObjectInstance;

    constructor(state: DurableObjectStateLike, env: CloudflareEnv) {
      const Base = createJourneyDurableObject(durableObjectOptions(env));
      this.inner = new Base(state);
    }

    get stitcher() {
      return this.inner.stitcher;
    }

    get scheduler() {
      return this.inner.scheduler;
    }

    fetch(request: Request): Promise<Response> {
      return this.inner.fetch(request);
    }

    alarm(): Promise<void> {
      return this.inner.alarm();
    }
  }

  return {
    JourneyDurableObject,
    async fetch(request, env) {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS });
      }
      if (new URL(request.url).pathname === "/healthz") {
        return json({ ok: true });
      }

      const tenant = await directoryFor(env).resolve(request);
      if (tenant === null) return json({ error: "unauthorized" }, 401);

      const id = env.JOURNEY.idFromName(tenant);
      return env.JOURNEY.get(id).fetch(request);
    },
  };
}
