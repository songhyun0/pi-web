import { existsSync, realpathSync, unlinkSync } from "fs";
import path from "path";
import { homedir } from "os";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  hasTrustRequiringProjectResources,
  ProjectTrustStore,
  SettingsManager,
  type DefaultProjectTrust,
} from "@earendil-works/pi-coding-agent";
import { parseSettingsForLockedWrite, readJsonObject, withSettingsFileLock } from "./settings-file-core";
export type RuntimeSettingsScope = "global" | "project";
export type RuntimeSettingType = "boolean" | "number" | "string";
export type RuntimeSettingApplies = "immediate" | "next-request" | "reload" | "new-session";

export interface RuntimeSettingDescriptor {
  key: string;
  label: string;
  description: string;
  type: RuntimeSettingType;
  scopes: RuntimeSettingsScope[];
  defaultValue: unknown;
  allowedValues?: string[];
  min?: number;
  applies: RuntimeSettingApplies;
}

export interface RuntimeSettingValue extends RuntimeSettingDescriptor {
  globalValue: unknown;
  projectValue: unknown;
  effectiveValue: unknown;
  effectiveScope: RuntimeSettingsScope | "default";
  projectBlocked?: boolean;
}

export interface RuntimeSettingsResponse {
  cwd: string;
  agentDir: string;
  projectTrusted: boolean;
  projectTrustSource: "none-required" | "saved" | "defaultProjectTrust" | "untrusted";
  scopes: {
    global: { path: string; writable: boolean };
    project: { path: string; writable: boolean; readable: boolean; blockedReason?: string };
  };
  settings: RuntimeSettingValue[];
}

export interface RuntimeSettingsPatchResult extends RuntimeSettingsResponse {
  changed: string[];
  reset: string[];
}

type JsonObject = Record<string, unknown>;

const DESCRIPTORS: RuntimeSettingDescriptor[] = [
  {
    key: "defaultThinkingLevel",
    label: "Default thinking level",
    description: "Default thinking level for new sessions when no per-session override is selected.",
    type: "string",
    scopes: ["global", "project"],
    defaultValue: undefined,
    allowedValues: ["off", "minimal", "low", "medium", "high", "xhigh"],
    applies: "new-session",
  },
  {
    key: "steeringMode",
    label: "Steering mode",
    description: "How queued steering messages are delivered while an agent is running.",
    type: "string",
    scopes: ["global", "project"],
    defaultValue: "one-at-a-time",
    allowedValues: ["all", "one-at-a-time"],
    applies: "reload",
  },
  {
    key: "followUpMode",
    label: "Follow-up mode",
    description: "How queued follow-up messages are delivered after the current turn.",
    type: "string",
    scopes: ["global", "project"],
    defaultValue: "one-at-a-time",
    allowedValues: ["all", "one-at-a-time"],
    applies: "reload",
  },
  {
    key: "transport",
    label: "Provider transport",
    description: "Preferred provider transport when the provider supports multiple transports.",
    type: "string",
    scopes: ["global", "project"],
    defaultValue: "auto",
    allowedValues: ["auto", "sse", "websocket", "websocket-cached"],
    applies: "new-session",
  },
  {
    key: "compaction.enabled",
    label: "Auto-compaction",
    description: "Enable automatic context compaction.",
    type: "boolean",
    scopes: ["global", "project"],
    defaultValue: true,
    applies: "immediate",
  },
  {
    key: "compaction.reserveTokens",
    label: "Compaction reserve tokens",
    description: "Tokens reserved for the model response after compaction.",
    type: "number",
    scopes: ["global", "project"],
    defaultValue: 16384,
    min: 0,
    applies: "reload",
  },
  {
    key: "compaction.keepRecentTokens",
    label: "Compaction recent tokens",
    description: "Recent tokens preserved verbatim during compaction.",
    type: "number",
    scopes: ["global", "project"],
    defaultValue: 20000,
    min: 0,
    applies: "reload",
  },
  {
    key: "retry.enabled",
    label: "Auto-retry",
    description: "Enable agent-level retry for transient errors.",
    type: "boolean",
    scopes: ["global", "project"],
    defaultValue: true,
    applies: "immediate",
  },
  {
    key: "retry.maxRetries",
    label: "Retry max attempts",
    description: "Maximum agent-level retry attempts.",
    type: "number",
    scopes: ["global", "project"],
    defaultValue: 3,
    min: 0,
    applies: "reload",
  },
  {
    key: "retry.baseDelayMs",
    label: "Retry base delay",
    description: "Base delay in milliseconds for agent-level exponential backoff.",
    type: "number",
    scopes: ["global", "project"],
    defaultValue: 2000,
    min: 0,
    applies: "reload",
  },
  {
    key: "defaultProjectTrust",
    label: "Default project trust",
    description: "Fallback trust behavior for project-local pi resources when no saved trust decision exists.",
    type: "string",
    scopes: ["global"],
    defaultValue: "ask",
    allowedValues: ["ask", "always", "never"],
    applies: "new-session",
  },
];

