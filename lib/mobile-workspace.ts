export const MOBILE_WORKSPACE_HISTORY_KEY = "piWorkspaceLayer";
export const MOBILE_SESSION_PROJECT_HISTORY_KEY = "piSessionsProject";
export const MOBILE_INSPECTOR_FILES_HISTORY_KEY = "piInspectorFiles";

export type MobileWorkspaceLayer = "sessions" | "inspector" | "more";

const MOBILE_WORKSPACE_LAYERS = new Set<MobileWorkspaceLayer>(["sessions", "inspector", "more"]);

function asHistoryRecord(state: unknown): Record<string, unknown> {
  return state && typeof state === "object" && !Array.isArray(state)
    ? { ...(state as Record<string, unknown>) }
    : {};
}

export function readMobileWorkspaceLayer(state: unknown): MobileWorkspaceLayer | null {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  const candidate = (state as Record<string, unknown>)[MOBILE_WORKSPACE_HISTORY_KEY];
  return typeof candidate === "string" && MOBILE_WORKSPACE_LAYERS.has(candidate as MobileWorkspaceLayer)
    ? candidate as MobileWorkspaceLayer
    : null;
}

export function withMobileWorkspaceLayer(state: unknown, layer: MobileWorkspaceLayer): Record<string, unknown> {
  return { ...asHistoryRecord(state), [MOBILE_WORKSPACE_HISTORY_KEY]: layer };
}

export function withoutMobileWorkspaceLayer(state: unknown): Record<string, unknown> {
  const next = asHistoryRecord(state);
  delete next[MOBILE_WORKSPACE_HISTORY_KEY];
  return next;
}

export function readMobileSessionProject(state: unknown): string | null {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  const candidate = (state as Record<string, unknown>)[MOBILE_SESSION_PROJECT_HISTORY_KEY];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

export function withMobileSessionProject(state: unknown, projectRoot: string): Record<string, unknown> {
  return { ...asHistoryRecord(state), [MOBILE_SESSION_PROJECT_HISTORY_KEY]: projectRoot };
}

export function withoutMobileSessionProject(state: unknown): Record<string, unknown> {
  const next = asHistoryRecord(state);
  delete next[MOBILE_SESSION_PROJECT_HISTORY_KEY];
  return next;
}

export function readMobileInspectorFiles(state: unknown): boolean {
  if (!state || typeof state !== "object" || Array.isArray(state)) return false;
  return (state as Record<string, unknown>)[MOBILE_INSPECTOR_FILES_HISTORY_KEY] === true;
}

export function withMobileInspectorFiles(state: unknown): Record<string, unknown> {
  return { ...asHistoryRecord(state), [MOBILE_INSPECTOR_FILES_HISTORY_KEY]: true };
}

export function withoutMobileInspectorFiles(state: unknown): Record<string, unknown> {
  const next = asHistoryRecord(state);
  delete next[MOBILE_INSPECTOR_FILES_HISTORY_KEY];
  return next;
}
