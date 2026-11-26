import { readFileSync } from "node:fs";
import { DEFAULT_SAMPLING, type SamplingPolicy } from "@auththread/adapter-kit";
import { type AuththreadConfig, parseTenantConfig } from "@auththread/config";
import type { NodeStorage } from "@auththread/runtime-node";

export interface OtlpConfig {
  readonly endpoint: string;
  readonly serviceName: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface WebhookConfig {
  readonly url: string;
  readonly secret: string;
}

export interface S3Config {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly forcePathStyle: boolean;
  readonly prefix: string;
}

export interface ServerConfig {
  readonly tenants: AuththreadConfig;
  readonly port: number;
  readonly storage: NodeStorage;
  readonly quietMs?: number;
  readonly correlationWindowMs?: number;
  readonly ttlMs?: number;
  readonly sampling: SamplingPolicy;
  readonly otlp?: OtlpConfig;
  readonly webhook?: WebhookConfig;
  readonly s3?: S3Config;
}

export class ConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`invalid auththread server config:\n- ${issues.join("\n- ")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

type Env = Readonly<Record<string, string | undefined>>;

const text = (env: Env, name: string): string | undefined => {
  const value = env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
};

const number = (
  env: Env,
  name: string,
  options: { fallback?: number; min: number; max: number },
  issues: string[],
): number | undefined => {
  const raw = text(env, name);
  if (raw === undefined) return options.fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    issues.push(`${name} must be an integer`);
    return undefined;
  }
  if (value < options.min || value > options.max) {
    issues.push(`${name} must be between ${options.min} and ${options.max}`);
    return undefined;
  }
  return value;
};

const rate = (env: Env, name: string, issues: string[]): number => {
  const raw = text(env, name);
  if (raw === undefined) return DEFAULT_SAMPLING.successRate;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    issues.push(`${name} must be a number between 0 and 1`);
    return DEFAULT_SAMPLING.successRate;
  }
  return value;
};

const boolean = (
  env: Env,
  name: string,
  issues: string[],
): boolean | undefined => {
  const raw = text(env, name);
  if (raw === undefined) return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  issues.push(`${name} must be "true" or "false"`);
  return undefined;
};

const object = (
  env: Env,
  name: string,
  issues: string[],
): Record<string, string> | undefined => {
  const raw = text(env, name);
  if (raw === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    issues.push(`${name} must be valid JSON`);
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    issues.push(`${name} must be a JSON object`);
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string") {
      issues.push(`${name}.${key} must be a string`);
      continue;
    }
    result[key] = value;
  }
  return result;
};

const readTenants = (
  env: Env,
  issues: string[],
): AuththreadConfig | undefined => {
  const value = text(env, "AUTHTHREAD_CONFIG") ?? "/etc/auththread/config.json";
  const trimmed = value.trim();
  let raw: string;
  try {
    raw = trimmed.startsWith("{") ? trimmed : readFileSync(value, "utf8");
  } catch (error) {
    issues.push(
      `AUTHTHREAD_CONFIG could not be read as a file: ${
        (error as Error).message
      }`,
    );
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    issues.push(
      `AUTHTHREAD_CONFIG must be a path to valid JSON or an inline JSON value`,
    );
    return undefined;
  }

  try {
    return parseTenantConfig(parsed);
  } catch (error) {
    issues.push(`AUTHTHREAD_CONFIG: ${(error as Error).message}`);
    return undefined;
  }
};

const group = <K extends string>(
  env: Env,
  names: readonly K[],
  label: string,
  issues: string[],
): Record<K, string> | undefined => {
  const present = names.filter((name) => text(env, name) !== undefined);
  if (present.length === 0) return undefined;
  if (present.length !== names.length) {
    const missing = names.filter((name) => text(env, name) === undefined);
    issues.push(
      `${label} needs all or none of: ${names.join(", ")}; missing ${missing.join(", ")}`,
    );
    return undefined;
  }
  const result = {} as Record<K, string>;
  for (const name of names) {
    const value = text(env, name);
    if (value !== undefined) result[name] = value;
  }
  return result;
};

export function loadServerConfig(env: Env): ServerConfig {
  const issues: string[] = [];
  const tenants = readTenants(env, issues);

  const port = number(
    env,
    "PORT",
    { fallback: 8787, min: 1, max: 65535 },
    issues,
  );
  const quietMs = number(
    env,
    "AUTHTHREAD_QUIET_MS",
    { min: 1, max: Number.MAX_SAFE_INTEGER },
    issues,
  );
  const correlationWindowMs = number(
    env,
    "AUTHTHREAD_CORRELATION_WINDOW_MS",
    { min: 1, max: Number.MAX_SAFE_INTEGER },
    issues,
  );
  const ttlMs = number(
    env,
    "AUTHTHREAD_TTL_MS",
    { min: 1, max: Number.MAX_SAFE_INTEGER },
    issues,
  );
  const sampling: SamplingPolicy = {
    ...DEFAULT_SAMPLING,
    successRate: rate(env, "AUTHTHREAD_SAMPLE_SUCCESS", issues),
  };

  const otlpEndpoint = text(env, "OTLP_ENDPOINT");
  const otlpHeaders = object(env, "OTLP_HEADERS", issues);
  if (otlpEndpoint === undefined && otlpHeaders !== undefined) {
    issues.push("OTLP_HEADERS requires OTLP_ENDPOINT");
  }
  const otlp: OtlpConfig | undefined =
    otlpEndpoint === undefined
      ? undefined
      : {
          endpoint: otlpEndpoint,
          serviceName: text(env, "OTEL_SERVICE_NAME") ?? "auththread",
          headers: otlpHeaders ?? {},
        };

  const webhook = group(
    env,
    ["WEBHOOK_URL", "WEBHOOK_SECRET"],
    "webhook",
    issues,
  );

  const s3Required = [
    "AUTHTHREAD_S3_ENDPOINT",
    "AUTHTHREAD_S3_REGION",
    "AUTHTHREAD_S3_BUCKET",
    "AUTHTHREAD_S3_ACCESS_KEY_ID",
    "AUTHTHREAD_S3_SECRET_ACCESS_KEY",
  ] as const;
  const s3Values = group(env, s3Required, "object store", issues);
  const s3PrefixSet = text(env, "AUTHTHREAD_S3_PREFIX") !== undefined;
  const s3ForcePathStyleSet =
    text(env, "AUTHTHREAD_S3_FORCE_PATH_STYLE") !== undefined;
  if (s3Values === undefined && (s3PrefixSet || s3ForcePathStyleSet)) {
    issues.push(
      "AUTHTHREAD_S3_PREFIX and AUTHTHREAD_S3_FORCE_PATH_STYLE require the S3 group",
    );
  }
  const s3ForcePathStyle = boolean(
    env,
    "AUTHTHREAD_S3_FORCE_PATH_STYLE",
    issues,
  );
  const s3: S3Config | undefined =
    s3Values === undefined
      ? undefined
      : {
          endpoint: s3Values.AUTHTHREAD_S3_ENDPOINT,
          region: s3Values.AUTHTHREAD_S3_REGION,
          bucket: s3Values.AUTHTHREAD_S3_BUCKET,
          accessKeyId: s3Values.AUTHTHREAD_S3_ACCESS_KEY_ID,
          secretAccessKey: s3Values.AUTHTHREAD_S3_SECRET_ACCESS_KEY,
          forcePathStyle: s3ForcePathStyle ?? false,
          prefix: text(env, "AUTHTHREAD_S3_PREFIX") ?? "auththread",
        };

  if (issues.length > 0 || tenants === undefined || port === undefined) {
    throw new ConfigError(
      issues.length > 0 ? issues : ["invalid auththread server config"],
    );
  }

  const dbPath = text(env, "AUTHTHREAD_DB");

  return {
    tenants,
    port,
    storage:
      dbPath === undefined
        ? { type: "memory" }
        : { type: "sqlite", path: dbPath },
    ...(quietMs === undefined ? {} : { quietMs }),
    ...(correlationWindowMs === undefined ? {} : { correlationWindowMs }),
    ...(ttlMs === undefined ? {} : { ttlMs }),
    sampling,
    ...(otlp === undefined ? {} : { otlp }),
    ...(webhook === undefined
      ? {}
      : {
          webhook: {
            url: webhook.WEBHOOK_URL,
            secret: webhook.WEBHOOK_SECRET,
          },
        }),
    ...(s3 === undefined ? {} : { s3 }),
  };
}
