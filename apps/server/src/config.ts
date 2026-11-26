import { existsSync } from "node:fs";
import { DEFAULT_SAMPLING, type SamplingPolicy } from "@auththread/adapter-kit";
import { Config, Effect, Option, Schema } from "effect";

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

export type ServerStorage =
  | { readonly type: "memory" }
  | { readonly type: "sqlite"; readonly path: string };

export interface ServerConfig {
  readonly configPath: string;
  readonly port: number;
  readonly storage: ServerStorage;
  readonly quietMs?: number;
  readonly correlationWindowMs?: number;
  readonly ttlMs?: number;
  readonly sampling: SamplingPolicy;
  readonly otlp?: OtlpConfig;
  readonly webhook?: WebhookConfig;
  readonly s3?: S3Config;
}

export class ServerConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`invalid auththread server config:\n- ${issues.join("\n- ")}`);
    this.name = "ServerConfigError";
    this.issues = issues;
  }
}

const HeadersSchema = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.String),
);

const optionalString = (name: string) =>
  Config.String(name).pipe(
    Config.option,
    Effect.map((value) => {
      const text = Option.getOrUndefined(value)?.trim();
      return text === undefined || text.length === 0 ? undefined : text;
    }),
  );

const optionalNumber = (name: string) =>
  Config.Number(name).pipe(Config.option, Effect.map(Option.getOrUndefined));

const optionalBoolean = (name: string) =>
  Config.Boolean(name).pipe(Config.option, Effect.map(Option.getOrUndefined));

const integer = (
  name: string,
  value: number | undefined,
  issues: string[],
  min: number,
  max: number,
): number | undefined => {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value)) {
    issues.push(`${name} must be an integer`);
    return undefined;
  }
  if (value < min || value > max) {
    issues.push(`${name} must be between ${min} and ${max}`);
    return undefined;
  }
  return value;
};

const group = <K extends string>(
  values: Record<K, string | undefined>,
  names: readonly K[],
  label: string,
  issues: string[],
): Record<K, string> | undefined => {
  const present = names.filter((name) => values[name] !== undefined);
  if (present.length === 0) return undefined;
  if (present.length !== names.length) {
    const missing = names.filter((name) => values[name] === undefined);
    issues.push(
      `${label} needs all or none of: ${names.join(", ")}; missing ${missing.join(", ")}`,
    );
    return undefined;
  }
  const result = {} as Record<K, string>;
  for (const name of names) {
    const value = values[name];
    if (value !== undefined) result[name] = value;
  }
  return result;
};

/**
 * Effect Config and Schema are the boundary here. Every env value is decoded
 * once, groups are validated atomically, and the program fails before the HTTP
 * server starts.
 */
