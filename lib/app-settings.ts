export interface AppSettings {
  version: 1;
  displayName: string;
}

export const DEFAULT_APP_DISPLAY_NAME = "Pi Agent Web";
export const APP_DISPLAY_NAME_MAX_LENGTH = 80;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  version: 1,
  displayName: DEFAULT_APP_DISPLAY_NAME,
};

export function normalizeAppDisplayName(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Display name must be a string.");
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) {
    throw new Error("Display name cannot be empty.");
  }
  if (normalized.length > APP_DISPLAY_NAME_MAX_LENGTH) {
    throw new Error(`Display name must be ${APP_DISPLAY_NAME_MAX_LENGTH} characters or fewer.`);
  }

  return normalized;
}
