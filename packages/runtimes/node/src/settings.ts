import { readFileSync } from "node:fs";
import type { SettingsStore, TenantSettings } from "@auththread/adapter-kit";
import { sha256Hex } from "@auththread/schema";

interface TenantEntry {
  readonly tenant: string;
  readonly provider: string;
  readonly apiKey?: string;
  readonly apiKeyHash?: string;
  readonly salt: string;
  readonly providerSettings?: unknown;
}

const fail = (message: string): never => {
  throw new Error(`invalid auththread config: ${message}`);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseConfig = (value: unknown): TenantEntry[] => {
  if (!isRecord(value)) return fail("root must be an object");
  const tenants = value.tenants;
  if (!Array.isArray(tenants)) return fail("tenants must be an array");

  return tenants.map((entry, index) => {
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
};

/**
 * Reads tenants once at startup. The raw key is hashed in memory and never
 * stored, so the file can come straight from a secret mount.
 */
export function createFileSettings(path: string): SettingsStore {
  const entries = parseConfig(
    JSON.parse(readFileSync(path, "utf8")) as unknown,
  );
  const tenants: TenantSettings[] = entries.map((entry) => ({
    tenant: entry.tenant,
    provider: entry.provider,
    apiKeyHash: entry.apiKeyHash ?? sha256Hex(entry.apiKey ?? ""),
    salt: entry.salt,
    providerSettings: entry.providerSettings ?? {},
  }));
  const byHash = new Map(tenants.map((tenant) => [tenant.apiKeyHash, tenant]));

  return {
    async getTenant(apiKeyHash) {
      return byHash.get(apiKeyHash) ?? null;
    },
  };
}
