import {
  SettingsError,
  SettingsStore,
  type TenantSettings,
} from "@auththread/adapter-kit";
import { sha256Hex } from "@auththread/schema";
import { Effect, FileSystem, Layer, Schema } from "effect";

const TenantSchema = Schema.Struct({
  tenant: Schema.String.check(Schema.isMinLength(1)),
  provider: Schema.String.check(Schema.isMinLength(1)),
  apiKey: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1))),
  apiKeyHash: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  ),
  salt: Schema.String.check(Schema.isMinLength(8)),
  providerSettings: Schema.optionalKey(Schema.Unknown),
}).check(
  Schema.makeFilter((tenant) =>
    tenant.apiKey !== undefined || tenant.apiKeyHash !== undefined
      ? true
      : "tenant needs apiKey or apiKeyHash",
  ),
);

const ConfigSchema = Schema.Struct({
  tenants: Schema.Array(TenantSchema),
});

/**
 * Reads tenants once at startup. The raw key is hashed in memory and never
 * stored, so the file can come straight from a secret mount.
 */
export const createFileSettings = (
  path: string,
): Effect.Effect<
  SettingsStore["Service"],
  SettingsError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* fs.readFileString(path).pipe(
      Effect.mapError(
        (cause) =>
          new SettingsError({
            message: `could not read ${path}`,
            cause,
          }),
      ),
    );
    const config = yield* Effect.fromResult(
      Schema.decodeUnknownResult(Schema.fromJsonString(ConfigSchema))(text),
    ).pipe(
      Effect.mapError(
        (cause) =>
          new SettingsError({
            message: `invalid auththread config: ${cause.message}`,
          }),
      ),
    );

    const tenants: TenantSettings[] = [];
    for (const entry of config.tenants) {
      const apiKeyHash =
        entry.apiKeyHash ??
        (entry.apiKey === undefined ? undefined : sha256Hex(entry.apiKey));
      if (apiKeyHash === undefined)
        return yield* new SettingsError({
          message: `tenant ${entry.tenant} needs apiKey or apiKeyHash`,
        });
      tenants.push({
        tenant: entry.tenant,
        provider: entry.provider,
        apiKeyHash,
        salt: entry.salt,
        providerSettings: entry.providerSettings ?? {},
      });
    }

    const byHash = new Map(
      tenants.map((tenant) => [tenant.apiKeyHash, tenant]),
    );
    return {
      getTenant: (apiKeyHash) => Effect.succeed(byHash.get(apiKeyHash) ?? null),
    };
  });

export const fileSettingsLayer = (
  path: string,
): Layer.Layer<SettingsStore, SettingsError, FileSystem.FileSystem> =>
  Layer.effect(SettingsStore, createFileSettings(path));