const DESCRIPTOR_BY_KEY = new Map(DESCRIPTORS.map((descriptor) => [descriptor.key, descriptor]));

export function getRuntimeSettingDescriptors(): RuntimeSettingDescriptor[] {
  return DESCRIPTORS.map((descriptor) => ({ ...descriptor, scopes: [...descriptor.scopes], allowedValues: descriptor.allowedValues ? [...descriptor.allowedValues] : undefined }));
}

function getGlobalSettingsPath(agentDir = getAgentDir()): string {
  return path.join(agentDir, "settings.json");
}

function getProjectSettingsPath(cwd: string): string {
  return path.join(path.resolve(cwd), CONFIG_DIR_NAME, "settings.json");
}


function getNested(source: JsonObject, key: string): unknown {
  let current: unknown = source;
  for (const part of key.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as JsonObject)[part];
  }
  return current;
}

function setNested(target: JsonObject, key: string, value: unknown): void {
  const parts = key.split(".");
  let current = target;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      current[part] = {};
    }
    current = current[part] as JsonObject;
  }
  current[parts[parts.length - 1]] = value;
}

function deleteNested(target: JsonObject, key: string): void {
  const parts = key.split(".");
  const stack: Array<{ object: JsonObject; key: string }> = [];
  let current = target;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (!next || typeof next !== "object" || Array.isArray(next)) return;
    stack.push({ object: current, key: part });
    current = next as JsonObject;
  }
  delete current[parts[parts.length - 1]];
  for (let index = stack.length - 1; index >= 0; index--) {
    const { object, key: part } = stack[index];
    const value = object[part];
    if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) {
      delete object[part];
    }
  }
}

