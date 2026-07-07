import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { type AppSettings, DEFAULT_APP_SETTINGS, normalizeAppDisplayName } from "./app-settings";

const APP_SETTINGS_FILE = "web-settings.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getAppSettingsPath(): string {
  return join(getAgentDir(), APP_SETTINGS_FILE);
}

function coerceAppSettings(value: unknown): AppSettings {
  if (!isRecord(value)) return DEFAULT_APP_SETTINGS;

  let displayName = DEFAULT_APP_SETTINGS.displayName;
  if ("displayName" in value) {
    try {
      displayName = normalizeAppDisplayName(value.displayName);
    } catch {
      displayName = DEFAULT_APP_SETTINGS.displayName;
    }
  }

  return {
    version: 1,
    displayName,
  };
}

export function readAppSettings(): AppSettings {
  const path = getAppSettingsPath();
  if (!existsSync(path)) return DEFAULT_APP_SETTINGS;

  try {
    return coerceAppSettings(JSON.parse(readFileSync(path, "utf8")) as unknown);
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

export function writeAppSettings(settings: AppSettings): void {
  const path = getAppSettingsPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2), "utf8");
}
