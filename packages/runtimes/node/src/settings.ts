import { readFileSync } from "node:fs";
import type { SettingsStore } from "@auththread/adapter-kit";
import { createStaticSettings } from "@auththread/adapter-kit";
import { parseTenantConfig, toTenantSettings } from "@auththread/config";

/**
 * Reads the shared tenant document once at startup. The raw key is hashed in
 * memory and never stored, so the file can come straight from a secret mount.
 */
export function createFileSettings(path: string): SettingsStore {
  const config = parseTenantConfig(
    JSON.parse(readFileSync(path, "utf8")) as unknown,
  );
  return createStaticSettings(toTenantSettings(config));
}
