import { existsSync, realpathSync, statSync, unlinkSync } from "fs";
import { homedir } from "os";
import path from "path";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  hasTrustRequiringProjectResources,
  ProjectTrustStore,
  SettingsManager,
  type DefaultProjectTrust,
} from "@earendil-works/pi-coding-agent";
import { getToolNamesForPreset, type ToolPreset } from "./tool-presets";
import { collectProjectTrustInventory } from "./project-trust-core";
import { assertSafeSettingsWritePath, parseSettingsForLockedWrite, readJsonObject, withSettingsFileLock } from "./settings-file-core";
import {
  AGENT_PROFILE_THINKING_LEVELS,
  type AgentProfileAppliedThinkingLevel,
  type AgentProfileDiagnostic,
  type AgentProfileExtensionToolMode,
  type AgentProfileInstructions,
  type AgentProfileModel,
  type AgentProfilePathRef,
  type AgentProfileRef,
  type AgentProfileResources,
  type AgentProfileScope,
  type AgentProfilesMutationResponse,
  type AgentProfilesResponse,
  type AgentProfilesSettings,
  type AgentProfileSessionOptions,
  type AgentProfileThinkingLevel,
  type AgentProfileTools,
  type BuiltInAgentProfileId,
  type NormalizedAgentProfile,
  type ResolvedAgentProfile,
  type ResolvedAgentProfilePath,
  type StoredAgentProfile,
} from "./agent-profiles-types";

export * from "./agent-profiles-types";

type JsonObject = Record<string, unknown>;
type NormalizeProfileOptions = { cwd: string; agentDir: string; projectTrusted: boolean; strict: boolean; profileScope?: AgentProfileScope };

type ProjectTrustResolution = {
  trusted: boolean;
  source: AgentProfilesResponse["projectTrustSource"];
};

const SETTINGS_KEY = "agentProfiles";
const PROFILE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const TOOL_NAME_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
const VALID_TOOL_PRESETS = new Set<ToolPreset | "off">(["none", "off", "default", "full"]);
const VALID_THINKING_LEVELS = new Set<AgentProfileThinkingLevel>(AGENT_PROFILE_THINKING_LEVELS);
const BUILTIN_PROFILE_REFS = new Set<string>(["builtin:no-tools", "builtin:default", "builtin:full"]);
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_INSTRUCTION_TEXT_LENGTH = 40_000;
const MAX_RESOURCE_PATHS = 64;
const MAX_TOOL_NAMES = 128;

const BUILTIN_PROFILES: ResolvedAgentProfile[] = [
  {
    ref: "builtin:no-tools",
    source: "builtin",
    readonly: true,
    id: "no-tools",
    name: "No tools",
    description: "Disable all tools for the session.",
    thinkingLevel: "auto",
    tools: { mode: "preset", preset: "none", includeExtensionTools: false },
    instructions: { mode: "default", files: [] },
    resources: { skillPaths: [], promptPaths: [], themePaths: [] },
  },
  {
    ref: "builtin:default",
    source: "builtin",
    readonly: true,
    id: "default",
    name: "Default",
    description: "Use the legacy default tool preset: read, bash, edit, and write, plus extension tools.",
    thinkingLevel: "auto",
    tools: { mode: "preset", preset: "default", includeExtensionTools: true },
    instructions: { mode: "default", files: [] },
    resources: { skillPaths: [], promptPaths: [], themePaths: [] },
  },
  {
    ref: "builtin:full",
    source: "builtin",
    readonly: true,
    id: "full",
    name: "Full",
    description: "Use the legacy full tool preset: all built-in coding tools, plus extension tools.",
    thinkingLevel: "auto",
    tools: { mode: "preset", preset: "full", includeExtensionTools: true },
    instructions: { mode: "default", files: [] },
    resources: { skillPaths: [], promptPaths: [], themePaths: [] },
  },
];

function httpError(message: string, statusCode = 400): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getGlobalSettingsPath(agentDir = getAgentDir()): string {
  return path.join(agentDir, "settings.json");
}

function getProjectSettingsPath(cwd: string): string {
  return path.join(path.resolve(cwd), CONFIG_DIR_NAME, "settings.json");
}

export function getAgentProfileStorePaths(cwd: string, agentDir = getAgentDir()): { globalPath: string; projectPath: string } {
  return {
    globalPath: getGlobalSettingsPath(agentDir),
    projectPath: getProjectSettingsPath(cwd),
  };
}


function readJsonObjectTolerant(filePath: string, diagnostics: AgentProfileDiagnostic[], scope: AgentProfileScope): JsonObject {
  try {
    return readJsonObject(filePath);
  } catch (error) {
    diagnostics.push({
      scope,
      type: "error",
      message: error instanceof Error ? error.message : String(error),
      path: filePath,
    });
    return {};
  }
}


function resolveProjectTrust(cwd: string, globalSettings: JsonObject): ProjectTrustResolution {
  const requiresTrust = hasTrustRequiringProjectResources(cwd);
  if (!requiresTrust) return { trusted: true, source: "none-required" };
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

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function assertKnownKeys(value: JsonObject, allowed: Set<string>, label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw httpError(`${label} has unknown field: ${key}`);
  }
}

