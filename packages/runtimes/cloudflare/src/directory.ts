import { sha256Hex } from "@auththread/schema";

export interface DirectoryTenant {
  readonly tenant: string;
  readonly apiKey?: string;
  readonly apiKeyHash?: string;
}

export interface KeyDirectory {
  /** Returns the tenant for a request's API key, or null. */
  resolve(request: Request): Promise<string | null>;
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
export function createKeyDirectory(
  tenants: readonly DirectoryTenant[],
): KeyDirectory {
  const byHash = new Map<string, string>();
  const names = new Set<string>();

  for (const tenant of tenants) {
    if (names.has(tenant.tenant)) {
      throw new Error(`duplicate tenant in the directory: ${tenant.tenant}`);
    }
    names.add(tenant.tenant);
    if (tenant.apiKey === undefined && tenant.apiKeyHash === undefined) {
      throw new Error(`tenant ${tenant.tenant} needs an api key or hash`);
    }
    const hash = tenant.apiKeyHash ?? sha256Hex(tenant.apiKey ?? "");
    if (byHash.has(hash)) {
      throw new Error("two tenants share the same API key");
    }
    byHash.set(hash, tenant.tenant);
  }

  return {
    async resolve(request) {
      const key = keyOf(request);
      if (key === null) return null;
      return byHash.get(sha256Hex(key)) ?? null;
    },
  };
}