function validateValue(descriptor: RuntimeSettingDescriptor, value: unknown): unknown {
  if (descriptor.type === "boolean") {
    if (typeof value !== "boolean") throw new Error(`${descriptor.key} must be a boolean`);
    return value;
  }
  if (descriptor.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${descriptor.key} must be a finite number`);
    if (descriptor.min !== undefined && value < descriptor.min) throw new Error(`${descriptor.key} must be >= ${descriptor.min}`);
    return value;
  }
  if (typeof value !== "string") throw new Error(`${descriptor.key} must be a string`);
  if (descriptor.allowedValues && !descriptor.allowedValues.includes(value)) {
    throw new Error(`${descriptor.key} must be one of: ${descriptor.allowedValues.join(", ")}`);
  }
  return value;
}

function resolveProjectTrust(cwd: string, globalSettings: JsonObject): { trusted: boolean; source: RuntimeSettingsResponse["projectTrustSource"] } {
  if (!hasTrustRequiringProjectResources(cwd)) return { trusted: true, source: "none-required" };
  const store = new ProjectTrustStore(getAgentDir());
  const saved = store.get(cwd);
  if (saved !== null) return { trusted: saved, source: "saved" };
  const fallback = typeof globalSettings.defaultProjectTrust === "string"
    ? globalSettings.defaultProjectTrust as DefaultProjectTrust
    : SettingsManager.create(cwd, getAgentDir(), { projectTrusted: false }).getDefaultProjectTrust();
  if (fallback === "always") return { trusted: true, source: "defaultProjectTrust" };
  if (fallback === "never") return { trusted: false, source: "defaultProjectTrust" };
  return { trusted: false, source: "untrusted" };
}

export function loadRuntimeSettings(cwd: string): RuntimeSettingsResponse {
  const resolvedCwd = path.resolve(cwd);
  const agentDir = getAgentDir();
  const globalPath = getGlobalSettingsPath(agentDir);
  const projectPath = getProjectSettingsPath(resolvedCwd);
  const globalSettings = readJsonObject(globalPath);
  const trust = resolveProjectTrust(resolvedCwd, globalSettings);
  const projectSettingsReadable = trust.trusted && trust.source !== "none-required";
  const projectSettingsWritable = trust.trusted;
  const projectSettings = projectSettingsReadable ? readJsonObject(projectPath) : {};

  return {
    cwd: resolvedCwd,
    agentDir,
    projectTrusted: trust.trusted,
    projectTrustSource: trust.source,
    scopes: {
      global: { path: globalPath, writable: true },
      project: {
        path: projectPath,
        writable: projectSettingsWritable,
        readable: projectSettingsReadable,
        ...(!projectSettingsWritable ? { blockedReason: "Project settings are ignored until the project is trusted." } : {}),
      },
    },
    settings: DESCRIPTORS.map((descriptor) => {
      const globalValue = getNested(globalSettings, descriptor.key);
      const projectValue = projectSettingsReadable && descriptor.scopes.includes("project")
        ? getNested(projectSettings, descriptor.key)
        : undefined;
      const hasProjectValue = projectValue !== undefined;
      const hasGlobalValue = globalValue !== undefined;
      const effectiveScope = hasProjectValue ? "project" : hasGlobalValue ? "global" : "default";
      return {
        ...descriptor,
        scopes: [...descriptor.scopes],
        allowedValues: descriptor.allowedValues ? [...descriptor.allowedValues] : undefined,
        globalValue,
        projectValue,
        effectiveValue: hasProjectValue ? projectValue : hasGlobalValue ? globalValue : descriptor.defaultValue,
        effectiveScope,
        ...(!projectSettingsWritable && descriptor.scopes.includes("project") ? { projectBlocked: true } : {}),
      };
    }),
  };
}

const RUNTIME_SETTING_TOP_LEVEL_KEYS = new Set(DESCRIPTORS.map((descriptor) => descriptor.key.split(".")[0]));

function pathHasTrustResource(target: string): boolean {
  return existsSync(target);
}

function canonicalRootPath(target: string): string {
  try {
    return realpathSync.native(target);
  } catch {
    return path.resolve(target);
  }
}

function collectUnexpectedProjectRuntimeTrustResources(cwd: string): { label: string }[] {
  const piDir = path.join(cwd, CONFIG_DIR_NAME);
  const candidates = [
    { label: `${CONFIG_DIR_NAME}/extensions`, path: path.join(piDir, "extensions") },
    { label: `${CONFIG_DIR_NAME}/skills`, path: path.join(piDir, "skills") },
    { label: `${CONFIG_DIR_NAME}/prompts`, path: path.join(piDir, "prompts") },
    { label: `${CONFIG_DIR_NAME}/themes`, path: path.join(piDir, "themes") },
    { label: `${CONFIG_DIR_NAME}/SYSTEM.md`, path: path.join(piDir, "SYSTEM.md") },
    { label: `${CONFIG_DIR_NAME}/APPEND_SYSTEM.md`, path: path.join(piDir, "APPEND_SYSTEM.md") },
  ];
  const resources = candidates.filter((candidate) => pathHasTrustResource(candidate.path)).map(({ label }) => ({ label }));
  const homeAgentsSkillsDir = path.join(canonicalRootPath(homedir()), ".agents", "skills");
  let current = canonicalRootPath(cwd);
  while (true) {
    const agentsSkills = path.join(current, ".agents", "skills");
    if (path.resolve(agentsSkills) !== homeAgentsSkillsDir && pathHasTrustResource(agentsSkills)) resources.push({ label: ".agents/skills" });
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return resources;
}

function promoteCleanProjectRuntimeSettingsTrust(before: RuntimeSettingsResponse, settingsPath: string, expectedSettingsJson: string): void {
  if (before.projectTrustSource !== "none-required") return;
  const currentSettings = readJsonObject(settingsPath);
  if (JSON.stringify(currentSettings) !== expectedSettingsJson) {
    throw Object.assign(new Error("Runtime settings changed while saving; reload and try again."), { statusCode: 409 });
  }
  const unexpectedSettingsKeys = Object.keys(currentSettings).filter((key) => !RUNTIME_SETTING_TOP_LEVEL_KEYS.has(key));
  if (unexpectedSettingsKeys.length > 0) {
    throw Object.assign(new Error(`Project settings changed while saving runtime settings: ${unexpectedSettingsKeys.join(", ")}. Review project trust and try again.`), { statusCode: 409 });
  }
  const unexpectedTrustRequirements = collectUnexpectedProjectRuntimeTrustResources(before.cwd);
  if (unexpectedTrustRequirements.length > 0) {
    throw Object.assign(new Error(`Project trust requirements changed while saving runtime settings: ${unexpectedTrustRequirements.map((item) => item.label).join(", ")}. Review project trust and try again.`), { statusCode: 409 });
  }
  new ProjectTrustStore(before.agentDir).set(before.cwd, true);
}

export function patchRuntimeSettings(
  cwd: string,
  scope: RuntimeSettingsScope,
  updates: Record<string, unknown>,
): RuntimeSettingsPatchResult {
  const resolvedCwd = path.resolve(cwd);
  const before = loadRuntimeSettings(resolvedCwd);
  if (scope === "project" && !before.scopes.project.writable) {
    throw Object.assign(new Error(before.scopes.project.blockedReason ?? "Project settings cannot be changed until the project is trusted."), { statusCode: 403 });
  }
  const settingsPath = scope === "global" ? before.scopes.global.path : before.scopes.project.path;
  const settings = readJsonObject(settingsPath);
  const originalSettingsJson = JSON.stringify(settings);
  const changed: string[] = [];
  const reset: string[] = [];

  for (const [key, rawValue] of Object.entries(updates)) {
    const descriptor = DESCRIPTOR_BY_KEY.get(key);
    if (!descriptor) throw new Error(`Unknown runtime setting: ${key}`);
    if (!descriptor.scopes.includes(scope)) throw new Error(`${key} cannot be written to ${scope} settings`);
    if (rawValue === null) {
      deleteNested(settings, key);
      reset.push(key);
      continue;
    }
    setNested(settings, key, validateValue(descriptor, rawValue));
    changed.push(key);
  }

  const settingsRoot = scope === "global" ? before.agentDir : before.cwd;
  const nextSettingsJson = JSON.stringify(settings);
  const settingsExistedBeforeWrite = existsSync(settingsPath);
  withSettingsFileLock(settingsPath, settingsRoot, (current) => {
    const currentSettings = parseSettingsForLockedWrite(current, settingsPath);
    if (JSON.stringify(currentSettings) !== originalSettingsJson) {
      throw Object.assign(new Error("Runtime settings changed while editing; reload and try again."), { statusCode: 409 });
    }
    return {
      content: `${JSON.stringify(settings, null, 2)}\n`,
      afterWrite: () => {
        if (scope !== "project") return;
        try {
          promoteCleanProjectRuntimeSettingsTrust(before, settingsPath, nextSettingsJson);
        } catch (error) {
          if (before.projectTrustSource === "none-required" && !settingsExistedBeforeWrite) {
            try { unlinkSync(settingsPath); } catch { /* best-effort rollback of untrusted first-write settings */ }
          }
          throw error;
        }
      },
    };
  });
  return { ...loadRuntimeSettings(resolvedCwd), changed, reset };
}
