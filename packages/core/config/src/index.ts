import type { TenantSettings } from "@auththread/adapter-kit";
import { sha256Hex } from "@auththread/schema";

export interface TenantConfig {
  readonly tenant: string;
  readonly provider: string;
  readonly apiKey?: string;
  readonly apiKeyHash?: string;
  readonly salt: string;
  readonly providerSettings?: unknown;
}

export interface AuththreadConfig {
  readonly tenants: readonly TenantConfig[];
  readonly quietMs?: number;
  readonly correlationWindowMs?: number;
  readonly ttlMs?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const fail = (message: string): never => {
  throw new Error(`invalid auththread config: ${message}`);
};

const positiveInteger = (value: unknown, name: string): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return fail(`${name} must be a positive integer`);
  }
  return value;
};

/**
 * Parse the same tenant document for every runtime. The file, environment
 * variable or secret manager is platform-specific; the shape is not.
 */
export function parseTenantConfig(value: unknown): AuththreadConfig {
  if (!isRecord(value)) return fail("root must be an object");
  const tenants = value.tenants;
  if (!Array.isArray(tenants)) return fail("tenants must be an array");

  const parsed = tenants.map((entry, index): TenantConfig => {
    if (!isRecord(entry)) return fail(`tenant ${index} must be an object`);
    const tenant = entry.tenant;
    const provider = entry.provider;
    const salt = entry.salt;
    if (typeof tenant !== "string" || tenant.length === 0) {
      return fail(`tenant ${index} needs a tenant`);
    }
    if (typeof provider !== "string" || provider.length === 0) {
      return fail(`tenant ${index} needs a provider`);
    }
    if (typeof salt !== "string" || salt.length < 8) {
      return fail(`tenant ${index} needs a salt of at least 8 characters`);
    }
    if (
      entry.apiKey !== undefined &&
      (typeof entry.apiKey !== "string" || entry.apiKey.length === 0)
    ) {
      return fail(`tenant ${index} has an empty apiKey`);
    }
    if (
      entry.apiKeyHash !== undefined &&
      (typeof entry.apiKeyHash !== "string" ||
        !/^[0-9a-f]{64}$/.test(entry.apiKeyHash))
    ) {
      return fail(`tenant ${index} has an invalid apiKeyHash`);
    }
    if (entry.apiKey === undefined && entry.apiKeyHash === undefined) {
      return fail(`tenant ${index} needs apiKey or apiKeyHash`);
    }
    if (
      entry.providerSettings !== undefined &&
      !isRecord(entry.providerSettings)
    ) {
      return fail(`tenant ${index} providerSettings must be an object`);
    }
    return {
      tenant,
      provider,
      salt,
      ...(typeof entry.apiKey === "string" ? { apiKey: entry.apiKey } : {}),
      ...(typeof entry.apiKeyHash === "string"
        ? { apiKeyHash: entry.apiKeyHash }
        : {}),
      ...(entry.providerSettings === undefined
        ? {}
        : { providerSettings: entry.providerSettings }),
    };
  });

  const quietMs = positiveInteger(value.quietMs, "quietMs");
  const correlationWindowMs = positiveInteger(
    value.correlationWindowMs,
    "correlationWindowMs",
  );
  const ttlMs = positiveInteger(value.ttlMs, "ttlMs");

  return {
    tenants: parsed,
    ...(quietMs === undefined ? {} : { quietMs }),
    ...(correlationWindowMs === undefined ? {} : { correlationWindowMs }),
    ...(ttlMs === undefined ? {} : { ttlMs }),
  };
}

/**
 * Convert parsed config into the settings store the stitcher consumes. Raw
 * keys are hashed here and never stored.
 */
export function toTenantSettings(
  config: AuththreadConfig,
): TenantSettings<unknown>[] {
  return config.tenants.map((tenant) => ({
    tenant: tenant.tenant,
    provider: tenant.provider,
    apiKeyHash: tenant.apiKeyHash ?? sha256Hex(tenant.apiKey ?? ""),
    salt: tenant.salt,
    providerSettings: tenant.providerSettings ?? {},
  }));
}