function isBuiltinProfileRef(ref: string): ref is `builtin:${BuiltInAgentProfileId}` {
  return BUILTIN_PROFILE_REFS.has(ref);
}

export function isAgentProfileRef(value: unknown): value is AgentProfileRef {
  if (typeof value !== "string") return false;
  if (isBuiltinProfileRef(value)) return true;
  if (value.startsWith("global:")) return PROFILE_ID_RE.test(value.slice("global:".length));
  if (value.startsWith("project:")) return PROFILE_ID_RE.test(value.slice("project:".length));
  return false;
}

export function normalizeAgentProfileRef(value: unknown): AgentProfileRef | undefined {
  if (value === "builtin:off") return "builtin:no-tools";
  return isAgentProfileRef(value) ? value : undefined;
}

function makeProfileRef(scope: AgentProfileScope, id: string): AgentProfileRef {
  return `${scope}:${id}` as AgentProfileRef;
}

function isDefaultRefAllowedForScope(scope: AgentProfileScope, ref: AgentProfileRef): boolean {
  return scope === "project" || !ref.startsWith("project:");
}

function validateProfileId(value: unknown): string {
  if (typeof value !== "string") throw httpError("profile.id must be a string");
  const id = value.trim();
  if (!PROFILE_ID_RE.test(id)) {
    throw httpError("profile.id must start with a letter or number and contain only letters, numbers, dots, underscores, or hyphens (max 64 chars)");
  }
  return id;
}

function validateOptionalTimestamp(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 80 || /[\u0000-\u001f]/.test(value)) {
    throw httpError(`${fieldName} must be an ISO timestamp string`);
  }
  return value;
}

function normalizeModel(value: unknown): AgentProfileModel | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!isRecord(value)) throw httpError("profile.model must be an object or null");
  assertKnownKeys(value, new Set(["provider", "modelId"]), "profile.model");
  const provider = typeof value.provider === "string" ? value.provider.trim() : "";
  const modelId = typeof value.modelId === "string" ? value.modelId.trim() : "";
  if (!provider || provider.length > 120 || /[\u0000-\u001f]/.test(provider)) {
    throw httpError("profile.model.provider must be a non-empty string without control characters");
  }
  if (!modelId || modelId.length > 240 || /[\u0000-\u001f]/.test(modelId)) {
    throw httpError("profile.model.modelId must be a non-empty string without control characters");
  }
  return { provider, modelId };
}

function normalizeThinkingLevel(value: unknown): AgentProfileThinkingLevel {
  if (value === undefined) return "auto";
  if (typeof value !== "string" || !VALID_THINKING_LEVELS.has(value as AgentProfileThinkingLevel)) {
    throw httpError(`profile.thinkingLevel must be one of: ${AGENT_PROFILE_THINKING_LEVELS.join(", ")}`);
  }
  return value as AgentProfileThinkingLevel;
}

function normalizeToolPreset(value: unknown): ToolPreset {
  if (value === "off") return "none";
  if (typeof value !== "string" || !VALID_TOOL_PRESETS.has(value as ToolPreset)) {
    throw httpError("tool preset must be one of: none, off, default, full");
  }
  return value as ToolPreset;
}

