import { SettingsError } from "@auththread/adapter-kit";
import { sha256Hex } from "@auththread/schema";
import { Effect } from "effect";

export interface DirectoryTenant {
  readonly tenant: string;
  readonly apiKey: string;
}

export interface KeyDirectory {
  /** Returns the tenant for a request's API key, or null. */
  resolve(request: Request): Effect.Effect<string | null>;
}

const keyOf = (request: Request): string | null => {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    const value = header.slice(7).trim();
    return value.length === 0 ? null : value;
  }
  const fallback = request.headers.get("x-auththread-key");
  return fallback !== null && fallback.length > 0 ? fallback : null;
};

/**
 * The Worker's key directory. It maps a hashed API key to a tenant name so a
 * request can be routed to that tenant's Durable Object before any state is
 * touched. Tenant config is static per deploy, so this needs no second object
 * and no consistency window.
 */
export const createKeyDirectory = (
  tenants: readonly DirectoryTenant[],
): Effect.Effect<KeyDirectory, SettingsError> =>
  Effect.gen(function* () {
    const byHash = new Map<string, string>();
    const names = new Set<string>();

    for (const tenant of tenants) {
      if (names.has(tenant.tenant))
        return yield* new SettingsError({
          message: `duplicate tenant in the directory: ${tenant.tenant}`,
        });
      names.add(tenant.tenant);
      const hash = sha256Hex(tenant.apiKey);
      if (byHash.has(hash))
        return yield* new SettingsError({
          message: "two tenants share the same API key",
        });
      byHash.set(hash, tenant.tenant);
    }

    return {
      resolve: (request) => {
        const key = keyOf(request);
        if (key === null) return Effect.succeed(null);
        return Effect.succeed(byHash.get(sha256Hex(key)) ?? null);
      },
    };
  });