export const loadServerConfig: Effect.Effect<ServerConfig, ServerConfigError> =
  Effect.gen(function* () {
    const issues: string[] = [];

    const configPath =
      (yield* optionalString("AUTHTHREAD_CONFIG")) ??
      "/etc/auththread/config.json";
    if (!existsSync(configPath)) {
      issues.push(`AUTHTHREAD_CONFIG does not exist: ${configPath}`);
    }

    const port = yield* Config.Port("PORT").pipe(Config.withDefault(8787));
    const quietMs = integer(
      "AUTHTHREAD_QUIET_MS",
      yield* optionalNumber("AUTHTHREAD_QUIET_MS"),
      issues,
      1,
      Number.MAX_SAFE_INTEGER,
    );
    const correlationWindowMs = integer(
      "AUTHTHREAD_CORRELATION_WINDOW_MS",
      yield* optionalNumber("AUTHTHREAD_CORRELATION_WINDOW_MS"),
      issues,
      1,
      Number.MAX_SAFE_INTEGER,
    );
    const ttlMs = integer(
      "AUTHTHREAD_TTL_MS",
      yield* optionalNumber("AUTHTHREAD_TTL_MS"),
      issues,
      1,
      Number.MAX_SAFE_INTEGER,
    );

    const sampleSuccess =
      (yield* optionalNumber("AUTHTHREAD_SAMPLE_SUCCESS")) ??
      DEFAULT_SAMPLING.successRate;
    if (
      !Number.isFinite(sampleSuccess) ||
      sampleSuccess < 0 ||
      sampleSuccess > 1
    ) {
      issues.push("AUTHTHREAD_SAMPLE_SUCCESS must be a number between 0 and 1");
    }
    const sampling: SamplingPolicy = {
      ...DEFAULT_SAMPLING,
      successRate:
        Number.isFinite(sampleSuccess) &&
        sampleSuccess >= 0 &&
        sampleSuccess <= 1
          ? sampleSuccess
          : DEFAULT_SAMPLING.successRate,
    };

    const otlpEndpoint = yield* optionalString("OTLP_ENDPOINT");
    const otlpHeadersRaw = yield* optionalString("OTLP_HEADERS");
    let otlpHeaders: Record<string, string> | undefined;
    if (otlpHeadersRaw !== undefined) {
      const decoded = Schema.decodeUnknownResult(HeadersSchema)(otlpHeadersRaw);
      if (decoded._tag === "Failure") {
        issues.push(`OTLP_HEADERS is invalid: ${decoded.failure.message}`);
      } else {
        otlpHeaders = decoded.success;
      }
    }
    if (otlpEndpoint === undefined && otlpHeaders !== undefined) {
      issues.push("OTLP_HEADERS requires OTLP_ENDPOINT");
    }
    const otlp: OtlpConfig | undefined =
      otlpEndpoint === undefined
        ? undefined
        : {
            endpoint: otlpEndpoint,
            serviceName:
              (yield* optionalString("OTEL_SERVICE_NAME")) ?? "auththread",
            headers: otlpHeaders ?? {},
          };

    const webhook = group(
      {
        WEBHOOK_URL: yield* optionalString("WEBHOOK_URL"),
        WEBHOOK_SECRET: yield* optionalString("WEBHOOK_SECRET"),
      },
      ["WEBHOOK_URL", "WEBHOOK_SECRET"],
      "webhook",
      issues,
    );

    const s3Values = group(
      {
        AUTHTHREAD_S3_ENDPOINT: yield* optionalString("AUTHTHREAD_S3_ENDPOINT"),
        AUTHTHREAD_S3_REGION: yield* optionalString("AUTHTHREAD_S3_REGION"),
        AUTHTHREAD_S3_BUCKET: yield* optionalString("AUTHTHREAD_S3_BUCKET"),
        AUTHTHREAD_S3_ACCESS_KEY_ID: yield* optionalString(
          "AUTHTHREAD_S3_ACCESS_KEY_ID",
        ),
        AUTHTHREAD_S3_SECRET_ACCESS_KEY: yield* optionalString(
          "AUTHTHREAD_S3_SECRET_ACCESS_KEY",
        ),
      },
      [
        "AUTHTHREAD_S3_ENDPOINT",
        "AUTHTHREAD_S3_REGION",
        "AUTHTHREAD_S3_BUCKET",
        "AUTHTHREAD_S3_ACCESS_KEY_ID",
        "AUTHTHREAD_S3_SECRET_ACCESS_KEY",
      ],
      "object store",
      issues,
    );
    const s3Prefix = yield* optionalString("AUTHTHREAD_S3_PREFIX");
    const s3ForcePathStyle = yield* optionalBoolean(
      "AUTHTHREAD_S3_FORCE_PATH_STYLE",
    );
    if (
      s3Values === undefined &&
      (s3Prefix !== undefined || s3ForcePathStyle !== undefined)
    ) {
      issues.push(
        "AUTHTHREAD_S3_PREFIX and AUTHTHREAD_S3_FORCE_PATH_STYLE require the S3 group",
      );
    }
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
            prefix: s3Prefix ?? "auththread",
          };

    if (issues.length > 0) {
      return yield* Effect.fail(new ServerConfigError(issues));
    }

    const dbPath = yield* optionalString("AUTHTHREAD_DB");
    const storage: ServerStorage =
      dbPath === undefined
        ? { type: "memory" }
        : { type: "sqlite", path: dbPath };
    const result: ServerConfig = {
      configPath,
      port,
      storage,
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
    return result;
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof ServerConfigError
        ? cause
        : new ServerConfigError([
            cause instanceof Error ? cause.message : String(cause),
          ]),
    ),
  );