function normalizeToolNames(value: unknown): string[] {
  if (!Array.isArray(value)) throw httpError("profile.tools.toolNames must be an array");
  if (value.length > MAX_TOOL_NAMES) throw httpError(`profile.tools.toolNames cannot contain more than ${MAX_TOOL_NAMES} entries`);
  const names: string[] = [];
  const seen = new Set<string>();
  for (const rawName of value) {
    if (typeof rawName !== "string") throw httpError("tool names must be strings");
    const name = rawName.trim();
    if (!TOOL_NAME_RE.test(name)) throw httpError(`invalid tool name: ${rawName}`);
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

function normalizeTools(value: unknown, legacyPreset: unknown): AgentProfileTools {
  if (value === undefined) {
    const preset = legacyPreset === undefined ? "full" : normalizeToolPreset(legacyPreset);
    return { mode: "preset", preset, includeExtensionTools: preset !== "none" };
  }
  if (!isRecord(value)) throw httpError("profile.tools must be an object");
  const mode = value.mode;
  if (mode === "preset") {
    assertKnownKeys(value, new Set(["mode", "preset", "includeExtensionTools"]), "profile.tools");
    const preset = normalizeToolPreset(value.preset);
    const includeExtensionTools = typeof value.includeExtensionTools === "boolean"
      ? value.includeExtensionTools
      : preset !== "none";
    return { mode: "preset", preset, includeExtensionTools };
  }
  if (mode === "custom") {
    assertKnownKeys(value, new Set(["mode", "toolNames", "includeExtensionTools"]), "profile.tools");
    if (typeof value.includeExtensionTools !== "boolean") {
      throw httpError("profile.tools.includeExtensionTools must be true or false for custom tools");
    }
    return {
      mode: "custom",
      toolNames: normalizeToolNames(value.toolNames),
      includeExtensionTools: value.includeExtensionTools,
    };
  }
  throw httpError("profile.tools.mode must be preset or custom");
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\") || value.startsWith("//");
}

function isAbsolutePath(value: string): boolean {
  return path.isAbsolute(value) || isWindowsAbsolutePath(value);
}

function isPathInside(target: string, root: string): boolean {
  const resolvedTarget = path.resolve(target);
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertExistingPathInside(target: string, root: string, label: string): void {
  try {
    const stats = statSync(target);
    if (!stats.isFile() && !stats.isDirectory()) {
      throw httpError(`${label}.path must point to a file or directory`);
    }
    const realTarget = realpathSync.native(target);
    const realRoot = realpathSync.native(root);
    if (!isPathInside(realTarget, realRoot)) {
      throw httpError(`${label}.path must resolve inside ${root}`);
    }
  } catch (error) {
    if (error instanceof Error && "statusCode" in error) throw error;
    throw httpError(`${label}.path does not exist or cannot be read: ${target}`);
  }
}

function expandTilde(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return path.join(homedir(), value.slice(2));
  return value;
}

export function resolveAgentProfilePath(cwd: string, ref: AgentProfilePathRef, agentDir = getAgentDir()): ResolvedAgentProfilePath {
  const expanded = ref.scope === "global" ? expandTilde(ref.path) : ref.path;
  const lexicalPath = ref.scope === "project"
    ? path.resolve(cwd, ref.path)
    : path.resolve(isAbsolutePath(expanded) ? expanded : path.join(agentDir, expanded));
  const root = ref.scope === "project" ? cwd : agentDir;
  assertExistingPathInside(lexicalPath, root, "profile resource");
  return { ...ref, resolvedPath: realpathSync.native(lexicalPath) };
}

function normalizeProfilePathRef(
  value: unknown,
  label: string,
  options: NormalizeProfileOptions,
): AgentProfilePathRef {
  if (!isRecord(value)) throw httpError(`${label} must be an object`);
  assertKnownKeys(value, new Set(["scope", "path"]), label);
  const scope = value.scope;
  if (scope !== "global" && scope !== "project") throw httpError(`${label}.scope must be global or project`);
  if (typeof value.path !== "string") throw httpError(`${label}.path must be a string`);
  const pathValue = value.path.trim();
  if (!pathValue || pathValue.length > 1000 || /\u0000/.test(pathValue)) {
    throw httpError(`${label}.path must be a non-empty path without null bytes`);
  }

  if (scope === "project") {
    if (!options.projectTrusted) {
      if (options.strict) {
        throw httpError("Project-scoped profile resource paths cannot be saved until the project is trusted.", 403);
      }
      return { scope, path: pathValue };
    }
    if (isAbsolutePath(pathValue) || pathValue.startsWith("~")) {
      throw httpError(`${label}.path must be relative for project-scoped resources`);
    }
    const resolved = path.resolve(options.cwd, pathValue);
    if (!isPathInside(resolved, options.cwd)) {
      throw httpError(`${label}.path must stay inside the project directory`);
    }
    assertExistingPathInside(resolved, options.cwd, label);
    if (label.includes("instructions.files") && !statSync(resolved).isFile()) {
      throw httpError(`${label}.path must point to a file`);
    }
  } else {
    if (options.profileScope === "project") {
      throw httpError(`${label}.scope must be project for project-scoped profiles`);
    }
    const expanded = expandTilde(pathValue);
    const resolved = path.resolve(isAbsolutePath(expanded) ? expanded : path.join(options.agentDir, expanded));
    if (!isPathInside(resolved, options.agentDir)) {
      throw httpError(`${label}.path must resolve inside the pi agent directory for global-scoped resources`);
    }
    assertExistingPathInside(resolved, options.agentDir, label);
    if (label.includes("instructions.files") && !statSync(resolved).isFile()) {
      throw httpError(`${label}.path must point to a file`);
    }
  }

  return { scope, path: pathValue };
}

function normalizePathList(
  value: unknown,
  label: string,
  options: NormalizeProfileOptions,
): AgentProfilePathRef[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw httpError(`${label} must be an array`);
  if (value.length > MAX_RESOURCE_PATHS) throw httpError(`${label} cannot contain more than ${MAX_RESOURCE_PATHS} paths`);
  const paths: AgentProfilePathRef[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const normalized = normalizeProfilePathRef(entry, `${label}[${index}]`, options);
    const key = `${normalized.scope}\0${normalized.path}`;
    if (!seen.has(key)) {
      seen.add(key);
      paths.push(normalized);
    }
  }
  return paths;
}

function normalizeInstructions(
  value: unknown,
  options: NormalizeProfileOptions,
): AgentProfileInstructions {
  if (value === undefined) return { mode: "default", files: [] };
  if (!isRecord(value)) throw httpError("profile.instructions must be an object");
  assertKnownKeys(value, new Set(["mode", "text", "files"]), "profile.instructions");
  const mode = value.mode;
  if (mode !== "default" && mode !== "append" && mode !== "replace") {
    throw httpError("profile.instructions.mode must be default, append, or replace");
  }
  if (mode === "default") {
    if (value.text !== undefined || (value.files !== undefined && (!Array.isArray(value.files) || value.files.length > 0))) {
      throw httpError("profile.instructions.text/files require append or replace mode");
    }
    return { mode: "default", files: [] };
  }
  const text = value.text === undefined ? undefined : typeof value.text === "string" ? value.text : undefined;
  if (value.text !== undefined && text === undefined) throw httpError("profile.instructions.text must be a string");
  if (text !== undefined && text.length > MAX_INSTRUCTION_TEXT_LENGTH) {
    throw httpError(`profile.instructions.text cannot exceed ${MAX_INSTRUCTION_TEXT_LENGTH} characters`);
  }
  const files = normalizePathList(value.files, "profile.instructions.files", options);
  return { mode, ...(text !== undefined ? { text } : {}), files };
}

function normalizeResources(
  value: unknown,
  options: NormalizeProfileOptions,
): Required<AgentProfileResources> {
  if (value === undefined) return { skillPaths: [], promptPaths: [], themePaths: [] };
  if (!isRecord(value)) throw httpError("profile.resources must be an object");
  assertKnownKeys(value, new Set(["skillPaths", "promptPaths", "themePaths"]), "profile.resources");
  return {
    skillPaths: normalizePathList(value.skillPaths, "profile.resources.skillPaths", options),
    promptPaths: normalizePathList(value.promptPaths, "profile.resources.promptPaths", options),
    themePaths: normalizePathList(value.themePaths, "profile.resources.themePaths", options),
  };
}

const PROFILE_KEYS = new Set([
  "id",
  "name",
  "description",
  "model",
  "thinkingLevel",
  "tools",
  "toolPreset",
  "instructions",
  "resources",
  "createdAt",
  "updatedAt",
]);

function normalizeStoredProfile(
  value: unknown,
  options: NormalizeProfileOptions,
): NormalizedAgentProfile {
  if (!isRecord(value)) throw httpError("profile must be an object");
  if (options.strict) assertKnownKeys(value, PROFILE_KEYS, "profile");
  const id = validateProfileId(value.id);
  if (typeof value.name !== "string") throw httpError("profile.name must be a string");
  const name = normalizeWhitespace(value.name);
  if (!name || name.length > 80) throw httpError("profile.name must be between 1 and 80 characters");
  const description = value.description === undefined ? undefined : typeof value.description === "string" ? value.description.trim() : undefined;
  if (value.description !== undefined && description === undefined) throw httpError("profile.description must be a string");
  if (description && description.length > MAX_DESCRIPTION_LENGTH) {
    throw httpError(`profile.description cannot exceed ${MAX_DESCRIPTION_LENGTH} characters`);
  }
  const model = normalizeModel(value.model);
  const createdAt = validateOptionalTimestamp(value.createdAt, "profile.createdAt");
  const updatedAt = validateOptionalTimestamp(value.updatedAt, "profile.updatedAt");

  return {
    id,
    name,
    ...(description ? { description } : {}),
    ...(model !== undefined ? { model } : {}),
    thinkingLevel: normalizeThinkingLevel(value.thinkingLevel),
    tools: normalizeTools(value.tools, value.toolPreset),
    instructions: normalizeInstructions(value.instructions, options),
    resources: normalizeResources(value.resources, options),
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };
}

function normalizeDefaultProfileRef(value: unknown, scope: AgentProfileScope, diagnostics: AgentProfileDiagnostic[]): AgentProfileRef | undefined {
  if (value === undefined) return undefined;
  const ref = normalizeAgentProfileRef(value);
  if (!ref) {
    diagnostics.push({ scope, type: "warning", message: "Ignoring invalid default profile reference." });
    return undefined;
  }
  if (!isDefaultRefAllowedForScope(scope, ref)) {
    diagnostics.push({ scope, type: "warning", message: "Ignoring global default profile reference to a project profile." });
    return undefined;
  }
  return ref;
}

function readAgentProfilesSettings(
  settings: JsonObject,
  scope: AgentProfileScope,
  diagnostics: AgentProfileDiagnostic[],
  options: { cwd: string; agentDir: string; projectTrusted: boolean },
): AgentProfilesSettings {
  const raw = settings[SETTINGS_KEY];
  if (raw === undefined) return { version: 1, profiles: [] };
  if (!isRecord(raw)) {
    diagnostics.push({ scope, type: "error", message: `${SETTINGS_KEY} must be an object` });
    return { version: 1, profiles: [] };
  }
  if (raw.version !== undefined && raw.version !== 1) {
    diagnostics.push({ scope, type: "warning", message: `Unsupported ${SETTINGS_KEY}.version; attempting to read as version 1.` });
  }
  const defaultProfileRef = normalizeDefaultProfileRef(raw.defaultProfileRef, scope, diagnostics);
  const rawProfiles = raw.profiles;
  if (rawProfiles === undefined) return { version: 1, defaultProfileRef, profiles: [] };
  if (!Array.isArray(rawProfiles)) {
    diagnostics.push({ scope, type: "error", message: `${SETTINGS_KEY}.profiles must be an array` });
    return { version: 1, defaultProfileRef, profiles: [] };
  }
  const profiles: StoredAgentProfile[] = [];
  const seen = new Set<string>();
  for (const [index, rawProfile] of rawProfiles.entries()) {
    let profileId: string | undefined;
    try {
      if (isRecord(rawProfile) && typeof rawProfile.id === "string") profileId = rawProfile.id;
      const profile = normalizeStoredProfile(rawProfile, { ...options, strict: false, profileScope: scope });
      if (seen.has(profile.id)) {
        diagnostics.push({ scope, type: "warning", profileId: profile.id, message: `Ignoring duplicate profile id ${profile.id}.` });
        continue;
      }
      seen.add(profile.id);
      profiles.push(profile);
    } catch (error) {
      diagnostics.push({
        scope,
        type: "error",
        profileId,
        message: `Ignoring invalid profile at index ${index}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return { version: 1, defaultProfileRef, profiles };
}

function toResolvedProfile(profile: StoredAgentProfile, source: AgentProfileScope, options: { cwd: string; agentDir: string; projectTrusted: boolean }): ResolvedAgentProfile {
  const normalized = normalizeStoredProfile(profile, { ...options, strict: false, profileScope: source });
  return {
    ...normalized,
    ref: makeProfileRef(source, normalized.id),
    source,
    readonly: false,
  };
}

function buildProfilesByRef(profiles: ResolvedAgentProfile[]): Map<AgentProfileRef, ResolvedAgentProfile> {
  return new Map(profiles.map((profile) => [profile.ref, profile]));
}

function chooseEffectiveDefault(
  profilesByRef: Map<AgentProfileRef, ResolvedAgentProfile>,
  diagnostics: AgentProfileDiagnostic[],
  globalDefaultProfileRef?: AgentProfileRef,
  projectDefaultProfileRef?: AgentProfileRef,
): AgentProfileRef {
  if (projectDefaultProfileRef) {
    if (profilesByRef.has(projectDefaultProfileRef)) return projectDefaultProfileRef;
    diagnostics.push({ scope: "project", type: "warning", message: `Project default profile ${projectDefaultProfileRef} was not found.` });
  }
  if (globalDefaultProfileRef) {
    if (profilesByRef.has(globalDefaultProfileRef)) return globalDefaultProfileRef;
    diagnostics.push({ scope: "global", type: "warning", message: `Global default profile ${globalDefaultProfileRef} was not found.` });
  }
  return "builtin:full";
}

function projectPathRefs(profile: NormalizedAgentProfile): AgentProfilePathRef[] {
  return [
    ...(profile.instructions.files ?? []),
    ...profile.resources.skillPaths,
    ...profile.resources.promptPaths,
    ...profile.resources.themePaths,
  ].filter((entry) => entry.scope === "project");
}

function stripProjectPathsFromProfile<T extends NormalizedAgentProfile>(profile: T): T {
  if (projectPathRefs(profile).length === 0) return profile;
  return {
    ...profile,
    instructions: {
      ...profile.instructions,
      files: (profile.instructions.files ?? []).filter((entry) => entry.scope !== "project"),
    },
    resources: {
      skillPaths: profile.resources.skillPaths.filter((entry) => entry.scope !== "project"),
      promptPaths: profile.resources.promptPaths.filter((entry) => entry.scope !== "project"),
      themePaths: profile.resources.themePaths.filter((entry) => entry.scope !== "project"),
    },
  };
}

function stripUntrustedProjectPaths(
  profiles: ResolvedAgentProfile[],
  diagnostics: AgentProfileDiagnostic[],
  projectResourcesTrusted: boolean,
  reason = "Project-scoped profile resource path is inactive until the project is trusted.",
): ResolvedAgentProfile[] {
  if (projectResourcesTrusted) return profiles;
  return profiles.map((profile) => {
    const blocked = projectPathRefs(profile);
    for (const entry of blocked) {
      diagnostics.push({
        scope: profile.source === "project" ? "project" : "global",
        type: "warning",
        profileId: profile.id,
        path: entry.path,
        message: reason,
      });
    }
    return blocked.length ? stripProjectPathsFromProfile(profile) : profile;
  });
}


export function getBuiltInAgentProfiles(): ResolvedAgentProfile[] {
  return BUILTIN_PROFILES.map((profile) => ({
    ...profile,
    tools: { ...profile.tools },
    instructions: { ...profile.instructions, files: [...(profile.instructions.files ?? [])] },
    resources: {
      skillPaths: [...profile.resources.skillPaths],
      promptPaths: [...profile.resources.promptPaths],
      themePaths: [...profile.resources.themePaths],
    },
  }));
}

export function loadAgentProfiles(cwd: string): AgentProfilesResponse {
  const resolvedCwd = path.resolve(cwd);
  const agentDir = getAgentDir();
  const { globalPath, projectPath } = getAgentProfileStorePaths(resolvedCwd, agentDir);
  const diagnostics: AgentProfileDiagnostic[] = [];
  const globalSettings = readJsonObjectTolerant(globalPath, diagnostics, "global");
  const trust = resolveProjectTrust(resolvedCwd, globalSettings);
  const projectResourcesTrusted = trust.trusted && trust.source !== "none-required";
  const projectProfilesWritable = trust.trusted;
  const projectSettings = projectResourcesTrusted ? readJsonObjectTolerant(projectPath, diagnostics, "project") : {};

  const globalProfilesSettings = readAgentProfilesSettings(globalSettings, "global", diagnostics, {
    cwd: resolvedCwd,
    agentDir,
    projectTrusted: projectResourcesTrusted,
  });
  const projectProfilesSettings = projectResourcesTrusted
    ? readAgentProfilesSettings(projectSettings, "project", diagnostics, {
      cwd: resolvedCwd,
      agentDir,
      projectTrusted: true,
    })
    : { version: 1 as const, profiles: [] };

  const builtIns = getBuiltInAgentProfiles();
  const globalProfiles = globalProfilesSettings.profiles.map((profile) => toResolvedProfile(profile, "global", {
    cwd: resolvedCwd,
    agentDir,
    projectTrusted: projectResourcesTrusted,
  }));
  const projectProfiles = projectProfilesSettings.profiles.map((profile) => toResolvedProfile(profile, "project", {
    cwd: resolvedCwd,
    agentDir,
    projectTrusted: true,
  }));
  const safeGlobalProfiles = stripUntrustedProjectPaths(globalProfiles, diagnostics, projectResourcesTrusted);

  const profiles = [...builtIns, ...safeGlobalProfiles, ...projectProfiles];
  const profilesByRef = buildProfilesByRef(profiles);
  const effectiveDefaultProfileRef = chooseEffectiveDefault(
    profilesByRef,
    diagnostics,
    globalProfilesSettings.defaultProfileRef,
    projectProfilesSettings.defaultProfileRef,
  );

  return {
    cwd: resolvedCwd,
    agentDir,
    projectTrusted: trust.trusted,
    projectTrustSource: trust.source,
    scopes: {
      global: { path: globalPath, writable: true },
      project: {
        path: projectPath,
        readable: projectProfilesWritable,
        writable: projectProfilesWritable,
        ...(!projectProfilesWritable ? { blockedReason: trust.source === "none-required"
          ? "Project profiles are ignored until the project has trust-requiring resources."
          : trust.trusted
            ? "Trust this project before saving project profiles."
            : "Project profiles are ignored until the project is trusted." } : {}),
      },
    },
    profiles,
    globalDefaultProfileRef: globalProfilesSettings.defaultProfileRef,
    projectDefaultProfileRef: projectProfilesSettings.defaultProfileRef,
    effectiveDefaultProfileRef,
    diagnostics,
  };
}

type WritableProfilesStore = {
  response: AgentProfilesResponse;
  scope: AgentProfileScope;
  settingsPath: string;
  settings: JsonObject;
  agentProfiles: JsonObject;
  profiles: unknown[];
  originalAgentProfilesJson: string;
};

function getRawProfileId(value: unknown): string | undefined {
  return isRecord(value) && typeof value.id === "string" ? value.id.trim() : undefined;
}

function getRawProfileCreatedAt(value: unknown): string | undefined {
  return isRecord(value) && typeof value.createdAt === "string" ? value.createdAt : undefined;
}

function getBlockingWriteDiagnostics(diagnostics: AgentProfileDiagnostic[]): AgentProfileDiagnostic[] {
  return diagnostics.filter((diagnostic) =>
    diagnostic.type === "error" ||
    diagnostic.message.includes("duplicate") ||
    diagnostic.message.startsWith("Unsupported"),
  );
}

function getSettingsForWrite(cwd: string, scope: AgentProfileScope): WritableProfilesStore {
  const response = loadAgentProfiles(cwd);
  if (scope === "project" && !response.scopes.project.writable) {
    throw httpError(response.scopes.project.blockedReason ?? "Project profiles cannot be changed until the project is trusted.", 403);
  }
  const settingsPath = scope === "global" ? response.scopes.global.path : response.scopes.project.path;
  let settings: JsonObject;
  try {
    settings = readJsonObject(settingsPath);
  } catch (error) {
    throw httpError(error instanceof Error ? error.message : String(error), 409);
  }

  const rawAgentProfiles = settings[SETTINGS_KEY];
  const originalAgentProfilesJson = JSON.stringify(rawAgentProfiles ?? { version: 1, profiles: [] });
  const agentProfiles: JsonObject = rawAgentProfiles === undefined
    ? { version: 1, profiles: [] }
    : isRecord(rawAgentProfiles)
      ? { ...rawAgentProfiles }
      : (() => { throw httpError(`${SETTINGS_KEY} must be an object before it can be edited.`, 409); })();
  const rawProfiles = agentProfiles.profiles;
  const profiles = rawProfiles === undefined
    ? []
    : Array.isArray(rawProfiles)
      ? [...rawProfiles]
      : (() => { throw httpError(`${SETTINGS_KEY}.profiles must be an array before it can be edited.`, 409); })();

  const diagnostics: AgentProfileDiagnostic[] = [];
  readAgentProfilesSettings(settings, scope, diagnostics, {
    cwd: response.cwd,
    agentDir: response.agentDir,
    projectTrusted: response.scopes.project.writable,
  });
  const blocking = getBlockingWriteDiagnostics(diagnostics);
  if (blocking.length) {
    throw httpError(`Cannot edit profiles until existing profile settings are fixed: ${blocking.map((entry) => entry.message).join("; ")}`, 409);
  }

  return { response, scope, settingsPath, settings, agentProfiles, profiles, originalAgentProfilesJson };
}


function writeProfilesSettings(store: WritableProfilesStore): void {
  store.agentProfiles.version = 1;
  store.agentProfiles.profiles = store.profiles;
  const settingsRoot = store.scope === "global" ? store.response.agentDir : store.response.cwd;
  const settingsExistedBeforeWrite = existsSync(store.settingsPath);
  withSettingsFileLock(store.settingsPath, settingsRoot, (current) => {
    assertSafeSettingsWritePath(store.settingsPath, settingsRoot);
    const currentSettings = parseSettingsForLockedWrite(current, store.settingsPath);
    const currentAgentProfilesJson = JSON.stringify(currentSettings[SETTINGS_KEY] ?? { version: 1, profiles: [] });
    if (currentAgentProfilesJson !== store.originalAgentProfilesJson) {
      throw httpError("Profile settings changed while editing; reload and try again.", 409);
    }
    currentSettings[SETTINGS_KEY] = store.agentProfiles;
    return {
      content: `${JSON.stringify(currentSettings, null, 2)}\n`,
      afterWrite: () => {
        try {
          promoteCleanProjectProfileTrust(store, settingsRoot);
        } catch (error) {
          if (store.scope === "project" && store.response.projectTrustSource === "none-required" && !settingsExistedBeforeWrite) {
            try { unlinkSync(store.settingsPath); } catch { /* best-effort rollback of untrusted first-write settings */ }
          }
          throw error;
        }
      },
    };
  });
}

function promoteCleanProjectProfileTrust(store: WritableProfilesStore, settingsRoot: string): void {
  if (store.scope !== "project" || store.response.projectTrustSource !== "none-required") return;
  assertSafeSettingsWritePath(store.settingsPath, settingsRoot);
  const currentSettings = readJsonObject(store.settingsPath);
  assertSafeSettingsWritePath(store.settingsPath, settingsRoot);
  const currentAgentProfilesJson = JSON.stringify(currentSettings[SETTINGS_KEY] ?? { version: 1, profiles: [] });
  const expectedAgentProfilesJson = JSON.stringify(store.agentProfiles);
  if (currentAgentProfilesJson !== expectedAgentProfilesJson) {
    throw httpError("Profile settings changed while saving; reload and try again.", 409);
  }
  const unexpectedSettingsKeys = Object.keys(currentSettings).filter((key) => key !== SETTINGS_KEY);
  if (unexpectedSettingsKeys.length > 0) {
    throw httpError(`Project settings changed while saving profile settings: ${unexpectedSettingsKeys.join(", ")}. Review project trust and try again.`, 409);
  }
  const unexpectedTrustRequirements = collectProjectTrustInventory(store.response.cwd)
    .filter((item) => item.exists && item.requiresTrust && item.kind !== "project-agent-profiles" && item.kind !== "pi-settings");
  if (unexpectedTrustRequirements.length > 0) {
    throw httpError(`Project trust requirements changed while saving profile settings: ${unexpectedTrustRequirements.map((item) => item.label).join(", ")}. Review project trust and try again.`, 409);
  }
  assertSafeSettingsWritePath(store.settingsPath, settingsRoot);
  new ProjectTrustStore(store.response.agentDir).set(store.response.cwd, true);
}
export function upsertAgentProfile(cwd: string, scope: AgentProfileScope, rawProfile: unknown): AgentProfilesMutationResponse {
  const store = getSettingsForWrite(cwd, scope);
  const projectResourcesTrusted = scope === "project" && store.response.projectTrustSource === "none-required"
    ? true
    : store.response.projectTrusted && store.response.projectTrustSource !== "none-required";
  const profile = normalizeStoredProfile(rawProfile, {
    cwd: store.response.cwd,
    agentDir: store.response.agentDir,
    projectTrusted: projectResourcesTrusted,
    strict: true,
    profileScope: scope,
  });
  const now = new Date().toISOString();
  const existingIndex = store.profiles.findIndex((entry) => getRawProfileId(entry) === profile.id);
  const existing = existingIndex === -1 ? undefined : store.profiles[existingIndex];
  const nextProfile: StoredAgentProfile = {
    ...profile,
    createdAt: getRawProfileCreatedAt(existing) ?? profile.createdAt ?? now,
    updatedAt: now,
  };
  if (existingIndex === -1) store.profiles.push(nextProfile);
  else store.profiles[existingIndex] = nextProfile;
  writeProfilesSettings(store);
  return { ...loadAgentProfiles(store.response.cwd), changed: [makeProfileRef(scope, profile.id)] };
}

export function deleteAgentProfile(cwd: string, scope: AgentProfileScope, id: string): AgentProfilesMutationResponse {
  const profileId = validateProfileId(id);
  const store = getSettingsForWrite(cwd, scope);
  const ref = makeProfileRef(scope, profileId);
  const existingIndex = store.profiles.findIndex((entry) => getRawProfileId(entry) === profileId);
  if (existingIndex === -1) throw httpError(`Profile not found: ${ref}`, 404);
  store.profiles.splice(existingIndex, 1);
  if (store.agentProfiles.defaultProfileRef === ref) delete store.agentProfiles.defaultProfileRef;
  writeProfilesSettings(store);
  return { ...loadAgentProfiles(store.response.cwd), changed: [ref] };
}

export function setDefaultAgentProfile(cwd: string, scope: AgentProfileScope, ref: AgentProfileRef | null): AgentProfilesMutationResponse {
  const store = getSettingsForWrite(cwd, scope);
  if (ref === null) {
    delete store.agentProfiles.defaultProfileRef;
    writeProfilesSettings(store);
    return { ...loadAgentProfiles(store.response.cwd), changed: [`${scope}:defaultProfileRef`] };
  }
  const normalizedRef = normalizeAgentProfileRef(ref);
  if (!normalizedRef) throw httpError("ref must be a valid profile reference");
  if (!isDefaultRefAllowedForScope(scope, normalizedRef)) {
    throw httpError("Global default profiles cannot reference project-scoped profiles.");
  }
  const currentProfiles = buildProfilesByRef(store.response.profiles);
  if (!currentProfiles.has(normalizedRef)) throw httpError(`Profile not found: ${normalizedRef}`, 404);
  store.agentProfiles.defaultProfileRef = normalizedRef;
  writeProfilesSettings(store);
  return { ...loadAgentProfiles(store.response.cwd), changed: [`${scope}:defaultProfileRef`] };
}


export function getToolNamesForAgentProfile(profile: ResolvedAgentProfile): string[] {
  if (profile.tools.mode === "preset") return getToolNamesForPreset(profile.tools.preset);
  return [...profile.tools.toolNames];
}

export function getIncludeExtensionToolsForAgentProfile(profile: ResolvedAgentProfile): boolean {
  if (profile.tools.mode === "preset") return profile.tools.includeExtensionTools ?? profile.tools.preset !== "none";
  return profile.tools.includeExtensionTools;
}

export function getExtensionToolModeForAgentProfile(profile: ResolvedAgentProfile): AgentProfileExtensionToolMode {
  if (!getIncludeExtensionToolsForAgentProfile(profile)) return "none";
  return profile.tools.mode === "preset" ? "all" : "selected";
}

export function resolveAgentProfile(cwd: string, ref?: AgentProfileRef): ResolvedAgentProfile {
  const response = loadAgentProfiles(cwd);
  const targetRef = ref ?? response.effectiveDefaultProfileRef;
  const profile = response.profiles.find((entry) => entry.ref === targetRef);
  if (profile) return profile;
  if (ref) throw httpError(`Profile not found: ${ref}`, 404);
  return response.profiles.find((entry) => entry.ref === "builtin:full") ?? getBuiltInAgentProfiles()[2];
}

function resolveProfilePathList(cwd: string, entries: AgentProfilePathRef[], agentDir = getAgentDir()): ResolvedAgentProfilePath[] {
  return entries.map((entry) => resolveAgentProfilePath(cwd, entry, agentDir));
}

function hasTrustedProjectProfileResources(cwd: string): boolean {
  const resolvedCwd = path.resolve(cwd);
  try {
    const globalSettings = readJsonObject(getGlobalSettingsPath(getAgentDir()));
    const trust = resolveProjectTrust(resolvedCwd, globalSettings);
    return trust.trusted && trust.source !== "none-required";
  } catch {
    return false;
  }
}

export function expandAgentProfileForNewSession(cwd: string, profile: ResolvedAgentProfile): AgentProfileSessionOptions {
  const effectiveProfile = hasTrustedProjectProfileResources(cwd) ? profile : stripProjectPathsFromProfile(profile);
  const model = effectiveProfile.model ?? undefined;
  return {
    profileRef: effectiveProfile.ref,
    profileName: effectiveProfile.name,
    toolNames: getToolNamesForAgentProfile(effectiveProfile),
    includeExtensionTools: getIncludeExtensionToolsForAgentProfile(effectiveProfile),
    extensionToolMode: getExtensionToolModeForAgentProfile(effectiveProfile),
    ...(model ? { provider: model.provider, modelId: model.modelId } : {}),
    ...(effectiveProfile.thinkingLevel !== "auto" ? { thinkingLevel: effectiveProfile.thinkingLevel as AgentProfileAppliedThinkingLevel } : {}),
    instructions: {
      ...effectiveProfile.instructions,
      files: resolveProfilePathList(cwd, effectiveProfile.instructions.files ?? []),
    },
    resources: {
      skillPaths: resolveProfilePathList(cwd, effectiveProfile.resources.skillPaths),
      promptPaths: resolveProfilePathList(cwd, effectiveProfile.resources.promptPaths),
      themePaths: resolveProfilePathList(cwd, effectiveProfile.resources.themePaths),
    },
  };
}
